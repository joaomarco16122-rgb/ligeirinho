import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../src/common/prisma.service';
import { DispatchService } from '../src/dispatch/dispatch.service';
import { DeliveryService } from '../src/deliveries/delivery.service';
import { Actor } from '../src/common/auth.types';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../src/auth/auth.service';
import * as argon2 from 'argon2';
const enabled = process.env.RUN_INTEGRATION === '1';
describe.skipIf(!enabled)('PostgreSQL + Redis: concorrência, privacidade e ciclo bilateral', () => {
  let db: PrismaService,
    admin: PrismaClient,
    dispatch: DispatchService,
    deliveries: DeliveryService,
    auth: AuthService;
  let establishment: Actor, other: Actor, courier: Actor, courier2: Actor, cityId: string;
  const schema = 'test_' + randomUUID().replaceAll('-', '');
  const queue = 'integration-' + randomUUID();
  const password = 'TemporariaTeste!493';
  function actor(user: any): Actor {
    return { ...user, sessionId: 'test-session' };
  }
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL obrigatório para integração');
    admin = new PrismaClient();
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`);
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set('schema', schema);
    execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: url.toString() },
      stdio: 'pipe',
    });
    db = new PrismaService({ datasourceUrl: url.toString() });
    await db.$connect();
    process.env.DISPATCH_QUEUE_NAME = queue;
    dispatch = new DispatchService(db);
    deliveries = new DeliveryService(db, dispatch);
    auth = new AuthService(
      db,
      new JwtService({ secret: 'integration-only-nonproduction-secret-min32' }),
    );
    const city = await db.city.create({ data: { name: 'Integração ' + schema, state: 'SP' } });
    cityId = city.id;
    const e = await db.establishment.create({
      data: { name: 'Cozinha', cityId, address: 'Rua A, 1', latitude: -23.55, longitude: -46.63 },
    });
    const e2 = await db.establishment.create({
      data: {
        name: 'Outra cozinha',
        cityId,
        address: 'Rua B, 2',
        latitude: -23.55,
        longitude: -46.63,
      },
    });
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await db.user.create({
      data: {
        name: 'Loja',
        email: `loja-${schema}@example.test`,
        passwordHash,
        role: 'ESTABLISHMENT',
        cityId,
        establishmentId: e.id,
        mustChangePassword: false,
      },
    });
    establishment = actor(user);
    other = actor(
      await db.user.create({
        data: {
          name: 'Outra',
          email: `outra-${schema}@example.test`,
          passwordHash,
          role: 'ESTABLISHMENT',
          cityId,
          establishmentId: e2.id,
          mustChangePassword: false,
        },
      }),
    );
    for (let i = 0; i < 2; i++) {
      const c = await db.courier.create({
        data: {
          name: 'Entregador ' + i,
          cityId,
          status: 'AVAILABLE',
          online: true,
          latitude: -23.55 - i * 0.01,
          longitude: -46.63,
          locationAt: new Date(),
        },
      });
      const u = actor(
        await db.user.create({
          data: {
            name: c.name,
            email: `c${i}-${schema}@example.test`,
            passwordHash,
            role: 'COURIER',
            cityId,
            courierId: c.id,
            mustChangePassword: false,
          },
        }),
      );
      if (i === 0) courier = u;
      else courier2 = u;
    }
    await db.tariff.create({ data: { cityId, baseCents: 500, perKmCents: 200 } });
  }, 60000);
  afterAll(async () => {
    if (dispatch) {
      await (dispatch as any).queue.obliterate({ force: true });
      await dispatch.onModuleDestroy();
    }
    await db?.$disconnect();
    if (admin) {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.$disconnect();
    }
  });
  async function request(key = randomUUID()) {
    const stops = [
      { address: 'Destino A', latitude: -23.56, longitude: -46.63 },
      { address: 'Destino B', latitude: -23.57, longitude: -46.64 },
    ];
    const quote = await deliveries.quote(establishment, stops);
    return deliveries.create(establishment, { quoteId: quote.id, idempotencyKey: key });
  }
  it('isola estabelecimento e congela cotação/idempotência', async () => {
    const d = await request();
    const same = await deliveries.create(establishment, {
      quoteId: d.quoteId,
      idempotencyKey: d.idempotencyKey,
    });
    expect(same.id).toBe(d.id);
    expect(d.stops).toHaveLength(2);
    expect(d.stops.reduce((s, x) => s + x.priceCents, 0)).toBe(d.totalCents);
    await expect(deliveries.read(other, d.id)).rejects.toThrow();
    await deliveries.cancel(establishment, d.id, 'Cancelamento de teste antes de aceite');
  });
  it('serializa oferta/aceite, impede entregador ocupado e exige confirmação bilateral', async () => {
    const d = await request();
    const [first, duplicate] = await Promise.all([
      dispatch.dispatch(d.id),
      dispatch.dispatch(d.id),
    ]);
    const offer = first || duplicate;
    expect(offer).toBeTruthy();
    expect(await db.dispatchOffer.count({ where: { deliveryId: d.id, status: 'PENDING' } })).toBe(
      1,
    );
    const selected = offer!.courierId === courier.courierId ? courier : courier2;
    const accepted = await Promise.allSettled([
      dispatch.respond(offer!.id, selected.courierId!, true),
      dispatch.respond(offer!.id, selected.courierId!, true),
    ]);
    expect(accepted.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(
      (await db.courier.findUniqueOrThrow({ where: { id: selected.courierId! } })).status,
    ).toBe('BUSY');
    const next = await request();
    const nextOffer = await dispatch.dispatch(next.id);
    expect(nextOffer?.courierId).not.toBe(selected.courierId);
    await deliveries.cancel(establishment, next.id, 'Cancelamento teste oferta sem aceite');
    for (const status of [
      'A_CAMINHO_COLETA',
      'NO_ESTABELECIMENTO',
      'EM_ENTREGA',
      'AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO',
    ] as const)
      await deliveries.progress(selected, d.id, status);
    expect(
      (await db.courier.findUniqueOrThrow({ where: { id: selected.courierId! } })).status,
    ).toBe('BUSY');
    await expect(deliveries.progress(selected, d.id, 'FINALIZADO')).rejects.toThrow();
    await expect(deliveries.confirm(other, d.id, 2)).rejects.toThrow();
    const final = await deliveries.confirm(establishment, d.id, 2);
    expect(final.status).toBe('FINALIZADO');
    expect(
      (await db.courier.findUniqueOrThrow({ where: { id: selected.courierId! } })).status,
    ).toBe('AVAILABLE');
    const read = await deliveries.create(establishment, {
      quoteId: d.quoteId,
      idempotencyKey: d.idempotencyKey,
    });
    expect(read.courier?.latitude).toBeNull();
  });
  it('expiração reexecutável encaminha próximo e vence corrida com aceite', async () => {
    const d = await request();
    const offer = await dispatch.dispatch(d.id);
    expect(offer).toBeTruthy();
    await db.dispatchOffer.update({
      where: { id: offer!.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    const results = await Promise.allSettled([
      dispatch.expire(offer!.id),
      dispatch.respond(offer!.id, offer!.courierId, true),
      dispatch.expire(offer!.id),
    ]);
    expect(results[1].status).toBe('rejected');
    expect((await db.dispatchOffer.findUniqueOrThrow({ where: { id: offer!.id } })).status).toBe(
      'EXPIRED',
    );
    const next = await dispatch.dispatch(d.id);
    expect(next?.courierId).not.toBe(offer!.courierId);
    await deliveries.cancel(establishment, d.id, 'Encerramento de cenário de expiração');
  });
  it('cancelamento depois de aceite só libera por acordo da outra parte', async () => {
    const d = await request();
    const offer = await dispatch.dispatch(d.id);
    const selected = offer!.courierId === courier.courierId ? courier : courier2;
    await dispatch.respond(offer!.id, selected.courierId!, true);
    const pending = await deliveries.cancel(selected, d.id, 'Pneu furado durante o atendimento');
    expect(pending.status).toBe('CANCELAMENTO_SOLICITADO');
    await expect(deliveries.approveCancel(selected, d.id)).rejects.toThrow();
    expect(
      (await db.courier.findUniqueOrThrow({ where: { id: selected.courierId! } })).status,
    ).toBe('BUSY');
    expect((await deliveries.approveCancel(establishment, d.id)).status).toBe('CANCELADO');
  });
  it('refresh rotativo rejeita replay e revoga sessão; senha nunca retorna no perfil', async () => {
    const login = await auth.login(establishment.email, password);
    expect(login.user).not.toHaveProperty('passwordHash');
    const next = await auth.refresh(login.refreshToken);
    expect(next.refreshToken).not.toBe(login.refreshToken);
    await expect(auth.refresh(login.refreshToken)).rejects.toThrow();
    await expect(auth.verifyAccess(next.accessToken)).rejects.toThrow();
  });
  it('auditoria persistente bloqueia alteração e remoção', async () => {
    const audit = await db.auditLog.create({
      data: { actorId: establishment.id, action: 'TEST', entityType: 'Test', entityId: schema },
    });
    await expect(
      db.auditLog.update({ where: { id: audit.id }, data: { action: 'CHANGED' } }),
    ).rejects.toThrow();
    await expect(db.auditLog.delete({ where: { id: audit.id } })).rejects.toThrow();
  });
});
