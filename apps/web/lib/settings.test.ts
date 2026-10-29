import { describe, expect, it } from 'vitest';
import {
  displaySetting,
  isSettingKey,
  settingsDefinitions,
  settingsQuery,
  settingValue,
  sourceLabel,
} from './settings';

const cityId = '22b49d80-5735-4a23-9105-92fed76d34ca';

describe('Contrato do painel de configurações', () => {
  it('aceita somente chaves próprias do catálogo, sem herdar propriedades de protótipo', () => {
    for (const key of Object.keys(settingsDefinitions)) expect(isSettingKey(key)).toBe(true);
    for (const key of [
      '__proto__',
      'constructor',
      'prototype',
      'toString',
      'valueOf',
      'hasOwnProperty',
      'security.disableAuth',
      'dispatch.offerTimeoutSeconds.__proto__',
    ]) {
      expect(isSettingKey(key)).toBe(false);
    }
    expect(Object.prototype).not.toHaveProperty('security.disableAuth');
  });

  it('consulta GLOBAL sem enviar identificador, mesmo se sobrar um ID de seleção anterior', () => {
    const query = new URLSearchParams(settingsQuery({ scope: 'GLOBAL', scopeId: cityId }));
    expect(query.get('scope')).toBe('GLOBAL');
    expect(query.has('scopeId')).toBe(false);
    expect([...query.keys()]).toEqual(['scope']);
  });

  it('exige seleção de cidade e preserva o identificador no contrato CITY', () => {
    expect(() => settingsQuery({ scope: 'CITY' })).toThrow('Selecione uma cidade');
    expect(() => settingsQuery({ scope: 'CITY', scopeId: '' })).toThrow('Selecione uma cidade');
    const query = new URLSearchParams(settingsQuery({ scope: 'CITY', scopeId: cityId }));
    expect(Object.fromEntries(query)).toEqual({ scope: 'CITY', scopeId: cityId });
  });

  it('codifica IDs em vez de permitir que seus caracteres injetem outro parâmetro', () => {
    const query = new URLSearchParams(
      settingsQuery({ scope: 'CITY', scopeId: `${cityId}&scope=GLOBAL` }),
    );
    expect(query.getAll('scope')).toEqual(['CITY']);
    expect(query.get('scopeId')).toBe(`${cityId}&scope=GLOBAL`);
    // A validação de UUID e a autorização do identificador continuam obrigatórias no backend.
  });

  it.each([
    ['dispatch.offerTimeoutSeconds', '5', 5],
    ['dispatch.offerTimeoutSeconds', '60', 60],
    ['dispatch.maxWaitSeconds', '60', 60],
    ['dispatch.maxWaitSeconds', '3600', 3600],
  ] as const)(
    'serializa o limite válido de %s como número JSON, não como texto (%s)',
    (key, input, expected) => {
      const value = settingValue(key, input);
      expect(value).toBe(expected);
      expect(JSON.parse(JSON.stringify({ value })).value).toBe(expected);
      expect(typeof value).toBe('number');
    },
  );

  it.each([
    ['dispatch.offerTimeoutSeconds', '4'],
    ['dispatch.offerTimeoutSeconds', '61'],
    ['dispatch.offerTimeoutSeconds', '5.5'],
    ['dispatch.offerTimeoutSeconds', 'NaN'],
    ['dispatch.offerTimeoutSeconds', 'Infinity'],
    ['dispatch.maxWaitSeconds', '59'],
    ['dispatch.maxWaitSeconds', '3601'],
    ['dispatch.maxWaitSeconds', '60.1'],
    ['dispatch.maxWaitSeconds', ''],
    ['dispatch.maxWaitSeconds', '   '],
    ['dispatch.maxWaitSeconds', null],
  ] as const)('rejeita valor inválido para %s: %j', (key, input) => {
    expect(() => settingValue(key, input)).toThrow();
  });

  it('produz booleanos reais para checkbox marcado/desmarcado, sem converter "false" em true', () => {
    const enabled = settingValue('features.optionalProof', 'on');
    const disabled = settingValue('features.optionalProof', null);
    expect(enabled).toBe(true);
    expect(disabled).toBe(false);
    expect(settingValue('features.optionalProof', 'false')).toBe(false);
    expect(JSON.stringify({ value: enabled })).toBe('{"value":true}');
    expect(JSON.stringify({ value: disabled })).toBe('{"value":false}');
  });

  it('normaliza telefone de contato e permite remover o valor com campo vazio', () => {
    expect(settingValue('support.phone', '  +55 (11) 99999-8888  ')).toBe('+55 (11) 99999-8888');
    expect(settingValue('support.phone', '')).toBe('');
    expect(settingValue('support.phone', '   ')).toBe('');
  });

  it.each([
    '123',
    'https://example.test',
    '<script>alert(1)</script>',
    'user@example.test',
    '+5511999998888ext42',
    '9'.repeat(26),
  ])('rejeita texto não permitido no campo público de telefone: %j', (input) => {
    expect(() => settingValue('support.phone', input)).toThrow('Informe um telefone válido');
  });

  it('explica a reserva do módulo sem afirmar que comprovantes foram implementados', () => {
    expect(displaySetting(true)).toContain('reserva de configuração');
    expect(displaySetting(false)).toBe('Não');
    expect(displaySetting('')).toBe('Não informado');
    expect(displaySetting(10)).toBe('10');
  });

  it('distingue valor padrão de sobrescrita global ou da cidade', () => {
    expect(sourceLabel(null)).toBe('Padrão da operação');
    expect(sourceLabel({ scope: 'GLOBAL', scopeId: 'global' })).toBe('Configuração global');
    expect(sourceLabel({ scope: 'CITY', scopeId: cityId })).toBe('Configuração da cidade');
    expect(sourceLabel({ scope: 'USER', scopeId: cityId })).toBe('Configuração específica');
  });
});
