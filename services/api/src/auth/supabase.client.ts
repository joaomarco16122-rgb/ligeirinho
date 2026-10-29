import {
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { isIP } from 'node:net';
import { z } from 'zod';
import { HttpTransport, proxyAwareTransport } from '../integrations/transport';
export const supabaseAccessToken = z
  .string()
  .min(20)
  .max(16384)
  .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
const providerUser = z.object({
  id: z
    .string()
    .uuid()
    .transform((value) => value.toLowerCase()),
  email: z.string().email().optional(),
  email_confirmed_at: z.string().datetime({ offset: true }).nullable().optional(),
  is_anonymous: z.boolean().optional(),
  banned_until: z.string().datetime({ offset: true }).nullable().optional(),
});
export interface VerifiedSupabaseIdentity {
  id: string;
  sessionId: string;
  email: string | null;
  emailConfirmed: boolean;
  expiresAt: Date;
}
export interface SupabaseAuthConfiguration {
  origin: string;
  publishableKey: string;
  requireEmailConfirmed: boolean;
}
export type PublicAuthProviderConfiguration =
  | { provider: 'legacy'; configured: true }
  | { provider: 'supabase'; configured: true; url: string; publishableKey: string };
function publicSupabaseKey(key: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    // Configuration guard only: this decode never authenticates a user or grants a role.
    return (
      payload !== null &&
      typeof payload === 'object' &&
      Object.hasOwn(payload, 'role') &&
      payload.role === 'anon'
    );
  } catch {
    return false;
  }
}
export function supabaseAuthConfiguration(env: NodeJS.ProcessEnv): SupabaseAuthConfiguration {
  if (env.AUTH_PROVIDER?.trim() !== 'supabase' && env.SUPABASE_AUTH_ENABLED?.trim() !== '1')
    throw new NotFoundException('Entrada Supabase desativada.');
  const key = env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY;
  let url: URL;
  try {
    url = new URL(env.SUPABASE_URL || '');
  } catch {
    throw new ServiceUnavailableException('Autenticação Supabase não configurada.');
  }
  const labels = url.hostname.split('.');
  const publicDns =
    labels.length > 1 &&
    labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    !publicDns ||
    isIP(url.hostname) ||
    /(^|\.)(localhost|local|internal)$/.test(url.hostname) ||
    !key ||
    key.length > 8192 ||
    /[\r\n]/.test(key) ||
    !publicSupabaseKey(key)
  )
    throw new ServiceUnavailableException(
      'Autenticação Supabase não configurada com URL HTTPS pública e chave publicável.',
    );
  const cloud = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
  if (!cloud && !/^[a-z0-9]{20}$/.test(env.SUPABASE_PROJECT_REF || ''))
    throw new ServiceUnavailableException(
      'Domínio Supabase personalizado exige referência explícita do projeto.',
    );
  if (cloud && env.SUPABASE_PROJECT_REF && cloud[1] !== env.SUPABASE_PROJECT_REF)
    throw new ServiceUnavailableException('Configuração Supabase possui referências divergentes.');
  return {
    origin: url.origin,
    publishableKey: key,
    requireEmailConfirmed: env.SUPABASE_REQUIRE_EMAIL_CONFIRMED !== '0',
  };
}
/** Discovery is public; never return the environment or private provider fields. */
export function publicAuthProviderConfiguration(
  env: NodeJS.ProcessEnv,
): PublicAuthProviderConfiguration {
  const unavailable = () =>
    new ServiceUnavailableException({
      configured: false,
      message: 'A autenticação não está configurada corretamente. Consulte a administração.',
    });
  const provider = env.AUTH_PROVIDER?.trim() || 'legacy';
  const publicProvider = env.NEXT_PUBLIC_AUTH_PROVIDER?.trim();
  const enabled = env.SUPABASE_AUTH_ENABLED?.trim();
  if (
    !['legacy', 'supabase'].includes(provider) ||
    (publicProvider && publicProvider !== provider) ||
    (enabled && !['0', '1'].includes(enabled)) ||
    (enabled === '1' && provider !== 'supabase')
  )
    throw unavailable();
  if (provider === 'legacy') return { provider: 'legacy', configured: true };
  try {
    // Validate every configured public-key alias, including one that is not the
    // preferred alias, so a misplaced administrative key fails closed.
    for (const value of [env.SUPABASE_PUBLISHABLE_KEY, env.SUPABASE_ANON_KEY])
      if (value && !publicSupabaseKey(value)) throw unavailable();
    const config = supabaseAuthConfiguration({ ...env, AUTH_PROVIDER: provider });
    return {
      provider: 'supabase',
      configured: true,
      url: config.origin,
      publishableKey: config.publishableKey,
    };
  } catch {
    throw unavailable();
  }
}
export class SupabaseIdentityClient {
  constructor(
    private readonly transport: HttpTransport = proxyAwareTransport,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}
  assertConfigured(): void {
    supabaseAuthConfiguration(this.env);
  }
  publicConfiguration(): PublicAuthProviderConfiguration {
    return publicAuthProviderConfiguration(this.env);
  }
  private identity(
    data: unknown,
    requireEmailConfirmed: boolean,
  ): Omit<VerifiedSupabaseIdentity, 'expiresAt' | 'sessionId'> {
    const user = providerUser.parse(data);
    if (
      user.is_anonymous ||
      (user.banned_until && new Date(user.banned_until).getTime() > Date.now()) ||
      (requireEmailConfirmed && (!user.email || !user.email_confirmed_at))
    )
      throw new Error('Identity not eligible');
    // No role/permission is ever read from user_metadata or app_metadata here.
    return {
      id: user.id,
      email: user.email ?? null,
      emailConfirmed: Boolean(user.email_confirmed_at),
    };
  }
  async verify(accessToken: string): Promise<VerifiedSupabaseIdentity> {
    const config = supabaseAuthConfiguration(this.env);
    if (!supabaseAccessToken.safeParse(accessToken).success)
      throw new UnauthorizedException('Sessão Supabase inválida.');
    try {
      const response = await this.transport(`${config.origin}/auth/v1/user`, {
        method: 'GET',
        headers: {
          apikey: config.publishableKey,
          Authorization: `Bearer ${accessToken}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('Provider rejected identity');
      const identity = this.identity(await response.json(), config.requireEmailConfirmed);
      // Only parse claims after the configured Auth server accepted this exact token.
      const claims = z
        .object({
          sub: z
            .string()
            .uuid()
            .transform((value) => value.toLowerCase()),
          exp: z.number().int().positive().max(8640000000000),
          session_id: z
            .string()
            .uuid()
            .transform((value) => value.toLowerCase()),
        })
        .parse(JSON.parse(Buffer.from(accessToken.split('.')[1]!, 'base64url').toString('utf8')));
      if (claims.sub !== identity.id || claims.exp * 1000 <= Date.now())
        throw new Error('Expired or mismatched provider proof');
      return {
        ...identity,
        sessionId: claims.session_id,
        expiresAt: new Date(claims.exp * 1000),
      };
    } catch {
      throw new UnauthorizedException('Sessão Supabase inválida, expirada ou não elegível.');
    }
  }
  async changePassword(input: {
    expectedUserId: string;
    email: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<void> {
    const config = supabaseAuthConfiguration(this.env);
    try {
      const login = await this.transport(`${config.origin}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: config.publishableKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: input.email, password: input.currentPassword }),
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
      if (!login.ok) throw new Error('Reauthentication failed');
      const authenticated = z
        .object({ access_token: supabaseAccessToken, user: providerUser })
        .parse(await login.json());
      const identity = this.identity(authenticated.user, config.requireEmailConfirmed);
      if (identity.id !== input.expectedUserId) throw new Error('Identity binding mismatch');
      const updated = await this.transport(`${config.origin}/auth/v1/user`, {
        method: 'PUT',
        headers: {
          apikey: config.publishableKey,
          Authorization: `Bearer ${authenticated.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password: input.newPassword }),
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
      if (!updated.ok)
        throw new Error('Password update rejected or additional provider nonce required');
      const changed = this.identity(await updated.json(), config.requireEmailConfirmed);
      if (changed.id !== input.expectedUserId) throw new Error('Identity binding mismatch');
    } catch {
      throw new UnauthorizedException(
        'Não foi possível alterar a senha no Supabase. Confirme a senha atual e os requisitos de reautenticação do provedor.',
      );
    }
  }
}
