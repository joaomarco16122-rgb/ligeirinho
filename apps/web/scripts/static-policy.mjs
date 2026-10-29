/**
 * A static export cannot enforce Supabase SSR cookies or protected server routes.
 * @param {Record<string, string | undefined>} [env]
 */
export function assertStaticLegacyAuth(env = process.env) {
  const provider = env.AUTH_PROVIDER?.trim();
  const frontend = env.NEXT_PUBLIC_AUTH_PROVIDER?.trim();
  const enabled = env.SUPABASE_AUTH_ENABLED?.trim();
  if (
    (provider && provider !== 'legacy') ||
    (frontend && frontend !== 'legacy') ||
    (enabled && enabled !== '0')
  ) {
    throw new Error(
      'Este modo estático é exclusivo do site institucional legado. Para autenticação Supabase e rotas protegidas, use o build standalone com AUTH_PROVIDER=supabase; nenhuma proteção SSR será removida automaticamente.',
    );
  }
}
