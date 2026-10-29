import { describe, expect, it, vi } from 'vitest';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import {
  authorizeTarget,
  knownKey,
  nextVersion,
  resolveSettings,
  target,
  validateSetting,
} from '../src/settings/settings.rules';
import type { Actor } from '../src/common/auth.types';
import type { PrismaService } from '../src/common/prisma.service';
import { SettingsService } from '../src/settings/settings.service';

// Unit tests require no generated client or database engine. Persistence and
// constraints are separately exercised by SQL/integration validation.
vi.mock('@prisma/client', () => ({
  PrismaClient: class {},
  Prisma: { PrismaClientKnownRequestError: class extends Error {} },
}));

const city = '00000000-0000-4000-8000-000000000001';
const otherCity = '00000000-0000-4000-8000-000000000002';
const establishment = '00000000-0000-4000-8000-000000000003';
const user = '00000000-0000-4000-8000-000000000004';
describe('configurações dinâmicas: whitelist, escopo e versionamento', () => {
  it('não permite criar funcionalidades arbitrárias nem desligar proteções essenciais', () => {
    for (const key of [
      'auth.enabled',
      'audit.enabled',
      'delivery.requireBilateralConfirmation',
      'arbitrary.code',
      '__proto__',
      'constructor',
    ])
      expect(() => knownKey(key)).toThrow(BadRequestException);
  });
  it('valida limites de despacho e tipos sem coerção de texto', () => {
    expect(validateSetting('dispatch.offerTimeoutSeconds', 10, 'CITY')).toBe(10);
    expect(validateSetting('dispatch.maxWaitSeconds', 3600, 'GLOBAL')).toBe(3600);
    for (const value of [4, 61, 10.5, '10', null, {}, true])
      expect(() => validateSetting('dispatch.offerTimeoutSeconds', value, 'GLOBAL')).toThrow(
        BadRequestException,
      );
    for (const value of [59, 3601])
      expect(() => validateSetting('dispatch.maxWaitSeconds', value, 'CITY')).toThrow();
    expect(() => validateSetting('dispatch.offerTimeoutSeconds', 10, 'USER')).toThrow();
    expect(() => validateSetting('features.optionalProof', 'false', 'GLOBAL')).toThrow();
    expect(validateSetting('features.optionalProof', false, 'USER')).toBe(false);
    expect(validateSetting('support.phone', ' +55 (11) 99999-1234 ', 'GLOBAL')).toBe(
      '+55 (11) 99999-1234',
    );
    expect(() => validateSetting('support.phone', 'token_secreto', 'GLOBAL')).toThrow();
  });
  it('exige identificadores válidos e representação global canônica', () => {
    expect(target('GLOBAL')).toEqual({ scope: 'GLOBAL', scopeId: 'global' });
    expect(() => target('GLOBAL', city)).toThrow();
    expect(() => target('CITY')).toThrow();
    expect(() => target('CITY', 'qualquer')).toThrow();
    expect(() => target('SYSTEM')).toThrow();
  });
  it('Admin só altera sua cidade; apenas Super Admin altera o escopo global', () => {
    const actor = { role: 'ADMIN', cityId: city };
    expect(() => authorizeTarget(actor, target('CITY', city), city)).not.toThrow();
    expect(() =>
      authorizeTarget(actor, target('ESTABLISHMENT', establishment), city),
    ).not.toThrow();
    expect(() => authorizeTarget(actor, target('USER', user), otherCity)).toThrow(
      ForbiddenException,
    );
    expect(() => authorizeTarget(actor, target('CITY', otherCity), otherCity)).toThrow(
      ForbiddenException,
    );
    expect(() => authorizeTarget(actor, target('GLOBAL'), null)).toThrow(ForbiddenException);
    expect(() => authorizeTarget(actor, target('GLOBAL'), null, false)).not.toThrow();
    expect(() =>
      authorizeTarget({ role: 'SUPER_ADMIN', cityId: null }, target('GLOBAL'), null),
    ).not.toThrow();
    for (const role of ['COURIER', 'ESTABLISHMENT'])
      expect(() =>
        authorizeTarget({ role, cityId: city }, target('CITY', city), city, false),
      ).toThrow();
  });
  it('controle otimista rejeita edição ou rollback com versão desatualizada', () => {
    expect(nextVersion(0, 0)).toBe(1);
    expect(nextVersion(3, 3)).toBe(4);
    expect(() => nextVersion(3, 2)).toThrow(ConflictException);
    expect(() => nextVersion(3, -1)).toThrow(BadRequestException);
  });
  it('herda global → cidade → estabelecimento → usuário, preservando falsos e origem', () => {
    const entries = [
      { ...target('GLOBAL'), key: 'support.phone', value: '+55 11 1111-1111', version: 1 },
      { ...target('CITY', city), key: 'support.phone', value: '+55 11 2222-2222', version: 2 },
      {
        ...target('ESTABLISHMENT', establishment),
        key: 'support.phone',
        value: '+55 11 3333-3333',
        version: 3,
      },
      { ...target('USER', user), key: 'support.phone', value: '+55 11 4444-4444', version: 4 },
      { ...target('GLOBAL'), key: 'features.optionalProof', value: true, version: 1 },
      { ...target('USER', user), key: 'features.optionalProof', value: false, version: 2 },
      { ...target('CITY', otherCity), key: 'dispatch.offerTimeoutSeconds', value: 60, version: 1 },
    ];
    const resolved = resolveSettings(entries, {
      cityId: city,
      establishmentId: establishment,
      userId: user,
    });
    expect(resolved['support.phone']).toEqual({
      value: '+55 11 4444-4444',
      version: 4,
      source: target('USER', user),
    });
    expect(resolved['features.optionalProof'].value).toBe(false);
    expect(resolved['dispatch.offerTimeoutSeconds']).toEqual({
      value: 10,
      version: 0,
      source: null,
    });
    expect(resolveSettings(entries, { cityId: city })['support.phone'].value).toBe(
      '+55 11 2222-2222',
    );
    expect(resolveSettings(entries)['support.phone'].value).toBe('+55 11 1111-1111');
  });
  it('aplica defaults de runtime sem sobrepor valores persistidos', () => {
    expect(
      resolveSettings([], {}, { 'dispatch.offerTimeoutSeconds': 15 })[
        'dispatch.offerTimeoutSeconds'
      ].value,
    ).toBe(15);
    const persisted = [
      { ...target('CITY', city), key: 'dispatch.offerTimeoutSeconds', value: 20, version: 2 },
    ];
    expect(
      resolveSettings(persisted, { cityId: city }, { 'dispatch.offerTimeoutSeconds': 15 })[
        'dispatch.offerTimeoutSeconds'
      ].value,
    ).toBe(20);
    expect(() => resolveSettings([], {}, { 'dispatch.offerTimeoutSeconds': 0 })).toThrow();
  });
});

