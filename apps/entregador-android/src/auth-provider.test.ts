import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseAuthProvider } from './auth-provider';
const config = {
  provider: 'supabase',
  configured: true,
  url: 'https://fixture.supabase.co',
  publishableKey: 'sb_publishable_fixture_only',
};
afterEach(() => vi.unstubAllGlobals());
describe('configuração pública Auth obtida da API', () => {
  it('legado exige seleção explícita e configuração pronta', () => {
    expect(parseAuthProvider({ provider: 'legacy', configured: true })).toEqual({
      provider: 'legacy',
    });
    for (const value of [
      null,
      {},
      { provider: 'legacy' },
      { provider: 'supabase', configured: false },
      { provider: 'typo', configured: true },
    ])
      expect(() => parseAuthProvider(value)).toThrow('não está configurada');
  });
  it.each([
    'http://fixture.supabase.co',
    'https://localhost',
    'https://auth.localhost',
    'https://auth.internal',
    'https://127.0.0.1',
    'https://auth.example:8443',
    'https://secret@auth.example',
    'https://auth.example/auth/v1',
    'https://auth.example?token=private',
    'https://auth.example#fragment',
  ])('recusa origem insegura/ambígua %s', (url) => {
    expect(() => parseAuthProvider({ ...config, url })).toThrow('não está configurada');
  });
  it.each([
    'sb_secret_private',
    'invalid',
    `header.${btoa(JSON.stringify({ role: 'service_role' }))}.signature`,
  ])('recusa chave privada ou inválida %s', (publishableKey) => {
    expect(() => parseAuthProvider({ ...config, publishableKey })).toThrow('não está configurada');
  });
  it('aceita anon JWT no Hermes sem atob nem TextDecoder globais', () => {
    const publishableKey =
      'header.' +
      Buffer.from(JSON.stringify({ role: 'anon', name: 'Configuração 🚲' }), 'utf8')
        .toString('base64')
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', '') +
      '.signature';
    vi.stubGlobal('atob', undefined);
    vi.stubGlobal('TextDecoder', undefined);
    expect(parseAuthProvider({ ...config, publishableKey })).toMatchObject({ publishableKey });
  });
  it('aceita chave publicável e chave anon legada sem usar metadados como autorização', () => {
    expect(parseAuthProvider(config)).toEqual({
      provider: 'supabase',
      url: config.url,
      publishableKey: config.publishableKey,
    });
    const publishableKey = `header.${btoa(JSON.stringify({ role: 'anon' }))}.signature`;
    expect(parseAuthProvider({ ...config, publishableKey })).toMatchObject({ publishableKey });
  });
});
