import {
  AuthConfigurationError,
  supabaseCookieName,
  validateSupabasePublicConfig,
  validateSupabaseProjectUrl,
  assertPublicSupabaseKey,
} from './public-config';
export { AuthConfigurationError } from './public-config';
export type AuthProvider = 'legacy' | 'supabase';
export type SupabasePublicConfig = { url: string; key: string };
type AuthEnvironment = {
  AUTH_PROVIDER?: string;
  NEXT_PUBLIC_AUTH_PROVIDER?: string;
  SUPABASE_AUTH_ENABLED?: string;
};
type PublicEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_ANON_KEY?: string;
};
function readAuthEnvironment(): AuthEnvironment {
  const runtime = process.env;
  return {
    AUTH_PROVIDER: runtime.AUTH_PROVIDER,
    NEXT_PUBLIC_AUTH_PROVIDER: runtime.NEXT_PUBLIC_AUTH_PROVIDER,
    SUPABASE_AUTH_ENABLED: runtime.SUPABASE_AUTH_ENABLED,
  };
}
export function getAuthProvider(
  environment: AuthEnvironment = readAuthEnvironment(),
): AuthProvider {
  const provider = environment.AUTH_PROVIDER?.trim() || 'legacy';
  if (provider !== 'legacy' && provider !== 'supabase') throw new AuthConfigurationError();
  const publicProvider = environment.NEXT_PUBLIC_AUTH_PROVIDER?.trim();
  const enabled = environment.SUPABASE_AUTH_ENABLED?.trim();
  if (
    publicProvider &&
    (!['legacy', 'supabase'].includes(publicProvider) || publicProvider !== provider)
  )
    throw new AuthConfigurationError();
  if (enabled && !['0', '1'].includes(enabled)) throw new AuthConfigurationError();
  if (enabled === '1' && provider !== 'supabase') throw new AuthConfigurationError();
  return provider;
}
function readPublicEnvironment(): PublicEnvironment {
  // Keep these values runtime-bound on the server. Direct NEXT_PUBLIC member
  // reads can be replaced at build time by Next's public-environment transform.
  const runtime = process.env;
  return {
    NEXT_PUBLIC_SUPABASE_URL: runtime.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: runtime.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: runtime.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_URL: runtime.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: runtime.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_ANON_KEY: runtime.SUPABASE_ANON_KEY,
  };
}
function pair(
  url: string | undefined,
  publishable: string | undefined,
  anon: string | undefined,
): SupabasePublicConfig | null {
  const address = url?.trim();
  const publicKey = publishable?.trim();
  const anonKey = anon?.trim();
  if (!address && !publicKey && !anonKey) return null;
  // A partially supplied alias group must never borrow a key from another group.
  if (!address || (!publicKey && !anonKey)) throw new AuthConfigurationError();
  if (publicKey) assertPublicSupabaseKey(publicKey);
  if (anonKey) assertPublicSupabaseKey(anonKey);
  return validateSupabasePublicConfig(address, publicKey || anonKey);
}
export function getSupabasePublicConfig(
  environment: PublicEnvironment = readPublicEnvironment(),
): SupabasePublicConfig {
  const server = pair(
    environment.SUPABASE_URL,
    environment.SUPABASE_PUBLISHABLE_KEY,
    environment.SUPABASE_ANON_KEY,
  );
  const publicPair = pair(
    environment.NEXT_PUBLIC_SUPABASE_URL,
    environment.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  if (server && publicPair && (server.url !== publicPair.url || server.key !== publicPair.key))
    throw new AuthConfigurationError();
  const selected = server || publicPair;
  if (!selected) throw new AuthConfigurationError();
  return selected;
}
export function getSupabaseCookieName(): string {
  const environment = readPublicEnvironment();
  const server = environment.SUPABASE_URL?.trim();
  const publicUrl = environment.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (
    server &&
    publicUrl &&
    validateSupabaseProjectUrl(server).origin !== validateSupabaseProjectUrl(publicUrl).origin
  )
    throw new AuthConfigurationError();
  return supabaseCookieName(server || publicUrl || '');
}