function repository() {
  let head: any = null;
  const revisions: any[] = [];
  const audit: any[] = [];
  const db: any = {
    city: { findUnique: async ({ where }: any) => ({ id: where.id }) },
    establishment: { findUnique: async () => ({ cityId: otherCity }) },
    settingHead: {
      findUnique: async () => head && structuredClone(head),
      create: async ({ data }: any) => {
        head = { id: 'head', ...data };
        return head;
      },
      updateMany: async ({ where, data }: any) => {
        if (!head || head.version !== where.version) return { count: 0 };
        head = { ...head, ...data };
        return { count: 1 };
      },
      findUniqueOrThrow: async () => structuredClone(head),
    },
    settingRevision: {
      findUnique: async ({ where }: any) =>
        revisions.find((row) => row.version === where.scope_scopeId_key_version.version) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `revision-${revisions.length + 1}`, ...data };
        revisions.push(structuredClone(row));
        return row;
      },
    },
    auditLog: {
      create: async ({ data }: any) => {
        audit.push(structuredClone(data));
        return data;
      },
    },
  };
  db.$transaction = async (action: (tx: any) => Promise<unknown>) => action(db);
  return { db: db as PrismaService, revisions, audit };
}
describe('serviço de configurações com repositório em memória (sem banco real)', () => {
  const actor = { id: user, role: 'SUPER_ADMIN', cityId: null } as Actor;
  const selected = target('GLOBAL');
  const key = 'dispatch.offerTimeoutSeconds';
  const reason = 'Ajuste autorizado da operação';
  it('rollback adiciona uma nova versão, mantém o histórico anterior e registra ator/motivo', async () => {
    const { db, revisions, audit } = repository();
    const settings = new SettingsService(db);
    await settings.update(actor, key, selected, { value: 10, expectedVersion: 0, reason });
    await settings.update(actor, key, selected, { value: 15, expectedVersion: 1, reason });
    const prior = structuredClone(revisions);
    const restored = await settings.rollback(actor, key, selected, {
      toVersion: 1,
      expectedVersion: 2,
      reason: 'Retorno ao prazo previamente aprovado',
    });
    expect(restored).toMatchObject({ value: 10, version: 3 });
    expect(revisions.slice(0, 2)).toEqual(prior);
    expect(revisions[2]).toMatchObject({
      version: 3,
      value: 10,
      rollbackOfVersion: 1,
      actorId: user,
      reason: 'Retorno ao prazo previamente aprovado',
    });
    expect(audit).toHaveLength(3);
    expect(audit[2]).toMatchObject({
      actorId: user,
      action: 'SETTING_ROLLED_BACK',
      reason: 'Retorno ao prazo previamente aprovado',
    });
  });
  it('edição desatualizada e rollback de versão inexistente não geram histórico', async () => {
    const { db, revisions, audit } = repository();
    const settings = new SettingsService(db);
    await settings.update(actor, key, selected, { value: 10, expectedVersion: 0, reason });
    await expect(
      settings.update(actor, key, selected, { value: 15, expectedVersion: 0, reason }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      settings.rollback(actor, key, selected, { toVersion: 9, expectedVersion: 1, reason }),
    ).rejects.toThrow('não encontrada');
    expect(revisions).toHaveLength(1);
    expect(audit).toHaveLength(1);
  });
  it('escopo do estabelecimento vem do cadastro persistido, sem confiar na cidade do administrador', async () => {
    const { db, revisions } = repository();
    const settings = new SettingsService(db);
    await expect(
      settings.update(
        { ...actor, role: 'ADMIN', cityId: city },
        key,
        target('ESTABLISHMENT', establishment),
        { value: 10, expectedVersion: 0, reason },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(revisions).toHaveLength(0);
  });
});
