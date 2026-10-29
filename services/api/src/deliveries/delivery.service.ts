import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, DeliveryStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma.service';
import { Actor } from '../common/auth.types';
import { DispatchService, Tx } from '../dispatch/dispatch.service';
import { assertProgress, price } from '../dispatch/rules';
import { createMapsAdapter, MapsAdapter, RouteDistance } from '../integrations/maps';

export const includeDelivery = {
  stops: { orderBy: { sequence: 'asc' as const } },
  establishment: true,
  courier: true,
  cancellations: { orderBy: { createdAt: 'desc' as const }, take: 1 },
};
export type StopInput = { address: string; latitude: number; longitude: number };
@Injectable()
export class DeliveryService {
  private readonly maps: MapsAdapter = createMapsAdapter(process.env);
  constructor(
    private db: PrismaService,
    private dispatch: DispatchService,
  ) {}
  scope(user: Actor): Prisma.DeliveryRequestWhereInput {
    if (user.role === 'SUPER_ADMIN') return {};
    if (user.role === 'ADMIN' && user.cityId) return { cityId: user.cityId };
    if (user.role === 'ESTABLISHMENT' && user.establishmentId)
      return { establishmentId: user.establishmentId };
    if (user.role === 'COURIER' && user.courierId) return { courierId: user.courierId };
    throw new ForbiddenException('Perfil sem escopo válido.');
  }
  async get(user: Actor, id: string, tx: Tx = this.db) {
    const delivery = await tx.deliveryRequest.findFirst({
      where: { id, ...this.scope(user) },
      include: includeDelivery,
    });
    if (!delivery) throw new NotFoundException('Atendimento não encontrado.');
    return this.redact(delivery);
  }
  private redact<T extends { status: string; courier: unknown }>(d: T): T {
    if (['FINALIZADO', 'CANCELADO'].includes(d.status) && d.courier)
      d.courier = { ...(d.courier as object), latitude: null, longitude: null, locationAt: null };
    return d;
  }
  async read(user: Actor, id: string) {
    return this.redact(await this.get(user, id));
  }
  async list(user: Actor) {
    return (
      await this.db.deliveryRequest.findMany({
        where: this.scope(user),
        include: includeDelivery,
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
    ).map((d) => this.redact(d));
  }
  async quote(user: Actor, stops: StopInput[]) {
    if (user.role !== 'ESTABLISHMENT' || !user.establishmentId)
      throw new ForbiddenException('Apenas estabelecimentos podem cotar.');
    const establishment = await this.db.establishment.findUniqueOrThrow({
      where: { id: user.establishmentId },
    });
    if (!establishment.active) throw new ForbiddenException('Estabelecimento inativo.');
    const tariff = await this.db.tariff.findFirst({
      where: { cityId: establishment.cityId, active: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!tariff)
      throw new ConflictException('Administrador deve cadastrar tarifa ativa para a cidade.');
    let route: RouteDistance;
    try {
      route = await this.maps.route([establishment, ...stops]);
    } catch {
      throw new ServiceUnavailableException(
        'Não foi possível obter a rota para cotação. Nenhuma solicitação foi criada.',
      );
    }
    const { distanceMeters } = route;
    const totalCents = price(tariff.baseCents, tariff.perKmCents, distanceMeters);
    const pricingSnapshot = {
      tariffId: tariff.id,
      baseCents: tariff.baseCents,
      perKmCents: tariff.perKmCents,
      distanceSource: route.source,
      durationSeconds: route.durationSeconds,
      distanceMeters,
      rounding: 'nearest_cent',
      currency: 'BRL',
    };
    const quote = await this.db.priceQuote.create({
      data: {
        establishmentId: establishment.id,
        totalCents,
        distanceMeters,
        stops: stops as Prisma.InputJsonValue,
        pricingSnapshot,
        expiresAt: new Date(Date.now() + 300000),
      },
    });
    return {
      ...quote,
      distanceKm: distanceMeters / 1000,
      distanceSource: route.source,
      durationSeconds: route.durationSeconds,
    };
  }
  async create(
    user: Actor,
    input: { quoteId: string; idempotencyKey: string; stops?: StopInput[] },
  ) {
    if (user.role !== 'ESTABLISHMENT' || !user.establishmentId)
      throw new ForbiddenException('Apenas estabelecimentos podem solicitar.');
    const result = await this.dispatch.transaction(async (tx) => {
      const existing = await tx.deliveryRequest.findUnique({
        where: {
          establishmentId_idempotencyKey: {
            establishmentId: user.establishmentId!,
            idempotencyKey: input.idempotencyKey,
          },
        },
        include: includeDelivery,
      });
      if (existing) {
        if (existing.quoteId !== input.quoteId)
          throw new ConflictException('Chave de idempotência já utilizada em outra cotação.');
        return existing;
      }
      const quote = await tx.priceQuote.findFirst({
        where: { id: input.quoteId, establishmentId: user.establishmentId! },
        include: { establishment: true, delivery: true },
      });
      if (!quote || quote.expiresAt.getTime() <= Date.now() || quote.delivery)
        throw new ConflictException('Cotação indisponível; solicite outra.');
      if (!quote.establishment.active) throw new ForbiddenException('Estabelecimento inativo.');
      const stops = quote.stops as unknown as StopInput[];
      if (input.stops && JSON.stringify(input.stops) !== JSON.stringify(stops))
        throw new BadRequestException('Os destinos precisam corresponder à cotação.');
      const share = Math.floor(quote.totalCents / stops.length);
      const delivery = await tx.deliveryRequest.create({
        data: {
          establishmentId: quote.establishmentId,
          cityId: quote.establishment.cityId,
          quoteId: quote.id,
          totalCents: quote.totalCents,
          pricingSnapshot: quote.pricingSnapshot as Prisma.InputJsonValue,
          idempotencyKey: input.idempotencyKey,
          status: 'BUSCANDO',
          stops: {
            create: stops.map((s, index) => ({
              ...s,
              sequence: index + 1,
              priceCents: share + (index === 0 ? quote.totalCents - share * stops.length : 0),
            })),
          },
        },
        include: includeDelivery,
      });
      await tx.deliveryEvent.create({
        data: { deliveryId: delivery.id, actorId: user.id, type: 'REQUESTED' },
      });
      return delivery;
    });
    // Database reconciliation also covers a crash between commit and Redis enqueue.
    try {
      await this.dispatch.enqueue(result.id);
    } catch {
      /* persisted requests reconciled by worker */
    }
    return this.redact(result);
  }
  async progress(user: Actor, id: string, status: DeliveryStatus) {
    if (user.role !== 'COURIER')
      throw new ForbiddenException('Apenas o entregador associado pode atualizar a execução.');
    return this.dispatch.transaction(async (tx) => {
      const d = await this.get(user, id, tx);
      assertProgress(d.status, status);
      await tx.deliveryRequest.update({ where: { id }, data: { status } });
      if (status === 'AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO') {
        await tx.deliveryStop.updateMany({
          where: { deliveryId: id, completedAt: null },
          data: { completedAt: new Date() },
        });
        await tx.confirmation.create({
          data: { deliveryId: id, userId: user.id, role: 'COURIER', stopCount: d.stops.length },
        });
        await tx.deliveryEvent.create({
          data: { deliveryId: id, actorId: user.id, type: 'ENTREGADOR_CONCLUIU' },
        });
      }
      await tx.deliveryEvent.create({ data: { deliveryId: id, actorId: user.id, type: status } });
      return this.get(user, id, tx);
    });
  }
  async confirm(user: Actor, id: string, stopCount?: number) {
    if (user.role !== 'ESTABLISHMENT')
      throw new ForbiddenException('Apenas o estabelecimento associado pode confirmar.');
    return this.dispatch.transaction(async (tx) => {
      const d = await this.get(user, id, tx);
      if (d.status !== 'AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO')
        throw new ConflictException('Atendimento não está aguardando confirmação.');
      if (stopCount !== undefined && stopCount !== d.stops.length)
        throw new ConflictException('Quantidade de entregas divergente; solicite suporte.');
      if (
        !(await tx.confirmation.findUnique({
          where: { deliveryId_role: { deliveryId: id, role: 'COURIER' } },
        }))
      )
        throw new ConflictException('Entregador ainda não concluiu.');
      await tx.confirmation.create({
        data: { deliveryId: id, userId: user.id, role: 'ESTABLISHMENT', stopCount: d.stops.length },
      });
      await this.finish(tx, d, 'FINALIZADO');
      await tx.deliveryEvent.create({
        data: { deliveryId: id, actorId: user.id, type: 'FINALIZADO' },
      });
      return this.get(user, id, tx);
    });
  }
  async cancel(user: Actor, id: string, reason: string) {
    if (!['ESTABLISHMENT', 'COURIER'].includes(user.role))
      throw new ForbiddenException('Use a intervenção administrativa.');
    return this.dispatch.transaction(async (tx) => {
      const d = await this.get(user, id, tx);
      if (['FINALIZADO', 'CANCELADO', 'CANCELAMENTO_SOLICITADO'].includes(d.status))
        throw new ConflictException('Cancelamento indisponível.');
      if (!d.courierId) {
        await this.closePending(tx, id);
        await this.finish(tx, d, 'CANCELADO');
      } else {
        await tx.cancellationRequest.create({
          data: {
            deliveryId: id,
            requestedById: user.id,
            requestedByRole: user.role,
            reason,
            previousStatus: d.status,
          },
        });
        await tx.deliveryRequest.update({
          where: { id },
          data: { status: 'CANCELAMENTO_SOLICITADO' },
        });
      }
      await tx.deliveryEvent.create({
        data: {
          deliveryId: id,
          actorId: user.id,
          type: 'CANCELLATION_REQUESTED',
          metadata: { reason },
        },
      });
      return this.get(user, id, tx);
    });
  }
  async approveCancel(user: Actor, id: string) {
    if (!['ESTABLISHMENT', 'COURIER'].includes(user.role))
      throw new ForbiddenException('Use a intervenção administrativa.');
    return this.dispatch.transaction(async (tx) => {
      const d = await this.get(user, id, tx);
      const request = d.cancellations[0];
      if (
        d.status !== 'CANCELAMENTO_SOLICITADO' ||
        !request ||
        request.approvedAt ||
        request.requestedByRole === user.role
      )
        throw new ConflictException('A outra parte precisa concordar com a solicitação.');
      await tx.cancellationRequest.update({
        where: { id: request.id },
        data: { approvedAt: new Date(), approvedById: user.id },
      });
      await this.finish(tx, d, 'CANCELADO');
      await tx.deliveryEvent.create({
        data: { deliveryId: id, actorId: user.id, type: 'CANCELLATION_APPROVED' },
      });
      return this.get(user, id, tx);
    });
  }
  async intervene(user: Actor, id: string, action: 'cancel' | 'release', reason: string) {
    if (user.role !== 'SUPER_ADMIN')
      throw new ForbiddenException('Intervenção exclusiva do Super Admin.');
    return this.dispatch.transaction(async (tx) => {
      const d = await this.get(user, id, tx);
      if (['FINALIZADO', 'CANCELADO'].includes(d.status))
        throw new ConflictException('Atendimento já encerrado.');
      if (action === 'release' && !d.courierId)
        throw new ConflictException('Nenhum entregador atribuído.');
      await this.closePending(tx, id);
      await this.finish(tx, d, action === 'cancel' ? 'CANCELADO' : 'FINALIZADO');
      await tx.auditLog.create({
        data: {
          actorId: user.id,
          action: `DELIVERY_${action.toUpperCase()}`,
          entityType: 'DeliveryRequest',
          entityId: id,
          reason,
          metadata: { previousStatus: d.status },
        },
      });
      await tx.deliveryEvent.create({
        data: {
          deliveryId: id,
          actorId: user.id,
          type: 'INTERVENCAO_ADMIN',
          metadata: { action, reason },
        },
      });
      return this.get(user, id, tx);
    });
  }
  private async finish(
    tx: Tx,
    d: { id: string; courierId: string | null },
    status: 'FINALIZADO' | 'CANCELADO',
  ) {
    await tx.deliveryRequest.update({
      where: { id: d.id },
      data: { status, completedAt: new Date() },
    });
    if (d.courierId) {
      const c = await tx.courier.findUniqueOrThrow({ where: { id: d.courierId } });
      await tx.courier.update({
        where: { id: c.id },
        data: { status: c.online ? 'AVAILABLE' : 'OFFLINE' },
      });
    }
  }
  private async closePending(tx: Tx, id: string) {
    const offers = await tx.dispatchOffer.findMany({
      where: { deliveryId: id, status: 'PENDING' },
      include: { courier: true },
    });
    for (const offer of offers) {
      await tx.dispatchOffer.update({
        where: { id: offer.id },
        data: { status: 'REJECTED', respondedAt: new Date() },
      });
      await tx.courier.update({
        where: { id: offer.courierId },
        data: { status: offer.courier.online ? 'AVAILABLE' : 'OFFLINE' },
      });
    }
  }
  async events(user: Actor, id: string) {
    await this.get(user, id);
    return this.db.deliveryEvent.findMany({
      where: { deliveryId: id },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
  }
  async messages(user: Actor, id: string) {
    if (['ADMIN', 'SUPER_ADMIN'].includes(user.role))
      throw new ForbiddenException('Chat administrativo requer acesso justificado e auditado.');
    await this.get(user, id);
    return this.db.chatMessage.findMany({
      where: { deliveryId: id },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
  }
  async message(user: Actor, id: string, text: string) {
    if (['ADMIN', 'SUPER_ADMIN'].includes(user.role))
      throw new ForbiddenException('Chat administrativo requer módulo de acesso justificado.');
    const d = await this.get(user, id);
    if (['FINALIZADO', 'CANCELADO'].includes(d.status) || !d.courierId)
      throw new ConflictException('Chat indisponível para este atendimento.');
    return this.db.chatMessage.create({ data: { deliveryId: id, userId: user.id, text } });
  }
}
