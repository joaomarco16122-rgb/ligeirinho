import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const store = vi.hoisted(() => new Map<string, string>());
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
const key = 'ligeirinho.session.v1';
beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  store.clear();
});
afterEach(() => vi.unstubAllGlobals());
describe('armazenamento cifrado em fragmentos SecureStore', () => {
  it('preserva Unicode nos limites e mantém todos os fragmentos abaixo de 2KB', async () => {
    const { readSecureSession, writeSecureSession } = await import('./secure-session');
    const value = JSON.stringify({
      user: { name: 'a'.repeat(430) + '🚲😃'.repeat(600) },
      accessToken: 'token'.repeat(1600),
      refreshToken: 'refresh'.repeat(700),
    });
    await writeSecureSession(value);
    expect(await readSecureSession()).toBe(value);
    expect(
      [...store.values()].every((value) => new TextEncoder().encode(value).length <= 2048),
    ).toBe(true);
    await writeSecureSession(null);
    expect(store.size).toBe(0);
  });
  it('publica a nova referência somente após gravar todos os fragmentos e preserva anterior em falha', async () => {
    const storage = await import('./secure-session');
    const native = await import('expo-secure-store');
    const old = JSON.stringify({ refreshToken: 'previous-trusted-refresh' });
    await storage.writeSecureSession(old);
    const marker = store.get(key);
    vi.mocked(native.setItemAsync).mockImplementation(async (name, value) => {
      if (name.endsWith('.1')) throw new Error('SecureStore unavailable');
      store.set(name, value);
    });
    await expect(
      storage.writeSecureSession(JSON.stringify({ refreshToken: 'new'.repeat(600) })),
    ).rejects.toThrow('unavailable');
    expect(store.get(key)).toBe(marker);
    expect(await storage.readSecureSession()).toBe(old);
    expect([...store.values()].some((value) => value.includes('newnew'))).toBe(false);
  });
  it('reinício no mesmo instante usa IDs independentes e não apaga os novos fragmentos', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1234567890);
    const first = await import('./secure-session');
    await first.writeSecureSession('first-record');
    const previous = JSON.parse(store.get(key)!).id;
    vi.resetModules();
    const second = await import('./secure-session');
    await second.writeSecureSession('second-record');
    expect(JSON.parse(store.get(key)!).id).not.toBe(previous);
    expect(await second.readSecureSession()).toBe('second-record');
    expect([...store.keys()].some((name) => name.includes(previous))).toBe(false);
  });
  it('fragmento ausente falha fechado e a limpeza remove a referência autoritativa', async () => {
    const storage = await import('./secure-session');
    await storage.writeSecureSession('secure'.repeat(100));
    const entry = JSON.parse(store.get(key)!);
    store.delete(`${key}.chunks.${entry.id}.0`);
    await expect(storage.readSecureSession()).rejects.toThrow('incompleta');
    await storage.writeSecureSession(null);
    expect(store.size).toBe(0);
  });
});
