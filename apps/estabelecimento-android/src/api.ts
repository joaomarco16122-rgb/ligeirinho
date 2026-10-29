import {
  createClient,
  type SupabaseClient,
  type Session as SupabaseSession,
} from '@supabase/supabase-js';
import type { User } from './domain';
import { parseAuthProvider, type NativeAuthProvider } from './auth-provider';
import { readSecureSession, writeSecureSession } from './secure-session';

const API_URL = (process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:3001/api/v1').replace(
  /\/$/,
  '',
);
interface Session {
  accessToken: string;
  refreshToken: string;
  user: User;
  authProvider?: 'legacy' | 'supabase';
  providerTokens?: { origin: string; accessToken: string; refreshToken: string };
}
let session: Session | null = null;
let refreshing: { generation: number; pending: Promise<void> } | null = null;
let restoring: { generation: number; role: User['role']; pending: Promise<User | null> } | null =
  null;
let clockOffset = 0;
let generation = 0;
let appRole: User['role'] | null = null;
let provider: Promise<NativeAuthProvider> | null = null;
let sdk: SupabaseClient | null = null;
let providerOperation: Promise<void> = Promise.resolve();
export const serverNow = () => Date.now() + clockOffset;
export const apiDestination = () => API_URL;
export const currentUser = () => session?.user ?? null;
class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}
function transient(error: unknown) {
  return error instanceof RequestError && (error.status === 0 || error.status >= 500);
}
function identityFailure(error: unknown) {
  const candidate = error as { status?: number; name?: string } | null;
  const unavailable =
    candidate?.name === 'AuthRetryableFetchError' ||
    candidate?.status === 0 ||
    (typeof candidate?.status === 'number' && candidate.status >= 500);
  return new RequestError(
    unavailable
      ? 'Não foi possível verificar sua identidade. Confira a conexão e tente novamente.'
      : 'Sua sessão expirou. Entre novamente.',
    unavailable ? 0 : 401,
  );
}
function requireGeneration(expected: number) {
  if (expected !== generation) throw new Error('A sessão foi encerrada. Entre novamente.');
}
function serializeProvider<T>(operation: () => Promise<T>): Promise<T> {
  const result = providerOperation.then(operation, operation);
  providerOperation = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
async function save(value: Session | null, expected: number) {
  requireGeneration(expected);
  session = value;
  await writeSecureSession(value ? JSON.stringify(value) : null);
  requireGeneration(expected);
}
async function raw(path: string, method: string, body?: unknown, token?: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
    const date = response.headers.get('Date');
    if (date && Number.isFinite(Date.parse(date))) clockOffset = Date.parse(date) - Date.now();
    const text = await response.text();
    let data: unknown = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        if (response.ok) throw new Error('Resposta inválida do servidor.');
      }
    }
    return { response, data };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError')
      throw new RequestError('A conexão demorou. Verifique sua internet e tente novamente.', 0, {
        cause: error,
      });
    if (error instanceof TypeError)
      throw new RequestError('Não foi possível conectar ao servidor. Confira sua conexão.', 0, {
        cause: error,
      });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
