export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export interface TokenStorage {
  getAccessToken(): Promise<string | null>;
  clear(): Promise<void>;
}
/** Token storage is supplied by the host: memory on web, SecureStore on Android. */
export class LigeirinhoClient {
  constructor(
    private readonly baseUrl: string,
    private readonly tokens: TokenStorage,
  ) {}
  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Caminho de API inválido');
    const token = await this.tokens.getAccessToken();
    const headers = new Headers(options.headers);
    if (options.body && !headers.has('Content-Type'))
      headers.set('Content-Type', 'application/json');
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      ...options,
      headers,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 401) await this.tokens.clear();
      const message =
        payload && typeof payload === 'object' && 'message' in payload
          ? String(payload.message)
          : 'Não foi possível concluir a operação';
      throw new ApiError(response.status, message);
    }
    return payload as T;
  }
}
