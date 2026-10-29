import {
  Inject,
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../common/prisma.service';
import { Actor } from '../common/auth.types';
const userSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  cityId: true,
  establishmentId: true,
  courierId: true,
  mustChangePassword: true,
  supabaseUserId: true,
  active: true,
  createdAt: true,
} satisfies Prisma.UserSelect;
@Injectable()
export class AdminService {
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {}
  private scope(actor: Actor, cityId: string) {
    if (actor.role !== 'SUPER_ADMIN' && (!actor.cityId || actor.cityId !== cityId))
      throw new ForbiddenException('Esta cidade está fora do seu escopo.');
  }
  private cityWhere(actor: Actor) {
    return actor.role === 'SUPER_ADMIN' ? {} : { cityId: actor.cityId ?? '__none__' };
  }
  private hash(password: string) {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
  }
  cities(actor: Actor) {
    return this.db.city.findMany({
      where: actor.role === 'SUPER_ADMIN' ? {} : { id: actor.cityId ?? '__none__' },
      orderBy: { name: 'asc' },
    });
  }
  async createCity(actor: Actor, data: { name: string; state: string }) {
    if (actor.role !== 'SUPER_ADMIN')
      throw new ForbiddenException('Somente Super Admin pode criar cidades.');
    return this.db.$transaction(async (tx) => {
      const city = await tx.city.create({ data });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'CITY_CREATED', entityType: 'City', entityId: city.id },
      });
      return city;
    });
  }
  establishments(actor: Actor) {
    return this.db.establishment.findMany({
      where: this.cityWhere(actor),
      orderBy: { name: 'asc' },
    });
  }
  couriers(actor: Actor) {
    return this.db.courier.findMany({ where: this.cityWhere(actor), orderBy: { name: 'asc' } });
  }
  users(actor: Actor) {
    return this.db.user.findMany({
      where: this.cityWhere(actor),
      select: userSelect,
      orderBy: { createdAt: 'desc' },
    });
  }
  tariffs(actor: Actor) {
    return this.db.tariff.findMany({
      where: this.cityWhere(actor),
      orderBy: { createdAt: 'desc' },
    });
  }
  async createEstablishment(
    actor: Actor,
    data: {
      name: string;
      cityId: string;
      address: string;
      latitude: number;
      longitude: number;
      email: string;
      password: string;
      responsibleName?: string;
    },
  ) {
    this.scope(actor, data.cityId);
    const city = await this.db.city.findUnique({ where: { id: data.cityId } });
    if (!city?.active) throw new BadRequestException('Cidade não está disponível.');
    const passwordHash = await this.hash(data.password);
    return this.db.$transaction(async (tx) => {
      const establishment = await tx.establishment.create({
        data: {
          name: data.name,
          cityId: data.cityId,
          address: data.address,
          latitude: data.latitude,
          longitude: data.longitude,
        },
      });
      const user = await tx.user.create({
        data: {
          name: data.responsibleName ?? data.name,
          email: data.email.toLowerCase(),
          passwordHash,
          role: Role.ESTABLISHMENT,
          cityId: data.cityId,
          establishmentId: establishment.id,
        },
        select: userSelect,
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'ESTABLISHMENT_CREATED',
          entityType: 'Establishment',
          entityId: establishment.id,
        },
      });
      return { ...establishment, user };
    });
  }
  async createCourier(
    actor: Actor,
    data: { name: string; cityId: string; email: string; password: string },
  ) {
    this.scope(actor, data.cityId);
    const city = await this.db.city.findUnique({ where: { id: data.cityId } });
    if (!city?.active) throw new BadRequestException('Cidade não está disponível.');
    const passwordHash = await this.hash(data.password);
    return this.db.$transaction(async (tx) => {
      const courier = await tx.courier.create({ data: { name: data.name, cityId: data.cityId } });
      const user = await tx.user.create({
        data: {
          name: data.name,
          email: data.email.toLowerCase(),
          passwordHash,
          role: Role.COURIER,
          cityId: data.cityId,
          courierId: courier.id,
        },
        select: userSelect,
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'COURIER_CREATED',
          entityType: 'Courier',
          entityId: courier.id,
        },
      });
      return { ...courier, user };
    });
  }
  async createAdmin(
    actor: Actor,
    data: { name: string; cityId: string; email: string; password: string },
  ) {
    if (actor.role !== 'SUPER_ADMIN')
      throw new ForbiddenException('Somente Super Admin pode criar administradores.');
    const passwordHash = await this.hash(data.password);
    return this.db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          name: data.name,
          email: data.email.toLowerCase(),
          passwordHash,
          role: Role.ADMIN,
          cityId: data.cityId,
        },
        select: userSelect,
      });
      await tx.auditLog.create({
        data: { actorId: actor.id, action: 'ADMIN_CREATED', entityType: 'User', entityId: user.id },
      });
      return user;
    });
  }
  async createTariff(
    actor: Actor,
    data: { cityId: string; baseCents: number; perKmCents: number },
  ) {
    this.scope(actor, data.cityId);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "City" WHERE id = ${data.cityId} FOR UPDATE`;
      await tx.tariff.updateMany({
        where: { cityId: data.cityId, active: true },
        data: { active: false },
      });
      const tariff = await tx.tariff.create({ data });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'TARIFF_CREATED',
          entityType: 'Tariff',
          entityId: tariff.id,
          metadata: { baseCents: data.baseCents, perKmCents: data.perKmCents },
        },
      });
      return tariff;
    });
  }
  async setRelationship(
    actor: Actor,
    data: { establishmentId: string; courierId: string; reason?: string; priority?: number },
    kind: 'block' | 'preference',
  ) {
    const establishment = await this.db.establishment.findUnique({
      where: { id: data.establishmentId },
    });
    const courier = await this.db.courier.findUnique({ where: { id: data.courierId } });
    if (!establishment || !courier) throw new NotFoundException('Cadastro não encontrado.');
    this.scope(actor, establishment.cityId);
    this.scope(actor, courier.cityId);
    if (establishment.cityId !== courier.cityId)
      throw new BadRequestException('Os cadastros devem pertencer à mesma cidade.');
    return this.db.$transaction(async (tx) => {
      const key = {
        establishmentId_courierId: {
          establishmentId: data.establishmentId,
          courierId: data.courierId,
        },
      };
      const relationship =
        kind === 'block'
          ? await tx.courierBlock.upsert({
              where: key,
              create: {
                establishmentId: data.establishmentId,
                courierId: data.courierId,
                reason: data.reason!,
              },
              update: { reason: data.reason! },
            })
          : await tx.courierPreference.upsert({
              where: key,
              create: {
                establishmentId: data.establishmentId,
                courierId: data.courierId,
                priority: data.priority ?? 0,
              },
              update: { priority: data.priority ?? 0 },
            });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: kind === 'block' ? 'COURIER_BLOCKED' : 'COURIER_PREFERRED',
          entityType: 'Establishment',
          entityId: establishment.id,
          reason: data.reason,
          metadata: { courierId: courier.id },
        },
      });
      return relationship;
    });
  }
  async resetPassword(
    actor: Actor,
    id: string,
    data: { password: string; reason: string; confirm: true },
  ) {
    const target = await this.db.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Usuário não encontrado.');
    if (target.role === 'SUPER_ADMIN')
      throw new ForbiddenException(
        'Super Admin só pode alterar a própria senha pelo fluxo autenticado.',
      );
    if (target.supabaseUserId)
      throw new ForbiddenException(
        'Esta conta usa Supabase. Use o fluxo de recuperação de senha do provedor; uma senha Argon local não altera a credencial externa.',
      );
    if (!target.cityId) throw new ForbiddenException('Usuário sem escopo.');
    this.scope(actor, target.cityId);
    const passwordHash = await this.hash(data.password);
    await this.db.$transaction([
      this.db.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true } }),
      this.db.session.updateMany({ where: { userId: id }, data: { revokedAt: new Date() } }),
      this.db.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'PASSWORD_RESET',
          entityType: 'User',
          entityId: id,
          reason: data.reason,
        },
      }),
    ]);
    return { message: 'Senha temporária definida. Todas as sessões foram revogadas.' };
  }
  async audit(actor: Actor) {
    if (actor.role !== 'SUPER_ADMIN')
      throw new ForbiddenException('A auditoria global exige Super Admin.');
    return this.db.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
  }
}
