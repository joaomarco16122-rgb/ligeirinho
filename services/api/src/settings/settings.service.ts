import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Actor } from '../common/auth.types';
import { PrismaService } from '../common/prisma.service';
import {
  authorizeTarget,
  knownKey,
  nextVersion,
  resolveSettings,
  SettingContext,
  SettingKey,
  SettingTarget,
  SettingValue,
  target,
  validateSetting,
} from './settings.rules';

@Injectable()
export class SettingsService {
  constructor(private readonly db: PrismaService) {}

  private async authorize(actor: Actor, selected: SettingTarget, write = true) {
    // Reject unauthorized global writes before any lookup; do not trust client-provided city IDs.
    if (selected.scope === 'GLOBAL') {
      authorizeTarget(actor, selected, null, write);
      return;
    }
    let cityId: string | null;
    let exists: boolean;
    if (selected.scope === 'CITY') {
      const row = await this.db.city.findUnique({
        where: { id: selected.scopeId },
        select: { id: true },
      });
      cityId = row?.id ?? null;
      exists = !!row;
    } else if (selected.scope === 'ESTABLISHMENT') {
      const row = await this.db.establishment.findUnique({
        where: { id: selected.scopeId },
        select: { cityId: true },
      });
      cityId = row?.cityId ?? null;
      exists = !!row;
    } else {
      const row = await this.db.user.findUnique({
        where: { id: selected.scopeId },
        select: { cityId: true },
      });
      cityId = row?.cityId ?? null;
      exists = !!row;
    }
    authorizeTarget(actor, selected, cityId, write);
    if (!exists) throw new NotFoundException('Escopo não encontrado.');
  }

  async list(actor: Actor, selected: SettingTarget) {
    await this.authorize(actor, selected, false);
    return this.db.settingHead.findMany({ where: selected, orderBy: { key: 'asc' } });
  }
  async history(actor: Actor, key: string, selected: SettingTarget) {
    knownKey(key);
    await this.authorize(actor, selected, false);
    return this.db.settingRevision.findMany({
      where: { ...selected, key },
      orderBy: { version: 'desc' },
      take: 100,
    });
  }
  private async context(actor: Actor, input: SettingContext): Promise<SettingContext> {
    const result = { ...input };
    if (result.userId) {
      const user = await this.db.user.findUnique({
        where: { id: result.userId },
        select: { cityId: true, establishmentId: true },
      });
      if (!user) throw new NotFoundException('Usuário não encontrado.');
      if (
        (result.cityId && result.cityId !== user.cityId) ||
        (result.establishmentId && result.establishmentId !== user.establishmentId)
      )
        throw new ConflictException('Os escopos não pertencem ao mesmo contexto.');
      result.cityId = user.cityId ?? undefined;
      result.establishmentId = user.establishmentId ?? undefined;
      await this.authorize(actor, target('USER', result.userId), false);
    }
    if (result.establishmentId) {
      const establishment = await this.db.establishment.findUnique({
        where: { id: result.establishmentId },
        select: { cityId: true },
      });
      if (!establishment) throw new NotFoundException('Estabelecimento não encontrado.');
      if (result.cityId && result.cityId !== establishment.cityId)
        throw new ConflictException('Os escopos não pertencem à mesma cidade.');
      result.cityId = establishment.cityId;
      await this.authorize(actor, target('ESTABLISHMENT', result.establishmentId), false);
    }
    if (result.cityId) await this.authorize(actor, target('CITY', result.cityId), false);
    else if (!result.userId) await this.authorize(actor, target('GLOBAL'), false);
    return result;
  }
  async effective(actor: Actor, input: SettingContext) {
    return this.resolve(await this.context(actor, input));
  }
  /** Internal use only: callers derive this context from persisted domain records. */
  async resolve(
    context: SettingContext = {},
    defaults: Partial<Record<SettingKey, SettingValue>> = {},
    client: Prisma.TransactionClient = this.db,
  ) {
    const OR: SettingTarget[] = [target('GLOBAL')];
    if (context.cityId) OR.push(target('CITY', context.cityId));
    if (context.establishmentId) OR.push(target('ESTABLISHMENT', context.establishmentId));
    if (context.userId) OR.push(target('USER', context.userId));
    const entries = await client.settingHead.findMany({ where: { OR } });
    return resolveSettings(
      entries.map((entry) => ({ ...entry, ...target(entry.scope, entry.scopeId) })),
      context,
      {
        'dispatch.offerTimeoutSeconds': Math.min(
          60,
          Math.max(5, Number(process.env.OFFER_TTL_SECONDS) || 10),
        ),
        'dispatch.maxWaitSeconds': Math.min(
          3600,
          Math.max(60, Number(process.env.WAIT_MAX_SECONDS) || 900),
        ),
        ...defaults,
      },
    );
  }
  async update(
    actor: Actor,
    key: string,
    selected: SettingTarget,
    input: { value: unknown; expectedVersion: number; reason: string },
  ) {
    const safeKey = knownKey(key);
    const value = validateSetting(safeKey, input.value, selected.scope);
    await this.authorize(actor, selected);
    return this.write(actor, safeKey, selected, { ...input, value });
  }
  async rollback(
    actor: Actor,
    key: string,
    selected: SettingTarget,
    input: { toVersion: number; expectedVersion: number; reason: string },
  ) {
    const safeKey = knownKey(key);
    await this.authorize(actor, selected);
    const revision = await this.db.settingRevision.findUnique({
      where: { scope_scopeId_key_version: { ...selected, key: safeKey, version: input.toVersion } },
    });
    if (!revision) throw new NotFoundException('Versão de destino não encontrada.');
    const value = validateSetting(safeKey, revision.value, selected.scope);
    return this.write(actor, safeKey, selected, {
      ...input,
      value,
      rollbackOfVersion: input.toVersion,
    });
  }
  private async write(
    actor: Actor,
    key: SettingKey,
    selected: SettingTarget,
    input: {
      value: SettingValue;
      expectedVersion: number;
      reason: string;
      rollbackOfVersion?: number;
    },
  ) {
    try {
      return await this.db.$transaction(async (tx) => {
        const where = { scope_scopeId_key: { ...selected, key } };
        const current = await tx.settingHead.findUnique({ where });
        const version = nextVersion(current?.version ?? 0, input.expectedVersion);
        if (current) {
          const updated = await tx.settingHead.updateMany({
            where: { id: current.id, version: input.expectedVersion },
            data: { value: input.value, version },
          });
          if (updated.count !== 1)
            throw new ConflictException('A configuração foi alterada. Atualize antes de salvar.');
        } else
          await tx.settingHead.create({ data: { ...selected, key, value: input.value, version } });
        const revision = await tx.settingRevision.create({
          data: {
            ...selected,
            key,
            version,
            value: input.value,
            actorId: actor.id,
            reason: input.reason,
            rollbackOfVersion: input.rollbackOfVersion,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: input.rollbackOfVersion ? 'SETTING_ROLLED_BACK' : 'SETTING_UPDATED',
            entityType: 'Setting',
            entityId: revision.id,
            reason: input.reason,
            metadata: {
              key,
              ...selected,
              version,
              rollbackOfVersion: input.rollbackOfVersion ?? null,
            },
          },
        });
        return tx.settingHead.findUniqueOrThrow({ where });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('A configuração foi alterada. Atualize antes de salvar.');
      throw error;
    }
  }
}