function failure(data: unknown, status: number): Error {
  const message = (data as { message?: string | string[] } | null)?.message;
  return new RequestError(
    Array.isArray(message)
      ? message.join('\n')
      : typeof message === 'string'
        ? message
        : status === 401
          ? 'Sua sessão expirou. Entre novamente.'
          : `Não foi possível concluir a operação (${status}).`,
    status,
  );
}
function configuration(): Promise<NativeAuthProvider> {
  if (!provider)
    provider = (async () => {
      const { response, data } = await raw('/auth/provider', 'GET');
      if (!response.ok) throw failure(data, response.status);
      return parseAuthProvider(data);
    })().catch((error) => {
      provider = null;
      throw error;
    });
  return provider;
}
function providerClient(config: Extract<NativeAuthProvider, { provider: 'supabase' }>) {
  if (!sdk)
    sdk = createClient(config.url, config.publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: async (input, init) => {
          const controller = new AbortController();
          const abort = () => controller.abort();
          const external = init?.signal;
          if (external?.aborted) controller.abort();
          else external?.addEventListener('abort', abort, { once: true });
          const timer = setTimeout(abort, 15000);
          try {
            return await fetch(input, { ...init, signal: controller.signal });
          } finally {
            clearTimeout(timer);
            external?.removeEventListener('abort', abort);
          }
        },
      },
    });
  return sdk;
}
function checkedSession(value: unknown, role: User['role']): Session {
  const candidate = value as Session | null;
  if (
    !candidate ||
    typeof candidate.accessToken !== 'string' ||
    typeof candidate.refreshToken !== 'string' ||
    !candidate.user?.id
  )
    throw new Error('Resposta de autenticação inválida. Entre novamente.');
  if (candidate.user.role !== role)
    throw new Error('Esta conta não pertence a este aplicativo. Use o aplicativo do seu perfil.');
  return candidate;
}
async function revokeNest(value: Session | null) {
  if (!value || typeof value.accessToken !== 'string' || typeof value.refreshToken !== 'string')
    return;
  const { response, data } = await raw(
    '/auth/logout',
    'POST',
    { refreshToken: value.refreshToken },
    value.accessToken,
  );
  if (!response.ok) throw failure(data, response.status);
}
async function clearOwned(expected: number, value: Session | null) {
  if (expected !== generation) return;
  generation++;
  session = null;
  await writeSecureSession(null);
  await revokeNest(value).catch(() => {});
  if (sdk) await sdk.auth.signOut({ scope: 'local' }).catch(() => {});
}
async function preserveProviderProof(
  previous: Session,
  config: Extract<NativeAuthProvider, { provider: 'supabase' }>,
  proof: SupabaseSession,
  expected: number,
) {
  if (!proof.access_token || !proof.refresh_token)
    throw new RequestError('Sua sessão expirou. Entre novamente.', 401);
  await save(
    {
      ...previous,
      authProvider: 'supabase',
      providerTokens: {
        origin: config.url,
        accessToken: proof.access_token,
        refreshToken: proof.refresh_token,
      },
    },
    expected,
  );
}
async function exchange(
  config: Extract<NativeAuthProvider, { provider: 'supabase' }>,
  proof: SupabaseSession,
  expected: number,
  role: User['role'],
) {
  requireGeneration(expected);
  if (!proof.access_token || !proof.refresh_token)
    throw new Error('Sessão Supabase inválida. Entre novamente.');
  const { response, data } = await raw('/auth/supabase', 'POST', {
    accessToken: proof.access_token,
  });
  if (!response.ok) throw failure(data, response.status);
  const received = data as Session;
  try {
    requireGeneration(expected);
    const current = checkedSession(received, role);
    await save(
      {
        ...current,
        authProvider: 'supabase',
        providerTokens: {
          origin: config.url,
          accessToken: proof.access_token,
          refreshToken: proof.refresh_token,
        },
      },
      expected,
    );
    return current.user;
  } catch (error) {
    await revokeNest(received).catch(() => {});
    throw error;
  }
}
async function refreshSession(expected: number) {
  const previous = session;
  if (!previous || !appRole) throw new Error('Sua sessão expirou. Entre novamente.');
  const role = appRole;
  if (previous.authProvider === 'supabase')
    return serializeProvider(async () => {
      try {
        requireGeneration(expected);
        const config = await configuration();
        requireGeneration(expected);
        if (config.provider !== 'supabase' || previous.providerTokens?.origin !== config.url)
          throw new Error('O provedor de autenticação mudou. Entre novamente.');
        const client = providerClient(config);
        const { data: restored, error: restoreError } = await client.auth.setSession({
          access_token: previous.providerTokens.accessToken,
          refresh_token: previous.providerTokens.refreshToken,
        });
        requireGeneration(expected);
        if (restoreError || !restored.session) throw identityFailure(restoreError);
        await preserveProviderProof(previous, config, restored.session, expected);
        const { data, error } = await client.auth.refreshSession();
        requireGeneration(expected);
        if (error || !data.session) throw identityFailure(error);
        await preserveProviderProof(previous, config, data.session, expected);
        await exchange(config, data.session, expected, role);
      } catch (error) {
        if (!transient(error)) await clearOwned(expected, previous);
        throw error;
      }
    });
  try {
    const { response, data } = await raw('/auth/refresh', 'POST', {
      refreshToken: previous.refreshToken,
    });
    requireGeneration(expected);
    if (!response.ok) throw failure(data, response.status);
    const next = checkedSession(data, role);
    await save({ ...next, authProvider: 'legacy' }, expected);
  } catch (error) {
    await clearOwned(expected, previous);
    throw error;
  }
}
export async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const expected = generation;
  let result = await raw(path, method, body, session?.accessToken);
  requireGeneration(expected);
  if (result.response.status === 401 && session?.refreshToken) {
    if (!refreshing || refreshing.generation !== expected) {
      const pending = refreshSession(expected).finally(() => {
        if (refreshing?.pending === pending) refreshing = null;
      });
      refreshing = { generation: expected, pending };
    }
    await refreshing.pending;
    requireGeneration(expected);
    result = await raw(path, method, body, session?.accessToken);
    requireGeneration(expected);
  }
  if (!result.response.ok) throw failure(result.data, result.response.status);
  return result.data as T;
}
export async function login(email: string, password: string, role: User['role']): Promise<User> {
  const expected = ++generation;
  session = null;
  appRole = role;
  const config = await configuration();
  requireGeneration(expected);
  if (config.provider === 'supabase')
    return serializeProvider(async () => {
      try {
        requireGeneration(expected);
        const { data, error } = await providerClient(config).auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        requireGeneration(expected);
        if (error || !data.session)
          throw new Error(
            'Não foi possível entrar. Confira suas credenciais e a situação da conta.',
          );
        return await exchange(config, data.session, expected, role);
      } catch (error) {
        await clearOwned(expected, session);
        throw error;
      }
    });
  try {
    const { response, data } = await raw('/auth/login', 'POST', { email: email.trim(), password });
    if (!response.ok) throw failure(data, response.status);
    const received = data as Session;
    let current: Session;
    try {
      requireGeneration(expected);
      current = checkedSession(received, role);
    } catch (error) {
      await revokeNest(received).catch(() => {});
      throw error;
    }
    await save({ ...current, authProvider: 'legacy' }, expected);
    return current.user;
  } catch (error) {
    await clearOwned(expected, session);
    throw error;
  }
}
export function restore(role: User['role']): Promise<User | null> {
  if (restoring?.generation === generation && restoring.role === role) return restoring.pending;
  const expected = generation;
  const pending = restoreOnce(role).finally(() => {
    if (restoring?.pending === pending) restoring = null;
  });
  restoring = { generation: expected, role, pending };
  return pending;
}
async function restoreOnce(role: User['role']): Promise<User | null> {
  appRole = role;
  const expected = generation;
  let value: string | null;
  try {
    value = await readSecureSession();
  } catch (error) {
    if (expected === generation) await save(null, expected);
    throw error;
  }
  requireGeneration(expected);
  if (!value) return null;
  let previous: Session;
  try {
    previous = checkedSession(JSON.parse(value), role);
  } catch {
    await save(null, expected);
    return null;
  }
  const config = await configuration();
  requireGeneration(expected);
  if ((previous.authProvider === 'supabase') !== (config.provider === 'supabase')) {
    await save(null, expected);
    return null;
  }
  if (config.provider === 'supabase')
    return serializeProvider(async () => {
      try {
        requireGeneration(expected);
        if (previous.providerTokens?.origin !== config.url)
          throw new Error('O provedor de autenticação mudou. Entre novamente.');
        const { data, error } = await providerClient(config).auth.setSession({
          access_token: previous.providerTokens.accessToken,
          refresh_token: previous.providerTokens.refreshToken,
        });
        requireGeneration(expected);
        if (error || !data.session) throw identityFailure(error);
        await preserveProviderProof(previous, config, data.session, expected);
        return await exchange(config, data.session, expected, role);
      } catch (error) {
        const stale = expected !== generation;
        if (!transient(error)) await clearOwned(expected, previous);
        if (stale) return null;
        throw error;
      }
    });
  session = previous;
  try {
    const user = await api<User>('/auth/me');
    checkedSession({ ...previous, user }, role);
    await save({ ...session!, user }, expected);
    return user;
  } catch (error) {
    if (!session) return null;
    throw error;
  }
}
export async function logout() {
  const previous = session;
  generation++;
  session = null;
  const clear = writeSecureSession(null);
  const remote = revokeNest(previous);
  const providerLogout = serializeProvider(async () => {
    const config = await configuration();
    if (config.provider === 'supabase') {
      const client = providerClient(config);
      if (previous?.providerTokens?.origin === config.url)
        await client.auth
          .setSession({
            access_token: previous.providerTokens.accessToken,
            refresh_token: previous.providerTokens.refreshToken,
          })
          .catch(() => {});
      const { error } = await client.auth.signOut({ scope: 'local' });
      if (error)
        throw new Error(
          'A sessão local foi encerrada; a revogação no provedor não foi confirmada.',
        );
    }
  });
  const results = await Promise.allSettled([clear, remote, providerLogout]);
  for (const result of results) if (result.status === 'rejected') throw result.reason;
}
export async function changePassword(currentPassword: string, newPassword: string) {
  await api('/auth/change-password', 'POST', { currentPassword, newPassword });
  await logout();
}
