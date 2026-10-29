import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Prisma, DeliveryStatus } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { PrismaService } from '../common/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { eligible, meters, validOffer } from './rules';

export type Tx = Prisma.TransactionClient;
const SEARCHING: DeliveryStatus[] = ['SOLICITADO', 'BUSCANDO', 'AGUARDANDO'];
@Injectable()
export class DispatchService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(DispatchService.name);
  readonly redis: IORedis;
  private readonly queue: Queue;
  private worker: Worker;
  private workerConnection?: IORedis;
  readonly ttl = Math.min(60, Math.max(5, Number(process.env.OFFER_TTL_SECONDS) || 10));
  readonly maxAge = Math.max(15, Number(process.env.LOCATION_MAX_AGE_SECONDS) || 120);
  readonly maxWait = Math.min(3600, Math.max(60, Number(process.env.WAIT_MAX_SECONDS) || 900));
  constructor(
    private readonly db: PrismaService,
    @Optional() private readonly settings?: SettingsService,
  ) {
    this.redis = new IORedis(process.env.REDIS_URL || 'redis://127.0.0.1:6379', {
      maxRetriesPerRequest: null,
    });
    this.queue = new Queue(process.env.DISPATCH_QUEUE_NAME || 'ligeirinho-dispatch', {
      connection: this.redis as never,
      defaultJobOptions: {
        attempts: 8,
        backoff: { type: 'exponential', delay: 500 },
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    });
  }
  async onModuleInit() {
    this.workerConnection = this.redis.duplicate();
    this.worker = new Worker(
      process.env.DISPATCH_QUEUE_NAME || 'ligeirinho-dispatch',
      async (job) => {
        if (job.name === 'expire') await this.expire(job.data.id);
        else if (job.name === 'dispatch') await this.dispatch(job.data.id);
        else await this.sweep();
      },
      { connection: this.workerConnection as never, concurrency: 4 },
    );
    this.worker.on('failed', (job, error) =>
      this.log.error(
        JSON.stringify({ event: 'dispatch_job_failed', jobId: job?.id, error: error.message }),
      ),
    );
    await this.queue.upsertJobScheduler(
      'reconcile',
      { every: 3000 },
      { name: 'reconcile', data: {} },
    );
    await this.sweep();
  }
  async onModuleDestroy() {
    await this.worker?.close();
    await this.workerConnection?.quit();
    await this.queue.close();
    await this.redis.quit();
  }
  async transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.$transaction(
      async (tx) => {
        // One documented lock order serializes all allocation and release operations across workers.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(1803242026)`;
        return fn(tx);
      },
      { timeout: 20000 },
    );
  }
  async enqueue(id: string) {
    await this.queue.add('dispatch', { id });
  }
  async dispatch(id: string) {
    const offer = await this.transaction(async (tx) => {
      const delivery = await tx.deliveryRequest.findUnique({
        where: { id },
        include: { establishment: true, offers: true },
      });
      if (!delivery || !SEARCHING.includes(delivery.status)) return null;
      const configured = await this.settings?.resolve(
        { cityId: delivery.cityId, establishmentId: delivery.establishmentId },
        { 'dispatch.offerTimeoutSeconds': this.ttl, 'dispatch.maxWaitSeconds': this.maxWait },
        tx,
      );
      const maxWait = configured
        ? Number(configured['dispatch.maxWaitSeconds'].value)
        : this.maxWait;
      const ttl = configured ? Number(configured['dispatch.offerTimeoutSeconds'].value) : this.ttl;
      if (Date.now() - delivery.createdAt.getTime() > maxWait * 1000) {
        await tx.deliveryRequest.update({
          where: { id },
          data: { status: 'CANCELADO', completedAt: new Date() },
        });
        await tx.deliveryEvent.create({
          data: {
            deliveryId: id,
            type: 'WAIT_TIMEOUT',
            metadata: { maxWaitSeconds: maxWait },
          },
        });
        return null;
      }
      const candidates = await tx.courier.findMany({
        where: {
          cityId: delivery.cityId,
          status: 'AVAILABLE',
          online: true,
          active: true,
          blocks: { none: { establishmentId: delivery.establishmentId } },
          offers: { none: { deliveryId: id } },
          deliveries: { none: { status: { notIn: ['FINALIZADO', 'CANCELADO'] } } },
        },
        include: { preferences: { where: { establishmentId: delivery.establishmentId } } },
      });
      const now = new Date();
      const couriers = candidates
        .filter((c) => eligible(c, now, this.maxAge))
        .sort((a, b) => {
          const pa = a.preferences[0]?.priority,
            pb = b.preferences[0]?.priority;
          if (pa !== undefined && pb === undefined) return -1;
          if (pb !== undefined && pa === undefined) return 1;
          if (pa !== undefined && pb !== undefined && pa !== pb) return pa - pb;
          return (
            meters(a as { latitude: number; longitude: number }, delivery.establishment) -
              meters(b as { latitude: number; longitude: number }, delivery.establishment) ||
            a.id.localeCompare(b.id)
          );
        });
      const courier = couriers[0];
      if (!courier) {
        await tx.deliveryRequest.update({ where: { id }, data: { status: 'AGUARDANDO' } });
        return null;
      }
      const offer = await tx.dispatchOffer.create({
        data: {
          deliveryId: id,
          courierId: courier.id,
          expiresAt: new Date(now.getTime() + ttl * 1000),
        },
      });
      await tx.courier.update({ where: { id: courier.id }, data: { status: 'OFFER_PENDING' } });
      await tx.deliveryRequest.update({ where: { id }, data: { status: 'OFERTADO' } });
      await tx.dispatchAttempt.create({
        data: { deliveryId: id, courierId: courier.id, outcome: 'OFFERED' },
      });
      await tx.deliveryEvent.create({
        data: {
          deliveryId: id,
          type: 'OFFERED',
          metadata: { offerId: offer.id, expiresAt: offer.expiresAt.toISOString() },
        },
      });
      return offer;
    });
    if (offer)
      await this.queue.add(
        'expire',
        { id: offer.id },
        { delay: Math.max(0, offer.expiresAt.getTime() - Date.now()), jobId: `expire-${offer.id}` },
      );
    return offer;
  }
  async expire(id: string) {
    const next = await this.transaction(async (tx) => {
      const offer = await tx.dispatchOffer.findUnique({ where: { id } });
      if (!offer || offer.status !== 'PENDING' || offer.expiresAt.getTime() > Date.now())
        return null;
      await tx.dispatchOffer.update({
        where: { id },
        data: { status: 'EXPIRED', respondedAt: new Date() },
      });
      const courier = await tx.courier.findUniqueOrThrow({ where: { id: offer.courierId } });
      await tx.courier.update({
        where: { id: courier.id },
        data: { status: courier.online ? 'AVAILABLE' : 'OFFLINE' },
      });
      await tx.deliveryRequest.update({
        where: { id: offer.deliveryId },
        data: { status: 'BUSCANDO' },
      });
      await tx.dispatchAttempt.create({
        data: { deliveryId: offer.deliveryId, courierId: courier.id, outcome: 'EXPIRED' },
      });
      await tx.deliveryEvent.create({
        data: { deliveryId: offer.deliveryId, type: 'OFFER_EXPIRED', metadata: { offerId: id } },
      });
      return offer.deliveryId;
    });
    if (next) await this.enqueue(next);
  }
  async respond(id: string, courierId: string, accept: boolean) {
    const result = await this.transaction(async (tx) => {
      const offer = await tx.dispatchOffer.findUnique({
        where: { id },
        include: { delivery: true, courier: true },
      });
      if (!offer || offer.courierId !== courierId)
        throw new ConflictException('Oferta indisponível.');
      validOffer(offer.status, offer.expiresAt, new Date());
      if (offer.delivery.status !== 'OFERTADO' || offer.courier.status !== 'OFFER_PENDING')
        throw new ConflictException('Oferta indisponível.');
      if (accept) {
        if (!eligible({ ...offer.courier, status: 'AVAILABLE' }, new Date(), this.maxAge))
          throw new ConflictException(
            'Atualize sua localização e disponibilidade antes de aceitar.',
          );
        if (
          await tx.deliveryRequest.count({
            where: { courierId, status: { notIn: ['FINALIZADO', 'CANCELADO'] } },
          })
        )
          throw new ConflictException('Já existe atendimento ativo.');
        await tx.dispatchOffer.update({
          where: { id },
          data: { status: 'ACCEPTED', respondedAt: new Date() },
        });
        await tx.courier.update({ where: { id: courierId }, data: { status: 'BUSY' } });
        await tx.deliveryRequest.update({
          where: { id: offer.deliveryId },
          data: { status: 'ACEITO', courierId, acceptedAt: new Date() },
        });
      } else {
        await tx.dispatchOffer.update({
          where: { id },
          data: { status: 'REJECTED', respondedAt: new Date() },
        });
        await tx.courier.update({
          where: { id: courierId },
          data: { status: offer.courier.online ? 'AVAILABLE' : 'OFFLINE' },
        });
        await tx.deliveryRequest.update({
          where: { id: offer.deliveryId },
          data: { status: 'BUSCANDO' },
        });
      }
      await tx.dispatchAttempt.create({
        data: {
          deliveryId: offer.deliveryId,
          courierId,
          outcome: accept ? 'ACCEPTED' : 'REJECTED',
        },
      });
      await tx.deliveryEvent.create({
        data: { deliveryId: offer.deliveryId, type: accept ? 'ACCEPTED' : 'OFFER_REJECTED' },
      });
      return { deliveryId: offer.deliveryId, accepted: accept };
    });
    if (!accept) await this.enqueue(result.deliveryId);
    return result;
  }
  async sweep() {
    const expired = await this.db.dispatchOffer.findMany({
      where: { status: 'PENDING', expiresAt: { lte: new Date() } },
      select: { id: true },
      take: 100,
    });
    for (const o of expired) await this.expire(o.id);
    const waiting = await this.db.deliveryRequest.findMany({
      where: { status: { in: SEARCHING } },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
      take: 100,
    });
    for (const d of waiting) await this.dispatch(d.id);
  }
}
