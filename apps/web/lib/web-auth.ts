import {
  api,
  ApiError,
  getSession,
  getSessionGeneration,
  setSessionRefresher,
  logout,
  post,
  setSession,
  type Role,
  type Session,
} from './api';

type AuthProvider = 'legacy' | 'supabase';
type VerifiedSupabaseSession = {
  accessToken: string;
  user: { id: string; email?: string; role: Role };
};
let provider: Promise<AuthProvider> | null = null;
// SDK sign-in/refresh and SSR session reads can write provider cookies after
// their requests settle. Queue logout behind those writes, and later logins
// behind logout, so an obsolete response cannot resurrect or clear a session.
let supabaseOperation: Promise<void> = Promise.resolve();
function serializeSupabase<T>(operation: () => Promise<T>): Promise<T> {
  const pending = supabaseOperation.then(operation, operation);
  supabaseOperation = pending.then(
    () => undefined,
    () => undefined,
  );
  return pending;
}
function requireGeneration(expectedGeneration: number) {
  if (getSessionGeneration() !== expectedGeneration)
    throw new ApiError('A sessão foi encerrada. Entre novamente.', 401);
}
export function webAuthProvider(): Promise<AuthProvider> {
  if (process.env.NEXT_PUBLIC_STATIC_EXPORT === '1') return Promise.resolve('legacy');
  if (!provider)
    provider = readProvider().catch((error) => {
      provider = null;
      throw error;
    });
  return provider;
}
async function readProvider(): Promise<AuthProvider> {
  let response: Response;
  try {
    response = await fetch('/auth/provider', { credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError('A autenticação está indisponível. Confira a conexão e tente novamente.', 0);
  }
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.configured || !['legacy', 'supabase'].includes(data.provider))
    throw new ApiError(
      'A autenticação não está configurada corretamente. Consulte a administração.',
      response.status || 503,
    );
  setSessionRefresher(data.provider === 'supabase' ? refreshSupabaseSession : null);
  return data.provider;
}
async function signOutSupabase() {
  const { createSupabaseBrowserClient } = await import('./supabase/browser');
  const supabase = await createSupabaseBrowserClient();
  let failure: unknown;
  try {
    await supabase.auth.stopAutoRefresh();
  } catch (error) {
    failure = error;
  }
  try {
    const result = await supabase.auth.signOut({ scope: 'local' });
    if (result.error) failure ??= result.error;
  } catch (error) {
    failure ??= error;
  }
  // Clear server cookies last, after any SDK refresh/sign-out operation settles.
  // The server route also clears local project cookies if remote revocation fails.
  try {
    const response = await fetch('/auth/logout', { method: 'POST', credentials: 'same-origin' });
    if (!response.ok)
      throw new ApiError(
        'A sessão local foi encerrada; não foi possível confirmar a revogação remota.',
        response.status,
      );
  } catch (error) {
    failure ??= error;
  }
  if (failure) throw failure;
}
async function clearSupabaseSession(expectedGeneration: number) {
  if (!setSession(null, expectedGeneration)) return;
  await signOutSupabase().catch(() => {});
}
async function exchangeVerifiedSupabase(expectedGeneration: number): Promise<Session> {
  let response: Response;
  try {
    response = await fetch('/auth/session', { credentials: 'same-origin', cache: 'no-store' });
  } catch {
    throw new ApiError('Não foi possível verificar a identidade. Confira sua conexão.', 0);
  }
  if (getSessionGeneration() !== expectedGeneration)
    throw new ApiError('A sessão foi encerrada. Entre novamente.', 401);
  if (!response.ok)
    throw new ApiError(
      response.status === 401
        ? 'Entre novamente para continuar.'
        : 'Não foi possível verificar sua identidade. Consulte a administração.',
      response.status,
    );
  const verified: VerifiedSupabaseSession = await response.json();
  if (!verified.accessToken || !verified.user?.id || !verified.user.role)
    throw new ApiError('A identidade retornada não possui um perfil de acesso válido.', 403);
  const current = await api<Session>(
    '/auth/supabase',
    { method: 'POST', body: JSON.stringify({ accessToken: verified.accessToken }) },
    false,
  );
  if (current.user.role !== verified.user.role) {
    await api(
      '/auth/logout',
      { method: 'POST', headers: { Authorization: `Bearer ${current.accessToken}` } },
      false,
    ).catch(() => {});
    throw new ApiError(
      'O perfil da sua conta está divergente. Solicite a revisão à administração.',
      403,
    );
  }
  if (!setSession(current, expectedGeneration)) {
    await api(
      '/auth/logout',
      { method: 'POST', headers: { Authorization: `Bearer ${current.accessToken}` } },
      false,
    ).catch(() => {});
    throw new ApiError('A sessão foi encerrada. Entre novamente.', 401);
  }
  return current;
}
function refreshSupabaseSession(): Promise<void> {
  const expectedGeneration = getSessionGeneration();
  return serializeSupabase(async () => {
    try {
      requireGeneration(expectedGeneration);
      const { createSupabaseBrowserClient } = await import('./supabase/browser');
      const supabase = await createSupabaseBrowserClient();
      requireGeneration(expectedGeneration);
      const { error } = await supabase.auth.refreshSession();
      if (error) throw new ApiError('Sua sessão terminou. Entre novamente.', 401);
      requireGeneration(expectedGeneration);
      await exchangeVerifiedSupabase(expectedGeneration);
    } catch (error) {
      await clearSupabaseSession(expectedGeneration);
      throw error;
    }
  });
}
export async function restoreWebSession(): Promise<Session | null> {
  if (getSession()) return getSession();
  const expectedGeneration = getSessionGeneration();
  if ((await webAuthProvider()) === 'legacy') return null;
  return serializeSupabase(async () => {
    if (getSession()) return getSession();
    try {
      requireGeneration(expectedGeneration);
      return await exchangeVerifiedSupabase(expectedGeneration);
    } catch (error) {
      await clearSupabaseSession(expectedGeneration);
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }
  });
}
export async function loginWeb(email: string, password: string): Promise<Session> {
  setSession(null);
  const expectedGeneration = getSessionGeneration();
  if ((await webAuthProvider()) === 'legacy') {
    const current = await post<Session>('/auth/login', { email, password });
    if (!setSession(current, expectedGeneration))
      throw new ApiError('A sessão foi encerrada. Entre novamente.', 401);
    return current;
  }
  return serializeSupabase(async () => {
    try {
      requireGeneration(expectedGeneration);
      const { createSupabaseBrowserClient } = await import('./supabase/browser');
      const supabase = await createSupabaseBrowserClient();
      requireGeneration(expectedGeneration);
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error)
        throw new ApiError(
          'Não foi possível entrar. Confira suas credenciais e a situação da sua conta.',
          401,
        );
      requireGeneration(expectedGeneration);
      await supabase.auth.startAutoRefresh();
      return await exchangeVerifiedSupabase(expectedGeneration);
    } catch (error) {
      await clearSupabaseSession(expectedGeneration);
      throw error;
    }
  });
}
export async function logoutWeb() {
  // Invalidate local work immediately and reserve cookie cleanup before waiting
  // for the backend. A newly requested login must run after this cleanup.
  const localLogout = logout();
  const expectedGeneration = getSessionGeneration();
  const providerLogout = serializeSupabase(async () => {
    if ((await webAuthProvider()) === 'supabase') await signOutSupabase();
  });
  const results = await Promise.allSettled([localLogout, providerLogout]);
  setSession(null, expectedGeneration);
  for (const result of results) if (result.status === 'rejected') throw result.reason;
}
// Kept separate for provider-contract tests; application code never substitutes a
// synthetic authenticated session when the configured Supabase service fails.
export function resetWebAuthProviderCache() {
  provider = null;
  setSessionRefresher(null);
}
