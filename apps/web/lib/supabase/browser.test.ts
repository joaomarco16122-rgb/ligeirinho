import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserClient } from '@supabase/ssr';
vi.mock('@supabase/ssr', () => ({ createBrowserClient: vi.fn() }));
beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
});
afterEach(() => vi.unstubAllGlobals());
describe('Cliente browser Supabase com configuração HTTP simulada, sem conta real', () => {
  it('obtém configuração pública no runtime e compartilha somente uma criação concorrente', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            provider: 'supabase',
            configured: true,
            url: 'https://fixture.supabase.co',
            publishableKey: 'sb_publishable_fixture',
          }),
        ),
      ),
    );
    const sentinel = { auth: {} };
    vi.mocked(createBrowserClient).mockReturnValue(sentinel as any);
    const { createSupabaseBrowserClient } = await import('./browser');
    const [first, second] = await Promise.all([
      createSupabaseBrowserClient(),
      createSupabaseBrowserClient(),
    ]);
    expect(first).toBe(sentinel);
    expect(second).toBe(sentinel);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith('/auth/provider', {
      cache: 'no-store',
      credentials: 'same-origin',
    });
    expect(createBrowserClient).toHaveBeenCalledWith(
      'https://fixture.supabase.co',
      'sb_publishable_fixture',
      expect.any(Object),
    );
  });
  it('recusa credencial privada mesmo se uma resposta HTTP mal configurada a fornecer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            provider: 'supabase',
            configured: true,
            url: 'https://fixture.supabase.co',
            publishableKey: 'sb_secret_fixture',
          }),
        ),
      ),
    );
    const { createSupabaseBrowserClient } = await import('./browser');
    await expect(createSupabaseBrowserClient()).rejects.toThrow(
      'A autenticação está indisponível.',
    );
    expect(createBrowserClient).not.toHaveBeenCalled();
  });
  it('não converte indisponibilidade em autenticação legada e permite tentar carregar configuração novamente', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ provider: 'supabase', configured: false }), { status: 503 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ provider: 'legacy', configured: true })),
      );
    vi.stubGlobal('fetch', fetcher);
    const { createSupabaseBrowserClient } = await import('./browser');
    await expect(createSupabaseBrowserClient()).rejects.toThrow(
      'A autenticação está indisponível.',
    );
    await expect(createSupabaseBrowserClient()).rejects.toThrow(
      'A autenticação está indisponível.',
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(createBrowserClient).not.toHaveBeenCalled();
  });
  it('não reproduz detalhes sensíveis de falhas do SDK no erro público', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            provider: 'supabase',
            configured: true,
            url: 'https://fixture.supabase.co',
            publishableKey: 'sb_publishable_fixture',
          }),
        ),
      ),
    );
    vi.mocked(createBrowserClient).mockImplementation(() => {
      throw new Error('fixture-sensitive-sdk-detail');
    });
    const { createSupabaseBrowserClient } = await import('./browser');
    await expect(createSupabaseBrowserClient()).rejects.not.toThrow('fixture-sensitive-sdk-detail');
  });
});
