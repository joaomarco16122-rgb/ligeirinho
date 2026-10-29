import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { proxy } from '../../proxy';
import { GET as provider } from '../../app/auth/provider/route';
import { GET as session } from '../../app/auth/session/route';
import { GET as callback } from '../../app/auth/callback/route';
import { POST as logout } from '../../app/auth/logout/route';
vi.mock('@supabase/ssr', () => ({ createServerClient: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
const auth = {
  getUser: vi.fn(),
  getSession: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  signOut: vi.fn(),
};
const store = { getAll: vi.fn(), set: vi.fn() };
const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'fixture@example.test',
  app_metadata: { role: 'ESTABLISHMENT' },
};
let options: any;
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('AUTH_PROVIDER', 'supabase');
  vi.stubEnv('SUPABASE_AUTH_ENABLED', '');
  vi.stubEnv('SUPABASE_URL', '');
  vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', '');
  vi.stubEnv('SUPABASE_ANON_KEY', '');
  vi.stubEnv('NEXT_PUBLIC_AUTH_PROVIDER', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://fixture.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_fixture');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
  vi.mocked(createServerClient).mockImplementation((_url, _key, input) => {
    options = input;
    return { auth } as any;
  });
  vi.mocked(cookies).mockResolvedValue(store as any);
  store.getAll.mockReturnValue([]);
  auth.getUser.mockResolvedValue({ data: { user }, error: null });
  auth.getSession.mockResolvedValue({
    data: { session: { access_token: 'synthetic-access', user } },
    error: null,
  });
  auth.exchangeCodeForSession.mockResolvedValue({ data: {}, error: null });
  auth.signOut.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllEnvs());
describe('Contratos SSR com SDK simulado — não valida autenticação real', () => {
  it('mantém legado somente quando selecionado ou padrão, sem criar cliente Supabase', async () => {
    vi.stubEnv('AUTH_PROVIDER', 'legacy');
    const response = await provider();
    expect(await response.json()).toEqual({ provider: 'legacy', configured: true });
    expect(createServerClient).not.toHaveBeenCalled();
    expect((await proxy(new NextRequest('https://ligeirinho.example/admin'))).status).toBe(200);
    expect(auth.getUser).not.toHaveBeenCalled();
  });
  it('recusa configuração incompleta e seleção inválida sem fallback legado', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
    const response = await provider();
    expect(response.status).toBe(503);
    expect((await response.json()).configured).toBe(false);
    const protectedResponse = await proxy(new NextRequest('https://ligeirinho.example/admin'));
    expect(protectedResponse.status).toBe(503);
    expect(createServerClient).not.toHaveBeenCalled();
    vi.stubEnv('AUTH_PROVIDER', 'supabase-typo');
    expect((await provider()).status).toBe(503);
  });
  it('expõe somente a chave pública validada no momento da requisição e impede cache', async () => {
    expect(await (await provider()).json()).toEqual({
      provider: 'supabase',
      configured: true,
      url: 'https://fixture.supabase.co',
      publishableKey: 'sb_publishable_fixture',
    });
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_changed');
    const response = await provider();
    expect((await response.json()).publishableKey).toBe('sb_publishable_changed');
    expect(response.headers.get('cache-control')).toContain('no-store');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'sb_secret_fixture');
    const rejected = await provider();
    expect(rejected.status).toBe(503);
    expect(await rejected.text()).not.toContain('sb_secret_fixture');
  });
  it('verifica usuário no servidor e preserva cookies renovados ao redirecionar para login', async () => {
    auth.getUser.mockImplementation(async () => {
      options.cookies.setAll([
        {
          name: 'sb-fixture-auth-token',
          value: 'refreshed-fixture',
          options: { path: '/', httpOnly: false, sameSite: 'lax' },
        },
      ]);
      return { data: { user: null }, error: { message: 'expired' } };
    });
    const response = await proxy(new NextRequest('https://ligeirinho.example/admin?aba=operacoes'));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe('/admin?aba=operacoes');
    expect(response.cookies.get('sb-fixture-auth-token')?.value).toBe('refreshed-fixture');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(auth.getSession).not.toHaveBeenCalled();
  });
  it('não concede privilégios vindos de user_metadata e separa rotas por perfil', async () => {
    auth.getUser.mockResolvedValueOnce({
      data: { user: { ...user, app_metadata: {}, user_metadata: { role: 'SUPER_ADMIN' } } },
      error: null,
    });
    expect((await proxy(new NextRequest('https://ligeirinho.example/admin'))).status).toBe(403);
    const response = await proxy(new NextRequest('https://ligeirinho.example/admin'));
    expect(new URL(response.headers.get('location')!).pathname).toBe('/portal');
  });
  it('não consulta sessão sem usuário verificado, nem devolve token de outro usuário', async () => {
    auth.getUser.mockResolvedValueOnce({ data: { user: null }, error: { message: 'invalid' } });
    expect((await session()).status).toBe(401);
    expect(auth.getSession).not.toHaveBeenCalled();
    auth.getSession.mockResolvedValueOnce({
      data: { session: { access_token: 'synthetic-other', user: { id: 'different-user' } } },
      error: null,
    });
    const response = await session();
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain('synthetic-other');
  });
  it('extrai o token apenas após getUser e não inclui refresh token na resposta', async () => {
    const response = await session();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      accessToken: 'synthetic-access',
      user: { id: user.id, email: user.email, role: 'ESTABLISHMENT' },
    });
    expect(auth.getUser.mock.invocationCallOrder[0]).toBeLessThan(
      auth.getSession.mock.invocationCallOrder[0],
    );
    expect(response.headers.get('cache-control')).toContain('no-store');
  });
  it('troca código PKCE e descarta retorno externo ou não autorizado para o perfil', async () => {
    const response = await callback(
      new NextRequest(
        'https://ligeirinho.example/auth/callback?code=synthetic-code&next=https%3A%2F%2Fevil.example',
      ),
    );
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('synthetic-code');
    expect(auth.getUser).toHaveBeenCalled();
    expect(new URL(response.headers.get('location')!).pathname).toBe('/portal');
    const crossRole = await callback(
      new NextRequest('https://ligeirinho.example/auth/callback?code=another-code&next=%2Fadmin'),
    );
    expect(new URL(crossRole.headers.get('location')!).pathname).toBe('/portal');
  });
  it('não aceita callback sem código e limpa sessão sem papel autorizado', async () => {
    expect(
      new URL(
        (await callback(new NextRequest('https://ligeirinho.example/auth/callback'))).headers.get(
          'location',
        )!,
      ).pathname,
    ).toBe('/login');
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
    auth.getUser.mockResolvedValueOnce({
      data: { user: { ...user, app_metadata: {} } },
      error: null,
    });
    const response = await callback(
      new NextRequest('https://ligeirinho.example/auth/callback?code=synthetic-code'),
    );
    expect(new URL(response.headers.get('location')!).pathname).toBe('/login');
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
  it.each(['returned-error', 'network-throw'])(
    'logout remove somente cookies próprios mesmo com falha remota: %s',
    async (failure) => {
      const names = [
        'sb-fixture-auth-token',
        'sb-fixture-auth-token.0',
        'sb-fixture-auth-token.1',
        'sb-fixture-auth-token-code-verifier',
        'sb-fixture-auth-token-code-verifier.0',
        'sb-other-auth-token.0',
        'sb-fixture-auth-token-unrelated',
        'sb-fixture-auth-token.abc',
      ];
      store.getAll.mockReturnValue(names.map((name) => ({ name, value: 'synthetic-cookie' })));
      if (failure === 'returned-error')
        auth.signOut.mockResolvedValueOnce({ error: { message: 'retryable' } });
      else auth.signOut.mockRejectedValueOnce(new Error('network'));
      const response = await logout(
        new NextRequest('https://ligeirinho.example/auth/logout', {
          method: 'POST',
          headers: {
            origin: 'https://ligeirinho.example',
            cookie: names.map((name) => `${name}=synthetic-cookie`).join('; '),
          },
        }),
      );
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({
        localSessionCleared: true,
        remoteRevoked: false,
      });
      for (const name of names.slice(0, 5)) {
        expect(response.cookies.get(name)?.value).toBe('');
        expect(response.cookies.get(name)?.maxAge).toBe(0);
        expect(store.set).toHaveBeenCalledWith(
          name,
          '',
          expect.objectContaining({ maxAge: 0, path: '/' }),
        );
      }
      for (const name of names.slice(5)) {
        expect(response.cookies.get(name)).toBeUndefined();
        expect(store.set.mock.calls.some((call) => call[0] === name)).toBe(false);
      }
    },
  );
  it('logout exige origem correta e encerra somente a sessão atual', async () => {
    const external = await logout(
      new NextRequest('https://ligeirinho.example/auth/logout', {
        method: 'POST',
        headers: { origin: 'https://evil.example' },
      }),
    );
    expect(external.status).toBe(403);
    expect(external.cookies.getAll()).toEqual([]);
    expect(store.set).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
    const missing = await logout(
      new NextRequest('https://ligeirinho.example/auth/logout', { method: 'POST' }),
    );
    expect(missing.status).toBe(403);
    const current = await logout(
      new NextRequest('https://ligeirinho.example/auth/logout', {
        method: 'POST',
        headers: { origin: 'https://ligeirinho.example' },
      }),
    );
    expect(current.status).toBe(200);
    expect(await current.json()).toMatchObject({ localSessionCleared: true, remoteRevoked: true });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: 'local' });
  });
});
