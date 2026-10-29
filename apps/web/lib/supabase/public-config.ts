export class AuthConfigurationError extends Error {
  constructor() {
    super('A autenticação está indisponível. A administração precisa concluir a configuração.');
  }
}
export function assertPublicSupabaseKey(key: string): void {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return;
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replaceAll('-', '+').replaceAll('_', '/')));
      if (
        payload !== null &&
        typeof payload === 'object' &&
        Object.hasOwn(payload, 'role') &&
        payload.role === 'anon'
      )
        return;
    } catch {
      /* Reject malformed credentials without returning their contents. */
    }
  }
  throw new AuthConfigurationError();
}
export function validateSupabaseProjectUrl(input: string | undefined): URL {
  let url: URL;
  try {
    url = new URL(input || '');
  } catch {
    throw new AuthConfigurationError();
  }
  const host = url.hostname.toLowerCase();
  const labels = host.split('.');
  const dns =
    host.length <= 253 &&
    labels.length >= 2 &&
    labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if (
    url.protocol !== 'https:' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    !dns ||
    /^\d+(?:\.\d+){3}$/.test(host) ||
    host === 'localhost' ||
    host.endsWith('.localhost')
  )
    throw new AuthConfigurationError();
  return url;
}
export function supabaseCookieName(url: string): string {
  return `sb-${validateSupabaseProjectUrl(url).hostname.split('.')[0]}-auth-token`;
}
export function sessionCookieNames(names: readonly string[], base: string): string[] {
  const bases = [base, `${base}-code-verifier`];
  return [
    ...new Set([
      ...bases,
      ...names.filter((name) =>
        bases.some(
          (prefix) =>
            name === prefix ||
            (name.startsWith(`${prefix}.`) && /^\d+$/.test(name.slice(prefix.length + 1))),
        ),
      ),
    ]),
  ];
}
export function validateSupabasePublicConfig(input: string | undefined, key: string | undefined) {
  const url = validateSupabaseProjectUrl(input);
  if (!key) throw new AuthConfigurationError();
  assertPublicSupabaseKey(key);
  return { url: url.origin, key };
}
