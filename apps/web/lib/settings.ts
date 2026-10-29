export const settingsDefinitions = {
  'dispatch.offerTimeoutSeconds': { kind: 'number', min: 5, max: 60 },
  'dispatch.maxWaitSeconds': { kind: 'number', min: 60, max: 3600 },
  'support.phone': { kind: 'string', maxLength: 25 },
  'features.optionalProof': { kind: 'boolean', reserved: true },
} as const;
export type SettingKey = keyof typeof settingsDefinitions;
export type SettingValue = number | string | boolean;
export type SettingScope = 'GLOBAL' | 'CITY';
export type SettingTarget = { scope: SettingScope; scopeId?: string };
export type SettingCatalog = {
  key: string;
  label: string;
  defaultValue: SettingValue;
  scopes: string[];
  effect: string;
};
export type SettingHead = {
  key: string;
  value: SettingValue;
  version: number;
  scope: string;
  scopeId: string;
};
export type SettingEffective = {
  value: SettingValue;
  version: number;
  source: { scope: string; scopeId: string } | null;
};
export type SettingRevision = SettingHead & {
  id: string;
  actorId: string;
  reason: string;
  createdAt: string;
  rollbackOfVersion?: number | null;
};
export function isSettingKey(value: string): value is SettingKey {
  return Object.hasOwn(settingsDefinitions, value);
}
export function settingsQuery(target: SettingTarget) {
  const query = new URLSearchParams({ scope: target.scope });
  if (target.scope === 'CITY') {
    if (!target.scopeId) throw new Error('Selecione uma cidade para consultar a configuração.');
    query.set('scopeId', target.scopeId);
  }
  return query.toString();
}
export function settingValue(key: SettingKey, value: FormDataEntryValue | null): SettingValue {
  const definition = settingsDefinitions[key];
  if (definition.kind === 'boolean') return value === 'on';
  if (definition.kind === 'number') {
    if (typeof value !== 'string' || !value.trim()) throw new Error('Informe um número inteiro.');
    const number = Number(value);
    if (!Number.isInteger(number) || number < definition.min || number > definition.max)
      throw new Error(`Informe um inteiro de ${definition.min} a ${definition.max}.`);
    return number;
  }
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length > definition.maxLength || !/^$|^\+?[0-9 ()-]{8,25}$/.test(text))
    throw new Error('Informe um telefone válido de até 25 caracteres ou deixe em branco.');
  return text;
}
export function displaySetting(value: SettingValue) {
  return typeof value === 'boolean'
    ? value
      ? 'Sim (reserva de configuração)'
      : 'Não'
    : value === ''
      ? 'Não informado'
      : String(value);
}
export function sourceLabel(source: SettingEffective['source']) {
  return source === null
    ? 'Padrão da operação'
    : source.scope === 'GLOBAL'
      ? 'Configuração global'
      : source.scope === 'CITY'
        ? 'Configuração da cidade'
        : 'Configuração específica';
}
