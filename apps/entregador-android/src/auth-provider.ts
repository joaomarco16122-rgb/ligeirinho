export type NativeAuthProvider =
  { provider: 'legacy' } | { provider: 'supabase'; url: string; publishableKey: string };
const unavailable = () =>
  new Error('A autenticação não está configurada corretamente. Consulte a administração.');
// Hermes does not guarantee atob/TextDecoder. Decode configuration JWT payloads
// portably; this is a public-key guard, never a user authentication check.
function decodeBase64Url(value: string): string {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(value) || value.replace(/=+$/, '').length % 4 === 1)
    throw unavailable();
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let bits = 0;
  let buffer = 0;
  const bytes: number[] = [];
  for (const character of value.replace(/=+$/, '').replaceAll('-', '+').replaceAll('_', '/')) {
    buffer = (buffer << 6) | alphabet.indexOf(character);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
      buffer &= (1 << bits) - 1;
    }
  }
  return decodeURIComponent(bytes.map((byte) => '%' + byte.toString(16).padStart(2, '0')).join(''));
}
export function parseAuthProvider(value: unknown): NativeAuthProvider {
  if (!value || typeof value !== 'object') throw unavailable();
  const config = value as Record<string, unknown>;
  if (config.configured !== true) throw unavailable();
  if (config.provider === 'legacy') return { provider: 'legacy' };
  if (
    config.provider !== 'supabase' ||
    typeof config.url !== 'string' ||
    typeof config.publishableKey !== 'string'
  )
    throw unavailable();
  let url: URL;
  try {
    url = new URL(config.url);
  } catch {
    throw unavailable();
  }
  const labels = url.hostname.split('.');
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== '/' ||
    url.search ||
    url.hash ||
    labels.length < 2 ||
    !labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
    /^\d+(?:\.\d+){3}$/.test(url.hostname) ||
    /(^|\.)(localhost|local|internal)$/.test(url.hostname)
  )
    throw unavailable();
  const key = config.publishableKey;
  if (key.length > 8192) throw unavailable();
  let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key);
  if (!publicKey && key.split('.').length === 3) {
    try {
      const payload = JSON.parse(decodeBase64Url(key.split('.')[1]));
      publicKey = payload !== null && typeof payload === 'object' && payload.role === 'anon';
    } catch {
      /* Reject malformed/private credentials without returning their contents. */
    }
  }
  if (!publicKey) throw unavailable();
  return { provider: 'supabase', url: url.origin, publishableKey: key };
}
