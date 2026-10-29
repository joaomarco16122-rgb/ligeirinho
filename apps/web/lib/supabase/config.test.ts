import { describe, expect, it } from 'vitest';
import { AuthConfigurationError, getAuthProvider, getSupabasePublicConfig } from './config';
import { assertPublicSupabaseKey, validateSupabasePublicConfig } from './public-config';
function jwt(role: string) {
  return `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role }))}.signature`;
}
describe('Configuração pública Supabase falha fechada', () => {
  it('usa legado somente quando não há seleção explícita válida', () => {
    expect(getAuthProvider({})).toBe('legacy');
    expect(getAuthProvider({ AUTH_PROVIDER: 'supabase' })).toBe('supabase');
    expect(() => getAuthProvider({ AUTH_PROVIDER: 'supabase-typo' })).toThrow(
      AuthConfigurationError,
    );
  });
  it('não transforma seleção Supabase parcial ou contraditória em modo legado', () => {
    expect(() => getAuthProvider({ SUPABASE_AUTH_ENABLED: '1' })).toThrow(AuthConfigurationError);
    expect(() =>
      getAuthProvider({ AUTH_PROVIDER: 'legacy', NEXT_PUBLIC_AUTH_PROVIDER: 'supabase' }),
    ).toThrow(AuthConfigurationError);
    expect(() =>
      getAuthProvider({ AUTH_PROVIDER: 'supabase', NEXT_PUBLIC_AUTH_PROVIDER: 'legacy' }),
    ).toThrow(AuthConfigurationError);
    expect(() => getAuthProvider({ SUPABASE_AUTH_ENABLED: 'true' })).toThrow(
      AuthConfigurationError,
    );
    expect(getAuthProvider({ AUTH_PROVIDER: 'legacy', SUPABASE_AUTH_ENABLED: '0' })).toBe('legacy');
    expect(getAuthProvider({ AUTH_PROVIDER: 'supabase', SUPABASE_AUTH_ENABLED: '1' })).toBe(
      'supabase',
    );
  });
  it('não inventa credenciais quando o provedor foi selecionado', () => {
    expect(() => getSupabasePublicConfig({})).toThrow(AuthConfigurationError);
    expect(() =>
      getSupabasePublicConfig({ NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co' }),
    ).toThrow(AuthConfigurationError);
  });
  it('aceita uma chave publishable ou anon sem consultar nem revelar uma chave privada', () => {
    expect(
      getSupabasePublicConfig({
        NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co/',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
      }),
    ).toEqual({ url: 'https://fixture.supabase.co', key: 'sb_publishable_fixture' });
    expect(() => assertPublicSupabaseKey(jwt('anon'))).not.toThrow();
  });
  it.each(['sb_secret_fixture', jwt('service_role'), jwt('authenticated'), 'not-a-public-key'])(
    'bloqueia credencial imprópria sem reproduzir seu conteúdo',
    (key) => {
      expect(() => assertPublicSupabaseKey(key)).toThrow(AuthConfigurationError);
      try {
        assertPublicSupabaseKey(key);
      } catch (error) {
        expect((error as Error).message).not.toContain(key);
      }
    },
  );
  it.each([
    'http://fixture.supabase.co',
    'https://user:password@fixture.supabase.co',
    'https://fixture.supabase.co/auth/v1',
    'https://fixture.supabase.co/?key=anything',
    'https://fixture.supabase.co/#anything',
  ])('bloqueia URL ambígua ou sem TLS: %s', (url) => {
    expect(() => validateSupabasePublicConfig(url, 'sb_publishable_fixture')).toThrow(
      AuthConfigurationError,
    );
  });
});

describe('Aliases de configuração não misturam projetos', () => {
  it('aceita par completo de servidor sem expor variáveis no bundle browser', () => {
    expect(
      getSupabasePublicConfig({
        SUPABASE_URL: 'https://fixture.supabase.co',
        SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_server',
      }),
    ).toEqual({ url: 'https://fixture.supabase.co', key: 'sb_publishable_server' });
  });
  it('aceita aliases redundantes somente quando identificam o mesmo par', () => {
    expect(
      getSupabasePublicConfig({
        SUPABASE_URL: 'https://fixture.supabase.co/',
        SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_same',
        NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_same',
      }).key,
    ).toBe('sb_publishable_same');
  });
  it('não mistura URL parcial de servidor com a chave do grupo público', () => {
    expect(() =>
      getSupabasePublicConfig({
        SUPABASE_URL: 'https://fixture.supabase.co',
        NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co',
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public',
      }),
    ).toThrow(AuthConfigurationError);
  });
  it.each([
    {
      SUPABASE_URL: 'https://server.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_same',
      NEXT_PUBLIC_SUPABASE_URL: 'https://public.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_same',
    },
    {
      SUPABASE_URL: 'https://fixture.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_server',
      NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_other',
    },
  ])('recusa pares completos contraditórios', (environment) => {
    expect(() => getSupabasePublicConfig(environment)).toThrow(AuthConfigurationError);
  });
  it.each([
    'https://127.0.0.1',
    'https://2130706433',
    'https://[::1]',
    'https://localhost',
    'https://project.localhost',
    'https://fixture.supabase.co:8443',
    'https://project..supabase.co',
  ])('recusa destino IP/local/porta imprópria: %s', (url) => {
    expect(() =>
      getSupabasePublicConfig({
        SUPABASE_URL: url,
        SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
      }),
    ).toThrow(AuthConfigurationError);
  });
  it('aceita domínio DNS personalizado e porta HTTPS padrão', () => {
    expect(
      getSupabasePublicConfig({
        SUPABASE_URL: 'https://auth.delivery.example.com:443',
        SUPABASE_ANON_KEY: `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role: 'anon' }))}.signature`,
      }).url,
    ).toBe('https://auth.delivery.example.com');
  });
});
