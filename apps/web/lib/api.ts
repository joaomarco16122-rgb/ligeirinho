export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'ESTABLISHMENT' | 'COURIER';
export type User = {
  id: string;
  name?: string;
  email: string;
  role: Role;
  mustChangePassword?: boolean;
  cityId?: string | null;
};
export type Session = { accessToken: string; refreshToken: string; user: User };
let session: Session | null = null;
let generation = 0;
let sessionRefresher: (() => Promise<void>) | null = null;
export const getSessionGeneration = () => generation;
export function setSessionRefresher(handler: (() => Promise<void>) | null) {
  sessionRefresher = handler;
}
export const getSession = () => session;
export function setSession(value: Session | null, expectedGeneration?: number) {
  if (expectedGeneration !== undefined && expectedGeneration !== generation) return false;
  session = value;
  generation++;
  return true;
}
export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api/v1';
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
let refreshing: Promise<void> | null = null;
async function refresh() {
  const current = session;
  const expectedGeneration = generation;
  if (!current) throw new ApiError('Sua sessão terminou. Entre novamente.', 401);
  const response = await fetch(`${API_URL}/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: current.refreshToken }),
  });
  if (!response.ok) {
    setSession(null, expectedGeneration);
    throw new ApiError('Sua sessão terminou. Entre novamente.', 401);
  }
  const data = await response.json();
  if (!setSession({ ...current, ...data, user: data.user || current.user }, expectedGeneration))
    throw new ApiError('A sessão foi encerrada. Entre novamente.', 401);
}
export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('Content-Type', 'application/json');
  if (session && !headers.has('Authorization'))
    headers.set('Authorization', `Bearer ${session.accessToken}`);
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...init, headers, cache: 'no-store' });
  } catch {
    throw new ApiError(
      'Não foi possível conectar ao servidor. Confira sua conexão e tente novamente.',
      0,
    );
  }
  if (response.status === 401 && session && retry && path != '/auth/login') {
    if (!refreshing)
      refreshing = (sessionRefresher ? sessionRefresher() : refresh()).finally(() => {
        refreshing = null;
      });
    await refreshing;
    return api<T>(path, init, false);
  }
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    const message = Array.isArray(data.message) ? data.message.join('. ') : data.message;
    throw new ApiError(message || 'Não foi possível concluir a operação.', response.status);
  }
  if (response.status === 204) return undefined as T;
  return response.json();
}
export const post = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
export async function logout() {
  const current = session;
  setSession(null); // invalidate pending refresh/exchange before making a network request
  if (current)
    await api(
      '/auth/logout',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${current.accessToken}` },
        body: JSON.stringify({ refreshToken: current.refreshToken }),
      },
      false,
    );
}
export function destination(role: Role) {
  return role === 'SUPER_ADMIN' || role === 'ADMIN'
    ? '/admin'
    : role === 'ESTABLISHMENT'
      ? '/portal'
      : '/downloads';
}
