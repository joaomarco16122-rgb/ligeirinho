export const supabaseRoles = ['SUPER_ADMIN', 'ADMIN', 'ESTABLISHMENT', 'COURIER'] as const;
export type SupabaseRole = (typeof supabaseRoles)[number];
export function roleFromMetadata(user: { app_metadata?: unknown }): SupabaseRole | null {
  const metadata = user.app_metadata;
  if (!metadata || typeof metadata !== 'object' || !Object.hasOwn(metadata, 'role')) return null;
  const role = (metadata as { role?: unknown }).role;
  return typeof role === 'string' && supabaseRoles.includes(role as SupabaseRole)
    ? (role as SupabaseRole)
    : null;
}
export function roleDestination(role: SupabaseRole): string {
  return role === 'SUPER_ADMIN' || role === 'ADMIN'
    ? '/admin'
    : role === 'ESTABLISHMENT'
      ? '/portal'
      : '/downloads';
}
function isWithin(pathname: string, route: string) {
  return pathname === route || pathname.startsWith(`${route}/`);
}
export function canAccess(role: SupabaseRole | null, pathname: string): boolean {
  if (isWithin(pathname, '/admin')) return role === 'SUPER_ADMIN' || role === 'ADMIN';
  if (isWithin(pathname, '/portal')) return role === 'ESTABLISHMENT';
  return true;
}
export function safeReturnPath(input: string | null | undefined, fallback = '/portal'): string {
  if (!input || input.length > 2048) return fallback;
  let decoded = input;
  try {
    for (let round = 0; round < 3; round++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
    if (
      !decoded.startsWith('/') ||
      decoded.startsWith('//') ||
      decoded.includes('\\') ||
      Array.from(decoded).some(
        (character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
      )
    )
      return fallback;
    const destination = new URL(decoded, 'https://same-origin.invalid');
    if (
      destination.origin !== 'https://same-origin.invalid' ||
      isWithin(destination.pathname, '/auth') ||
      isWithin(destination.pathname, '/login')
    )
      return fallback;
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return fallback;
  }
}
export function isSameOrigin(request: {
  url: string;
  headers: { get(name: string): string | null };
}) {
  const originHeader = request.headers.get('origin');
  if (!originHeader) return false;
  try {
    const origin = new URL(originHeader);
    const url = new URL(request.url);
    if (
      origin.origin !== originHeader ||
      !['http:', 'https:'].includes(origin.protocol) ||
      !['http:', 'https:'].includes(url.protocol)
    )
      return false;
    // Next can canonicalize the route URL to localhost even when the browser sent
    // Host:127.0.0.1. The actual Host authority must match the browser's Origin.
    // Never substitute X-Forwarded-Host or choose an entry from a forwarded list.
    const host = request.headers.get('host');
    let authority = url.host;
    if (host !== null) {
      if (!host || /[\s,/@\\?#]/u.test(host)) return false;
      const parsed = new URL(`${origin.protocol}//${host}`);
      if (
        parsed.username ||
        parsed.password ||
        parsed.pathname !== '/' ||
        parsed.search ||
        parsed.hash
      )
        return false;
      authority = parsed.host;
    }
    if (origin.host !== authority) return false;
    // The supplied Nginx topology overwrites X-Forwarded-Proto with its TLS
    // scheme. Only that single http/https value is supported; chains are denied.
    const forwarded = request.headers.get('x-forwarded-proto');
    if (forwarded !== null && forwarded !== 'http' && forwarded !== 'https') return false;
    const protocol = forwarded === null ? url.protocol : `${forwarded}:`;
    return origin.protocol === protocol;
  } catch {
    return false;
  }
}
