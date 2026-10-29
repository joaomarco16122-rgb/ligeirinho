import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, getSession, setSession, type Session } from './api';
import {
  loginWeb,
  logoutWeb,
  resetWebAuthProviderCache,
  restoreWebSession,
  webAuthProvider,
} from './web-auth';
const sdk = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  refreshSession: vi.fn(),
  stopAutoRefresh: vi.fn(),
  startAutoRefresh: vi.fn(),
}));
vi.mock('./supabase/browser', () => ({ createSupabaseBrowserClient: async () => ({ auth: sdk }) }));
const local: Session = {
  accessToken: 'local-access',
  refreshToken: 'local-refresh',
  user: { id: 'db-user', email: 'operador@example.test', role: 'ESTABLISHMENT' },
};
const verified = {
  accessToken: 'supabase-access',
  user: { id: 'supabase-uid', email: 'operador@example.test', role: 'ESTABLISHMENT' },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  setSession(null);
  resetWebAuthProviderCache();
  vi.stubEnv('NEXT_PUBLIC_STATIC_EXPORT', '');
  sdk.signInWithPassword.mockReset().mockResolvedValue({ error: null });
  sdk.signOut.mockReset().mockResolvedValue({ error: null });
  sdk.refreshSession.mockReset().mockResolvedValue({ error: null });
  sdk.stopAutoRefresh.mockReset().mockResolvedValue(undefined);
  sdk.startAutoRefresh.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  setSession(null);
  resetWebAuthProviderCache();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
describe('Contrato de autenticação web — SDK e HTTP simulados, sem Supabase real', () => {
  it('export estático escolhe explicitamente o modo legado sem chamar endpoint SSR', async () => {
    vi.stubEnv('NEXT_PUBLIC_STATIC_EXPORT', '1');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    expect(await webAuthProvider()).toBe('legacy');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('provedor Supabase mal configurado falha fechado e nunca chama login legado', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ provider: 'supabase', configured: false }, 503));
    vi.stubGlobal('fetch', fetch);
    await expect(loginWeb('operador@example.test', 'senha-teste')).rejects.toMatchObject({
      status: 503,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sdk.signInWithPassword).not.toHaveBeenCalled();
    expect(getSession()).toBeNull();
  });
  it('falha de rede ao descobrir provedor não ativa fallback legado', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(loginWeb('operador@example.test', 'senha-teste')).rejects.toBeInstanceOf(ApiError);
    expect(sdk.signInWithPassword).not.toHaveBeenCalled();
    expect(getSession()).toBeNull();
  });
  it('modo legado continua usando o contrato de login existente', async () => {
    const fetch = vi.fn(async (url: string) =>
      url === '/auth/provider' ? json({ provider: 'legacy', configured: true }) : json(local),
    );
    vi.stubGlobal('fetch', fetch);
    expect(await loginWeb('operador@example.test', 'senha-teste')).toEqual(local);
    expect(fetch.mock.calls[1]?.[0]).toMatch(/\/auth\/login$/);
    expect(sdk.signInWithPassword).not.toHaveBeenCalled();
  });
  it('Supabase verifica no servidor e troca token antes de criar sessão local', async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(url);
        if (url === '/auth/provider') return json({ provider: 'supabase', configured: true });
        if (url === '/auth/session') return json(verified);
        expect(url).toMatch(/\/auth\/supabase$/);
        expect(JSON.parse(String(init?.body))).toEqual({ accessToken: 'supabase-access' });
        return json(local);
      }),
    );
    expect(await loginWeb('operador@example.test', 'senha-teste')).toEqual(local);
    expect(calls).toHaveLength(3);
    expect(sdk.signInWithPassword).toHaveBeenCalledWith({
      email: 'operador@example.test',
      password: 'senha-teste',
    });
    expect(getSession()).toEqual(local);
  });
  it('token válido sem vínculo provisionado não ganha conta nem fallback por e-mail', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url === '/auth/provider') return json({ provider: 'supabase', configured: true });
        if (url === '/auth/session') return json(verified);
        return json({ message: 'Conta não vinculada.' }, 403);
      }),
    );
    await expect(loginWeb('operador@example.test', 'senha-teste')).rejects.toThrow(
      'Conta não vinculada.',
    );
    expect(urls.some((url) => url.endsWith('/auth/login'))).toBe(false);
    expect(sdk.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(getSession()).toBeNull();
  });
  it('restaura após recarga apenas mediante verificação e troca autorizadas', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/auth/provider'
          ? json({ provider: 'supabase', configured: true })
          : url === '/auth/session'
            ? json(verified)
            : json(local),
      ),
    );
    expect(await restoreWebSession()).toEqual(local);
    expect(sdk.signInWithPassword).not.toHaveBeenCalled();
  });
  it('sem cookie Supabase verificado a restauração retorna sem autenticação', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url === '/auth/provider'
          ? json({ provider: 'supabase', configured: true })
          : json({ message: 'Sem sessão.' }, 401),
      ),
    );
    expect(await restoreWebSession()).toBeNull();
    expect(getSession()).toBeNull();
  });
  it('logout limpa estado local e tenta ambos os provedores mesmo com falha no endpoint de cookies', async () => {
    setSession({ ...local });
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url === '/auth/provider') return json({ provider: 'supabase', configured: true });
        if (url === '/auth/logout') return json({ message: 'Indisponível.' }, 503);
        return json({ ok: true });
      }),
    );
    await expect(logoutWeb()).rejects.toMatchObject({ status: 503 });
    expect(urls.some((url) => url.endsWith('/api/v1/auth/logout'))).toBe(true);
    expect(urls).toContain('/auth/logout');
    expect(sdk.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(getSession()).toBeNull();
  });
  it('renovação Supabase usa SDK e sessão verificada, nunca o refresh local Nest', async () => {
    let exchanges = 0;
    let verifications = 0;
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        urls.push(url);
        if (url === '/auth/provider') return json({ provider: 'supabase', configured: true });
        if (url === '/auth/session') {
          verifications++;
          return json({
            ...verified,
            accessToken: verifications === 1 ? 'supa-initial' : 'supa-renewed',
          });
        }
        if (url.endsWith('/auth/supabase')) {
          exchanges++;
          expect(JSON.parse(String(init?.body))).toEqual({
            accessToken: exchanges === 1 ? 'supa-initial' : 'supa-renewed',
          });
          return json({ ...local, accessToken: exchanges === 1 ? 'old-local' : 'renewed-local' });
        }
        if (url.endsWith('/deliveries'))
          return new Headers(init?.headers).get('Authorization') === 'Bearer renewed-local'
            ? json({ ok: true })
            : json({}, 401);
        throw new Error(`Endpoint inesperado na simulação: ${url}`);
      }),
    );
    await loginWeb('operador@example.test', 'senha-teste');
    expect(await api('/deliveries')).toEqual({ ok: true });
    expect(sdk.refreshSession).toHaveBeenCalledTimes(1);
    expect(exchanges).toBe(2);
    expect(urls.some((url) => url.endsWith('/auth/refresh'))).toBe(false);
  });
  it('resposta de restauração atrasada não recria sessão após logout', async () => {
    let release!: (response: Response) => void;
    let waiting = false;
    let exchanged = false;
    let cookie: string | null = null;
    sdk.signOut.mockImplementation(async () => {
      cookie = null;
      return { error: null };
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/auth/provider') return json({ provider: 'supabase', configured: true });
        if (url === '/auth/session') {
          waiting = true;
          return new Promise<Response>((resolve) => {
            release = (response) => {
              // Models a delayed SSR refresh response committing Set-Cookie.
              cookie = 'late-server-cookie';
              resolve(response);
            };
          });
        }
        if (url === '/auth/logout') return json({ localSessionCleared: true, remoteRevoked: true });
        if (url.endsWith('/auth/supabase')) exchanged = true;
        return json(local);
      }),
    );
    const pending = restoreWebSession();
    await vi.waitFor(() => expect(waiting).toBe(true));
    const leaving = logoutWeb();
    release(json(verified));
    await leaving;
    expect(await pending).toBeNull();
    expect(exchanged).toBe(false);
    expect(cookie).toBeNull();
    expect(getSession()).toBeNull();
  });
  it('logout espera o sign-in atrasado, remove seus cookies e não reinicia a renovação automática', async () => {
    let cookie: string | null = null;
    let release!: () => void;
    sdk.signInWithPassword.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => {
            cookie = 'late-sign-in-cookie';
            resolve({ error: null });
          };
        }),
    );
    sdk.signOut.mockImplementation(async () => {
      cookie = null;
      return { error: null };
    });
    const fetch = vi.fn(async (url: string) =>
      url === '/auth/provider'
        ? json({ provider: 'supabase', configured: true })
        : json({ localSessionCleared: true, remoteRevoked: true }),
    );
    vi.stubGlobal('fetch', fetch);
    const entering = loginWeb('operador@example.test', 'senha-teste').catch((error) => error);
    await vi.waitFor(() => expect(sdk.signInWithPassword).toHaveBeenCalledTimes(1));
    let left = false;
    const leaving = logoutWeb().then(() => {
      left = true;
    });
    await Promise.resolve();
    expect(left).toBe(false);
    expect(sdk.signOut).not.toHaveBeenCalled();
    release();
    expect(await entering).toMatchObject({ status: 401 });
    await leaving;
    expect(cookie).toBeNull();
    expect(getSession()).toBeNull();
    expect(sdk.startAutoRefresh).not.toHaveBeenCalled();
    expect(sdk.signOut).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.some(([url]) => url === '/auth/session')).toBe(false);
  });
  it('uma nova entrada aguarda o logout e não é removida por uma entrada anterior atrasada', async () => {
    let cookie: string | null = null;
    let release!: () => void;
    sdk.signInWithPassword
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => {
              cookie = 'obsolete-cookie';
              resolve({ error: null });
            };
          }),
      )
      .mockImplementationOnce(async () => {
        cookie = 'new-cookie';
        return { error: null };
      });
    sdk.signOut.mockImplementation(async () => {
      cookie = null;
      return { error: null };
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/auth/provider') return json({ provider: 'supabase', configured: true });
        if (url === '/auth/session') {
          expect(cookie).toBe('new-cookie');
          return json(verified);
        }
        if (url.endsWith('/auth/supabase')) return json(local);
        return json({ localSessionCleared: true, remoteRevoked: true });
      }),
    );
    const obsolete = loginWeb('antigo@example.test', 'senha-antiga').catch((error) => error);
    await vi.waitFor(() => expect(sdk.signInWithPassword).toHaveBeenCalledTimes(1));
    const leaving = logoutWeb();
    const entering = loginWeb('novo@example.test', 'senha-nova');
    release();
    expect(await obsolete).toMatchObject({ status: 401 });
    await leaving;
    expect(await entering).toEqual(local);
    expect(cookie).toBe('new-cookie');
    expect(getSession()).toEqual(local);
    expect(sdk.signOut).toHaveBeenCalledTimes(1);
    expect(sdk.startAutoRefresh).toHaveBeenCalledTimes(1);
  });
  it('logout aguarda uma renovação SDK atrasada antes de apagar seus cookies', async () => {
    let cookie: string | null = 'initial-cookie';
    let release!: () => void;
    let exchanges = 0;
    sdk.refreshSession.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => {
            cookie = 'late-refreshed-cookie';
            resolve({ error: null });
          };
        }),
    );
    sdk.signOut.mockImplementation(async () => {
      cookie = null;
      return { error: null };
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/auth/provider') return json({ provider: 'supabase', configured: true });
        if (url === '/auth/session') return json(verified);
        if (url.endsWith('/auth/supabase')) {
          exchanges++;
          return json(local);
        }
        if (url.endsWith('/deliveries')) return json({}, 401);
        return json({ localSessionCleared: true, remoteRevoked: true });
      }),
    );
    await loginWeb('operador@example.test', 'senha-teste');
    const loading = api('/deliveries').catch((error) => error);
    await vi.waitFor(() => expect(sdk.refreshSession).toHaveBeenCalledTimes(1));
    const leaving = logoutWeb();
    release();
    expect(await loading).toMatchObject({ status: 401 });
    await leaving;
    expect(cookie).toBeNull();
    expect(getSession()).toBeNull();
    expect(exchanges).toBe(1);
    expect(sdk.stopAutoRefresh).toHaveBeenCalledTimes(1);
  });
  it('uma revogação Nest demorada não apaga a nova entrada após limpar os cookies antigos', async () => {
    let release!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url === '/auth/provider') return json({ provider: 'supabase', configured: true });
        if (url.endsWith('/api/v1/auth/logout'))
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        if (url === '/auth/session') return json(verified);
        if (url.endsWith('/auth/supabase')) return json(local);
        return json({ localSessionCleared: true, remoteRevoked: true });
      }),
    );
    await webAuthProvider();
    setSession(local);
    const leaving = logoutWeb();
    await vi.waitFor(() => expect(sdk.signOut).toHaveBeenCalledTimes(1));
    expect(await loginWeb('novo@example.test', 'senha-nova')).toEqual(local);
    release(json({ ok: true }));
    await leaving;
    expect(getSession()).toEqual(local);
  });
  it('restaurações simultâneas compartilham a sessão verificada sem limpar o login', async () => {
    const fetch = vi.fn(async (url: string) =>
      url === '/auth/provider'
        ? json({ provider: 'supabase', configured: true })
        : url === '/auth/session'
          ? json(verified)
          : json(local),
    );
    vi.stubGlobal('fetch', fetch);
    expect(await Promise.all([restoreWebSession(), restoreWebSession()])).toEqual([local, local]);
    expect(fetch.mock.calls.filter(([url]) => url === '/auth/session')).toHaveLength(1);
    expect(sdk.signOut).not.toHaveBeenCalled();
    expect(getSession()).toEqual(local);
  });
  it('divergência entre perfil verificado e API revoga a nova sessão e não abre painel', async () => {
    let revoked = '';
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url === '/auth/provider') return json({ provider: 'supabase', configured: true });
        if (url === '/auth/session') return json(verified);
        if (url.endsWith('/auth/supabase'))
          return json({
            ...local,
            accessToken: 'rejected-local',
            user: { ...local.user, role: 'SUPER_ADMIN' },
          });
        if (url.endsWith('/api/v1/auth/logout')) {
          revoked = new Headers(init?.headers).get('Authorization') || '';
          return json({ ok: true });
        }
        return json({ localSessionCleared: true });
      }),
    );
    await expect(loginWeb('operador@example.test', 'senha-teste')).rejects.toMatchObject({
      status: 403,
    });
    expect(revoked).toBe('Bearer rejected-local');
    expect(getSession()).toBeNull();
    expect(sdk.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
