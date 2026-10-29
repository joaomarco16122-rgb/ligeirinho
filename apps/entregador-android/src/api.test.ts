import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const store = vi.hoisted(() => new Map<string, string>());
const sdk = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  setSession: vi.fn(),
  refreshSession: vi.fn(),
  signOut: vi.fn(),
}));
const createClient = vi.hoisted(() => vi.fn());
vi.mock('@supabase/supabase-js', () => ({ createClient }));
vi.mock('expo-crypto', () => ({ randomUUID: () => crypto.randomUUID() }));
vi.mock('expo-secure-store', () => ({
  setItemAsync: vi.fn(async (key: string, value: string) => {
    store.set(key, value);
  }),
  getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
  deleteItemAsync: vi.fn(async (key: string) => {
    store.delete(key);
  }),
}));
const session = {
  accessToken: 'initial-access',
  refreshToken: 'initial-refresh',
  user: { id: 'courier-user', name: 'Entregador', role: 'COURIER' },
};
const proof = {
  access_token: 'synthetic-provider-access',
  refresh_token: 'synthetic-provider-refresh',
  user: { id: 'provider-uid', app_metadata: { role: 'SUPER_ADMIN' } },
};
const legacy = { provider: 'legacy', configured: true };
const supabase = {
  provider: 'supabase',
  configured: true,
  url: 'https://fixture.supabase.co',
  publishableKey: 'sb_publishable_fixture_only',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const stored = async () => {
  const { readSecureSession } = await import('./secure-session');
  const text = await readSecureSession();
  return text ? JSON.parse(text) : null;
};
beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  store.clear();
  sdk.signInWithPassword.mockReset().mockResolvedValue({ data: { session: proof }, error: null });
  sdk.setSession.mockReset().mockImplementation(async (tokens) => ({
    data: { session: { ...proof, ...tokens } },
    error: null,
  }));
  sdk.refreshSession.mockReset().mockResolvedValue({
    data: {
      session: {
        ...proof,
        access_token: 'renewed-provider-access',
        refresh_token: 'renewed-provider-refresh',
      },
    },
    error: null,
  });
  sdk.signOut.mockReset().mockResolvedValue({ error: null });
  createClient.mockReset().mockReturnValue({ auth: sdk });
});
afterEach(() => vi.unstubAllGlobals());
describe('sessão Android — contrato com Auth SDK/HTTP controlados, sem serviço remoto real', () => {
  it('não salva conta de outro perfil e revoga a sessão recusada', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return url.endsWith('/auth/provider')
          ? json(legacy)
          : url.endsWith('/auth/login')
            ? json({ ...session, user: { ...session.user, role: 'ESTABLISHMENT' } })
            : json({});
      }),
    );
    const client = await import('./api');
    await expect(client.login('loja@example.test', 'senha-teste', 'COURIER')).rejects.toThrow(
      'não pertence',
    );
    expect(store.size).toBe(0);
    expect(urls.some((url) => url.endsWith('/auth/logout'))).toBe(true);
    expect(createClient).not.toHaveBeenCalled();
  });
  it('compartilha uma única rotação de refresh legado entre requisições concorrentes', async () => {
    let refreshes = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith('/auth/provider')) return json(legacy);
        if (url.endsWith('/auth/login')) return json(session);
        if (url.endsWith('/auth/refresh')) {
          refreshes++;
          await Promise.resolve();
          return json({
            ...session,
            accessToken: 'rotated-access',
            refreshToken: 'rotated-refresh',
          });
        }
        return (init.headers as Record<string, string>).Authorization === 'Bearer rotated-access'
          ? json({ ok: true })
          : json({ message: 'Expirado' }, 401);
      }),
    );
    const client = await import('./api');
    await client.login('pessoa@example.test', 'senha-teste', 'COURIER');
    expect(await Promise.all([client.api('/courier/me'), client.api('/courier/offers')])).toEqual([
      { ok: true },
      { ok: true },
    ]);
    expect(refreshes).toBe(1);
    expect((await stored()).refreshToken).toBe('rotated-refresh');
  });
  it('uma resposta tardia de refresh legado não restaura a sessão após sair', async () => {
    let release!: (value: Response) => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const delayed = new Promise<Response>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/auth/provider')) return json(legacy);
        if (url.endsWith('/auth/login')) return json(session);
        if (url.endsWith('/auth/logout')) return json({});
        if (url.endsWith('/auth/refresh')) {
          started();
          return delayed;
        }
        return json({ message: 'Expirado' }, 401);
      }),
    );
    const client = await import('./api');
    await client.login('pessoa@example.test', 'senha-teste', 'COURIER');
    const pending = client.api('/courier/me');
    const rejection = expect(pending).rejects.toThrow('sessão foi encerrada');
    await waiting;
    await client.logout();
    release(json({ ...session, accessToken: 'late-access' }));
    await rejection;
    expect(client.currentUser()).toBeNull();
    expect(store.size).toBe(0);
  });
  it('provedor incompleto ou indisponível falha fechado sem login legado', async () => {
    const fetch = vi.fn().mockResolvedValue(json({ provider: 'supabase', configured: false }, 503));
    vi.stubGlobal('fetch', fetch);
    const client = await import('./api');
    await expect(client.login('pessoa@example.test', 'senha-teste', 'COURIER')).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(sdk.signInWithPassword).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });
  it('Supabase envia apenas access token ao backend e usa o perfil confirmado pelo banco', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        urls.push(url);
        if (url.endsWith('/auth/provider')) return json(supabase);
        expect(url).toMatch(/\/auth\/supabase$/);
        expect(JSON.parse(String(init.body))).toEqual({ accessToken: proof.access_token });
        return json(session);
      }),
    );
    const client = await import('./api');
    expect(await client.login('pessoa@example.test', 'senha-teste', 'COURIER')).toEqual(
      session.user,
    );
    expect(urls.some((url) => url.endsWith('/auth/login'))).toBe(false);
    expect(createClient).toHaveBeenCalledWith(
      supabase.url,
      supabase.publishableKey,
      expect.objectContaining({
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      }),
    );
    expect((await stored()).providerTokens.refreshToken).toBe(proof.refresh_token);
    expect((await stored()).user.role).toBe('COURIER');
  });
  it('renovação Supabase é compartilhada e nunca usa o refresh Nest', async () => {
    let exchanges = 0;
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        urls.push(url);
        if (url.endsWith('/auth/provider')) return json(supabase);
        if (url.endsWith('/auth/supabase')) {
          exchanges++;
          return json({
            ...session,
            accessToken: exchanges === 1 ? 'old-access' : 'renewed-access',
          });
        }
        return (init.headers as Record<string, string>).Authorization === 'Bearer renewed-access'
          ? json({ ok: true })
          : json({}, 401);
      }),
    );
    const client = await import('./api');
    await client.login('pessoa@example.test', 'senha-teste', 'COURIER');
    expect(await Promise.all([client.api('/courier/me'), client.api('/courier/offers')])).toEqual([
      { ok: true },
      { ok: true },
    ]);
    expect(sdk.refreshSession).toHaveBeenCalledTimes(1);
    expect(exchanges).toBe(2);
    expect(urls.some((url) => url.endsWith('/auth/refresh'))).toBe(false);
    expect((await stored()).providerTokens.refreshToken).toBe('renewed-provider-refresh');
  });
  it('restaura a sessão Supabase criptografada após reiniciar e comprova novamente o vínculo', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('/auth/provider') ? json(supabase) : json(session),
    );
    vi.stubGlobal('fetch', fetch);
    const initial = await import('./api');
    await initial.login('pessoa@example.test', 'senha-teste', 'COURIER');
    vi.resetModules();
    const client = await import('./api');
    expect(await client.restore('COURIER')).toEqual(session.user);
    expect(sdk.setSession).toHaveBeenCalledWith({
      access_token: proof.access_token,
      refresh_token: proof.refresh_token,
    });
    expect(fetch.mock.calls.filter(([url]) => url.endsWith('/auth/supabase'))).toHaveLength(2);
  });
  it('restaurações concorrentes compartilham a rotação de refresh e uma única troca verificada', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/auth/provider') ? json(supabase) : json(session),
      ),
    );
    const initial = await import('./api');
    await initial.login('pessoa@example.test', 'senha-teste', 'COURIER');
    vi.resetModules();
    sdk.setSession.mockImplementationOnce(async () => ({
      data: { session: { ...proof, refresh_token: 'rotated-by-restore' } },
      error: null,
    }));
    const fetch = vi.mocked(globalThis.fetch);
    const client = await import('./api');
    expect(await Promise.all([client.restore('COURIER'), client.restore('COURIER')])).toEqual([
      session.user,
      session.user,
    ]);
    expect(sdk.setSession).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/auth/supabase'))).toHaveLength(
      2,
    );
    expect((await stored()).providerTokens.refreshToken).toBe('rotated-by-restore');
    expect(sdk.signOut).not.toHaveBeenCalled();
  });
  it('não entrega refresh token salvo para outro projeto após mudança de configuração', async () => {
    let changed = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/auth/provider')
          ? json({ ...supabase, url: changed ? 'https://other.supabase.co' : supabase.url })
          : json(session),
      ),
    );
    const initial = await import('./api');
    await initial.login('pessoa@example.test', 'senha-teste', 'COURIER');
    changed = true;
    vi.resetModules();
    const client = await import('./api');
    await expect(client.restore('COURIER')).rejects.toThrow('provedor de autenticação mudou');
    expect(sdk.setSession).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });
  it('logout aguarda login SDK atrasado, não persiste os tokens e encerra o provedor', async () => {
    let release!: () => void;
    let sdkIdentity: string | null = null;
    sdk.signInWithPassword.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => {
            sdkIdentity = 'late-provider-user';
            resolve({ data: { session: proof }, error: null });
          };
        }),
    );
    sdk.signOut.mockImplementation(async () => {
      sdkIdentity = null;
      return { error: null };
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => (url.endsWith('/auth/provider') ? json(supabase) : json({}))),
    );
    const client = await import('./api');
    const entering = client
      .login('pessoa@example.test', 'senha-teste', 'COURIER')
      .catch((error) => error);
    await vi.waitFor(() => expect(sdk.signInWithPassword).toHaveBeenCalledTimes(1));
    const leaving = client.logout();
    expect(client.currentUser()).toBeNull();
    expect(sdk.signOut).not.toHaveBeenCalled();
    release();
    expect(await entering).toMatchObject({
      message: expect.stringContaining('sessão foi encerrada'),
    });
    await leaving;
    expect(sdkIdentity).toBeNull();
    expect(store.size).toBe(0);
  });
  it('logout tenta ambos os lados e limpa armazenamento mesmo se a revogação Nest falhar', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/auth/provider')
          ? json(supabase)
          : url.endsWith('/auth/logout')
            ? json({ message: 'Sem conexão com sessão' }, 503)
            : json(session),
      ),
    );
    const client = await import('./api');
    await client.login('pessoa@example.test', 'senha-teste', 'COURIER');
    await expect(client.logout()).rejects.toThrow('Sem conexão');
    expect(sdk.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(store.size).toBe(0);
    expect(client.currentUser()).toBeNull();
  });
  it('vínculo recusado não cria conta por e-mail nem retorna ao login legado', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return url.endsWith('/auth/provider')
          ? json(supabase)
          : json({ message: 'Conta não vinculada' }, 403);
      }),
    );
    const client = await import('./api');
    await expect(client.login('pessoa@example.test', 'senha-teste', 'COURIER')).rejects.toThrow(
      'não vinculada',
    );
    expect(urls.some((url) => url.endsWith('/auth/login'))).toBe(false);
    expect(store.size).toBe(0);
    expect(sdk.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it('persiste refresh rotacionado antes da troca e o preserva quando a API está indisponível', async () => {
    let exchanges = 0;
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        urls.push(url);
        if (url.endsWith('/auth/provider')) return json(supabase);
        if (url.endsWith('/auth/supabase')) {
          exchanges++;
          if (exchanges === 2) {
            expect((await stored()).providerTokens.refreshToken).toBe('renewed-provider-refresh');
            return json({ message: 'API temporariamente indisponível' }, 503);
          }
          return json({
            ...session,
            accessToken: exchanges === 1 ? 'old-access' : 'latest-access',
          });
        }
        return (init.headers as Record<string, string>).Authorization === 'Bearer latest-access'
          ? json({ ok: true })
          : json({}, 401);
      }),
    );
    const client = await import('./api');
    await client.login('pessoa@example.test', 'senha-teste', 'COURIER');
    await expect(client.api('/courier/me')).rejects.toThrow('temporariamente');
    expect((await stored()).providerTokens.refreshToken).toBe('renewed-provider-refresh');
    expect(sdk.signOut).not.toHaveBeenCalled();
    expect(client.currentUser()).toEqual(session.user);
    expect(await client.api('/courier/me')).toEqual({ ok: true });
    expect(sdk.setSession).toHaveBeenLastCalledWith({
      access_token: 'renewed-provider-access',
      refresh_token: 'renewed-provider-refresh',
    });
    expect(urls.some((url) => url.endsWith('/auth/login') || url.endsWith('/auth/refresh'))).toBe(
      false,
    );
  });
  it('uma nova entrada aguarda limpeza do logout sem ser apagada pelo login anterior atrasado', async () => {
    let release!: () => void;
    let identity: string | null = null;
    sdk.signInWithPassword
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            release = () => {
              identity = 'obsolete';
              resolve({ data: { session: proof }, error: null });
            };
          }),
      )
      .mockImplementationOnce(async () => {
        identity = 'new';
        return { data: { session: { ...proof, refresh_token: 'new-login-refresh' } }, error: null };
      });
    sdk.signOut.mockImplementation(async () => {
      identity = null;
      return { error: null };
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/auth/provider') ? json(supabase) : json(session),
      ),
    );
    const client = await import('./api');
    const old = client.login('old@example.test', 'senha-antiga', 'COURIER').catch((error) => error);
    await vi.waitFor(() => expect(sdk.signInWithPassword).toHaveBeenCalledTimes(1));
    const leaving = client.logout();
    const entering = client.login('new@example.test', 'senha-nova', 'COURIER');
    release();
    expect(await old).toMatchObject({ message: expect.stringContaining('sessão foi encerrada') });
    await leaving;
    expect(await entering).toEqual(session.user);
    expect(identity).toBe('new');
    expect((await stored()).providerTokens.refreshToken).toBe('new-login-refresh');
    expect(client.currentUser()).toEqual(session.user);
  });
  it('SDK oficial executa login, renovação e logout com HTTP controlado e sem persistência insegura', async () => {
    const actual =
      await vi.importActual<typeof import('@supabase/supabase-js')>('@supabase/supabase-js');
    createClient.mockImplementation(actual.createClient);
    const uid = '11111111-1111-4111-8111-111111111111';
    const sid = '22222222-2222-4222-8222-222222222222';
    const jwt = (nonce: string) =>
      [
        Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
        Buffer.from(
          JSON.stringify({
            sub: uid,
            exp: Math.floor(Date.now() / 1000) + 3600,
            aud: 'authenticated',
            role: 'authenticated',
            session_id: sid,
            nonce,
          }),
        ).toString('base64url'),
        'c3ludGhldGljLXNpZ25hdHVyZQ',
      ].join('.');
    const user = {
      id: uid,
      email: 'sdk@example.test',
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00.000Z',
    };
    let refreshes = 0;
    let exchanges = 0;
    let signsOut = 0;
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        urls.push(url);
        if (url.endsWith('/auth/provider')) return json(supabase);
        if (url.includes('/auth/v1/token')) {
          const refreshing = url.includes('grant_type=refresh_token');
          if (refreshing) refreshes++;
          return json({
            access_token: jwt(refreshing ? 'renewed' : 'initial'),
            refresh_token: refreshing ? 'sdk-renewed-refresh' : 'sdk-initial-refresh',
            token_type: 'bearer',
            expires_in: 3600,
            user,
          });
        }
        if (url.endsWith('/auth/v1/user')) return json(user);
        if (url.includes('/auth/v1/logout')) {
          signsOut++;
          return new Response(null, { status: 204 });
        }
        if (url.endsWith('/auth/supabase')) {
          exchanges++;
          return json({ ...session, accessToken: exchanges === 1 ? 'old-nest' : 'renewed-nest' });
        }
        if (url.endsWith('/auth/logout')) return json({ ok: true });
        return (init?.headers as Record<string, string>).Authorization === 'Bearer renewed-nest'
          ? json({ ok: true })
          : json({}, 401);
      }),
    );
    const client = await import('./api');
    expect(await client.login('sdk@example.test', 'SyntheticPassword123', 'COURIER')).toEqual(
      session.user,
    );
    expect(await client.api('/courier/me')).toEqual({ ok: true });
    expect(refreshes).toBe(1);
    expect((await stored()).providerTokens.refreshToken).toBe('sdk-renewed-refresh');
    await client.logout();
    expect(signsOut).toBe(1);
    expect(client.currentUser()).toBeNull();
    expect(store.size).toBe(0);
    expect(urls.some((url) => url.endsWith('/auth/login') || url.endsWith('/auth/refresh'))).toBe(
      false,
    );
  });
  it('lê a sessão legada anterior e verifica o perfil antes de reutilizá-la', async () => {
    store.set('ligeirinho.session.v1', JSON.stringify(session));
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.endsWith('/auth/provider') ? json(legacy) : json(session.user),
      ),
    );
    const client = await import('./api');
    expect(await client.restore('COURIER')).toEqual(session.user);
    expect((await stored()).accessToken).toBe(session.accessToken);
    expect(createClient).not.toHaveBeenCalled();
  });
});
