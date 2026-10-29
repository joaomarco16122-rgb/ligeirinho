import { describe, expect, it } from 'vitest';
import { assertStaticLegacyAuth } from '../scripts/static-policy.mjs';
describe('Limite entre export institucional e autenticação SSR', () => {
  it.each([
    {},
    { AUTH_PROVIDER: 'legacy' },
    { AUTH_PROVIDER: 'legacy', NEXT_PUBLIC_AUTH_PROVIDER: 'legacy', SUPABASE_AUTH_ENABLED: '0' },
  ])('permite export institucional explícito ou padrão sem sinal de Supabase', (env) =>
    expect(() => assertStaticLegacyAuth(env)).not.toThrow(),
  );
  it.each([
    { AUTH_PROVIDER: 'supabase' },
    { SUPABASE_AUTH_ENABLED: '1' },
    { NEXT_PUBLIC_AUTH_PROVIDER: 'supabase' },
    { AUTH_PROVIDER: 'legacy', SUPABASE_AUTH_ENABLED: '1' },
    { AUTH_PROVIDER: 'outro' },
    { SUPABASE_AUTH_ENABLED: 'sim' },
    { NEXT_PUBLIC_AUTH_PROVIDER: 'outro' },
  ])('recusa modo Supabase ou parcial antes de remover proteções SSR', (env) =>
    expect(() => assertStaticLegacyAuth(env)).toThrow(
      'nenhuma proteção SSR será removida automaticamente',
    ),
  );
});
