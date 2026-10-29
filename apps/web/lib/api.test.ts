import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, getSession, logout, setSession, type Session } from './api';
const session: Session = {
  accessToken: 'initial-access',
  refreshToken: 'initial-refresh',
  user: { id: '1', email: 'user@example.test', role: 'ESTABLISHMENT' },
};
afterEach(() => {
  setSession(null);
  vi.unstubAllGlobals();
});
describe('Cliente HTTP autenticado', () => {
  it('preserva erros de validação do servidor em português', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ message: ['Endereço obrigatório', 'Latitude inválida'] }), {
          status: 400,
        }),
      ),
    );
    await expect(api('/deliveries')).rejects.toThrow('Endereço obrigatório. Latitude inválida');
  });
  it('renova sessão uma única vez para requisições concorrentes e repete com o novo token', async () => {
    setSession({ ...session });
    let refreshes = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        if (url.endsWith('/auth/refresh')) {
          refreshes++;
          await new Promise((r) => setTimeout(r, 5));
          return new Response(
            JSON.stringify({ accessToken: 'renewed-access', refreshToken: 'renewed-refresh' }),
          );
        }
        const auth = new Headers(init.headers).get('Authorization');
        return auth === 'Bearer renewed-access'
          ? new Response(JSON.stringify({ ok: true }))
          : new Response('{}', { status: 401 });
      }),
    );
    expect(await Promise.all([api('/deliveries'), api('/auth/me')])).toEqual([
      { ok: true },
      { ok: true },
    ]);
    expect(refreshes).toBe(1);
    expect(getSession()?.refreshToken).toBe('renewed-refresh');
  });
  it('remove tokens da memória quando a renovação é rejeitada', async () => {
    setSession({ ...session });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    await expect(api('/deliveries')).rejects.toBeInstanceOf(ApiError);
    expect(getSession()).toBeNull();
  });
  it('distingue indisponibilidade de rede de uma confirmação do servidor', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network')));
    await expect(api('/deliveries')).rejects.toMatchObject({ status: 0 });
  });
  it('refresh legado atrasado não ressuscita uma sessão encerrada', async () => {
    setSession({ ...session });
    let release!: (response: Response) => void;
    let waiting = false;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/auth/refresh')) {
          waiting = true;
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        }
        if (url.endsWith('/auth/logout')) return new Response('{}');
        return new Response('{}', { status: 401 });
      }),
    );
    const pending = api('/deliveries');
    await vi.waitFor(() => expect(waiting).toBe(true));
    await logout();
    release(
      new Response(JSON.stringify({ accessToken: 'late-access', refreshToken: 'late-refresh' })),
    );
    await expect(pending).rejects.toMatchObject({ status: 401 });
    expect(getSession()).toBeNull();
  });
});
