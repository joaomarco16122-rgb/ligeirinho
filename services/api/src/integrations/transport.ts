import { EnvHttpProxyAgent, fetch } from 'undici';

export interface HttpResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type HttpTransport = (
  url: string,
  init: {
    method: 'GET' | 'POST' | 'PUT';
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
    redirect: 'error';
  },
) => Promise<HttpResponse>;
let dispatcher: EnvHttpProxyAgent | undefined;
// Respect inherited proxy/no-proxy settings and Node CA trust; never disable TLS.
export const proxyAwareTransport: HttpTransport = (url, init) => {
  dispatcher ??= new EnvHttpProxyAgent();
  return fetch(url, { ...init, dispatcher });
};
export async function closeIntegrationTransport(): Promise<void> {
  await dispatcher?.close();
  dispatcher = undefined;
}
export class IntegrationUnavailable extends Error {
  constructor(public readonly provider: string) {
    super(`Integração ${provider} indisponível; nenhuma operação externa foi confirmada.`);
    this.name = 'IntegrationUnavailable';
  }
}
export function production(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === 'production';
}
