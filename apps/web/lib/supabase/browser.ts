import { createBrowserClient } from '@supabase/ssr';
import {
  AuthConfigurationError,
  supabaseCookieName,
  validateSupabasePublicConfig,
} from './public-config';
let client: Promise<ReturnType<typeof createBrowserClient>> | null = null;
/** Public configuration is validated by the server at runtime, never compiled from environment keys into browser JS. */
export async function createSupabaseBrowserClient() {
  if (!client) {
    client = (async () => {
      const response = await fetch('/auth/provider', {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const data = await response.json().catch(() => null);
      if (
        !response.ok ||
        !data ||
        data.provider !== 'supabase' ||
        data.configured !== true ||
        typeof data.url !== 'string' ||
        typeof data.publishableKey !== 'string'
      )
        throw new AuthConfigurationError();
      const config = validateSupabasePublicConfig(data.url, data.publishableKey);
      return createBrowserClient(config.url, config.key, {
        cookieOptions: {
          name: supabaseCookieName(config.url),
          path: '/',
          sameSite: 'lax',
          secure: globalThis.location?.protocol === 'https:',
        },
      });
    })().catch((error) => {
      client = null;
      throw error instanceof AuthConfigurationError ? error : new AuthConfigurationError();
    });
  }
  return client;
}
