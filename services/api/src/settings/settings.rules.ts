import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { z } from 'zod';

export const scopes = ['GLOBAL', 'CITY', 'ESTABLISHMENT', 'USER'] as const;
export type SettingScope = (typeof scopes)[number];
export interface SettingTarget {
  scope: SettingScope;
  scopeId: string;
}
export interface SettingActor {
  role: string;
  cityId: string | null;
}
const dispatchScopes: readonly SettingScope[] = ['GLOBAL', 'CITY', 'ESTABLISHMENT'];
const allScopes: readonly SettingScope[] = scopes;
export const settingCatalog = {
  'dispatch.offerTimeoutSeconds': {
    label: 'Prazo da oferta em segundos',
    defaultValue: 10,
    schema: z.number().int().min(5).max(60),
    scopes: dispatchScopes,
    effect: 'Novas ofertas; ofertas existentes preservam o prazo registrado.',
  },
  'dispatch.maxWaitSeconds': {
    label: 'Espera máxima na fila em segundos',
    defaultValue: 900,
    schema: z.number().int().min(60).max(3600),
    scopes: dispatchScopes,
    effect: 'Próxima avaliação de atendimentos ainda sem aceite.',
  },
  'support.phone': {
    label: 'Telefone público de suporte',
    defaultValue: '',
    schema: z
      .string()
      .trim()
      .max(25)
      .regex(/^$|^\+?[0-9 ()-]{8,25}$/),
    scopes: allScopes,
    effect: 'Informação pública; não inserir credenciais ou dados sensíveis.',
  },
  'features.optionalProof': {
    label: 'Módulo de comprovante opcional',
    defaultValue: false,
    schema: z.boolean(),
    scopes: allScopes,
    effect:
      'Reserva de configuração. Coleta de comprovantes ainda não implementada; não torna foto, assinatura ou PIN obrigatórios.',
  },
} as const;
export type SettingKey = keyof typeof settingCatalog;
export type SettingValue = number | string | boolean;
export interface SettingEntry extends SettingTarget {
  key: string;
  value: unknown;
  version: number;
}
export interface SettingContext {
  cityId?: string;
  establishmentId?: string;
  userId?: string;
}

export function knownKey(key: string): SettingKey {
  if (!Object.prototype.hasOwnProperty.call(settingCatalog, key))
    throw new BadRequestException(
      'Configuração não permitida. As proteções essenciais não são configuráveis.',
    );
  return key as SettingKey;
}
export function validateSetting(key: string, value: unknown, scope: SettingScope): SettingValue {
  const definition = settingCatalog[knownKey(key)];
  if (!(definition.scopes as readonly SettingScope[]).includes(scope))
    throw new BadRequestException('Esta configuração não aceita o escopo selecionado.');
  const parsed = definition.schema.safeParse(value);
  if (!parsed.success)
    throw new BadRequestException('Valor de configuração inválido ou fora do limite permitido.');
  return parsed.data;
}
export function target(scope: string, scopeId?: string): SettingTarget {
  if (!scopes.includes(scope as SettingScope)) throw new BadRequestException('Escopo inválido.');
  if (scope === 'GLOBAL') {
    if (scopeId && scopeId !== 'global')
      throw new BadRequestException('Escopo global não recebe identificador.');
    return { scope, scopeId: 'global' };
  }
  if (!z.string().uuid().safeParse(scopeId).success)
    throw new BadRequestException('Identificador de escopo inválido.');
  return { scope: scope as SettingScope, scopeId: scopeId! };
}
export function authorizeTarget(
  actor: SettingActor,
  selected: SettingTarget,
  cityId: string | null,
  write = true,
) {
  if (!['SUPER_ADMIN', 'ADMIN'].includes(actor.role))
    throw new ForbiddenException('Acesso exclusivo da administração.');
  if (actor.role === 'SUPER_ADMIN') return;
  if (selected.scope === 'GLOBAL') {
    if (write) throw new ForbiddenException('Somente Super Admin altera configurações globais.');
    return;
  }
  if (!actor.cityId || !cityId || actor.cityId !== cityId)
    throw new ForbiddenException('Escopo fora da cidade autorizada.');
}
export function nextVersion(actual: number, expected: number): number {
  if (!Number.isSafeInteger(expected) || expected < 0)
    throw new BadRequestException('Versão esperada inválida.');
  if (actual !== expected)
    throw new ConflictException('A configuração foi alterada. Atualize antes de salvar.');
  return actual + 1;
}
export function resolveSettings(
  entries: SettingEntry[],
  context: SettingContext = {},
  defaults: Partial<Record<SettingKey, SettingValue>> = {},
) {
  const chain: SettingTarget[] = [target('GLOBAL')];
  if (context.cityId) chain.push(target('CITY', context.cityId));
  if (context.establishmentId) chain.push(target('ESTABLISHMENT', context.establishmentId));
  if (context.userId) chain.push(target('USER', context.userId));
  return Object.fromEntries(
    (Object.keys(settingCatalog) as SettingKey[]).map((key) => {
      let resolved: { value: SettingValue; version: number; source: SettingTarget | null } = {
        value:
          defaults[key] === undefined
            ? settingCatalog[key].defaultValue
            : validateSetting(key, defaults[key], 'GLOBAL'),
        version: 0,
        source: null,
      };
      for (const selected of chain) {
        const found = entries.find(
          (entry) =>
            entry.key === key &&
            entry.scope === selected.scope &&
            entry.scopeId === selected.scopeId,
        );
        if (found)
          resolved = {
            value: validateSetting(key, found.value, selected.scope),
            version: found.version,
            source: selected,
          };
      }
      return [key, resolved];
    }),
  ) as Record<SettingKey, { value: SettingValue; version: number; source: SettingTarget | null }>;
}
