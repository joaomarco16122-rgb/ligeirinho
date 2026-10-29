import { isIP } from 'node:net';
import type { NestExpressApplication } from '@nestjs/platform-express';

function normalizeAddress(address: string): string {
  if (isIP(address) === 4) return address;
  let canonical = address.toLowerCase();
  try {
    canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  } catch {
    // Scoped IPv6 literals are compared exactly if URL canonicalization is unavailable.
  }
  const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(canonical);
  if (!mapped) return canonical;
  const high = Number.parseInt(mapped[1]!, 16),
    low = Number.parseInt(mapped[2]!, 16);
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}

// Keep backend ingress private. An explicit bridge/proxy IP takes precedence over
// local-proxy mode and never grants trust to an entire subnet or forwarded chain.
export function configureProxyTrust(
  app: Pick<NestExpressApplication, 'set'>,
  flag: string | undefined,
  proxyAddress?: string,
): void {
  if (proxyAddress !== undefined && proxyAddress !== '') {
    if (!isIP(proxyAddress))
      throw new Error('TRUST_PROXY_ADDRESS deve ser um único endereço IP válido, sem CIDR.');
    const trusted = normalizeAddress(proxyAddress);
    app.set(
      'trust proxy',
      (remoteAddress: string) =>
        Boolean(isIP(remoteAddress)) && normalizeAddress(remoteAddress) === trusted,
    );
    return;
  }
  app.set('trust proxy', flag === '1' ? 'loopback' : false);
}
export function authenticationTraffic(req: { path?: string }): boolean {
  return /^\/api\/v1\/auth\/(login|supabase|refresh|change-password)(?:\/|$)/.test(req.path ?? '');
}
export function trafficLimit(req: { path?: string }): number {
  return authenticationTraffic(req) ? 10 : 240;
}
export function trafficKey(
  req: { ip?: string; socket: { remoteAddress?: string }; path?: string },
  now = Date.now(),
): string {
  // Express resolves req.ip using the trust policy above. Never parse XFF here.
  const address = req.ip || req.socket.remoteAddress || 'unknown';
  const group = authenticationTraffic(req) ? 'login' : 'api';
  return `limit:${address}:${group}:${Math.floor(now / 60000)}`;
}
