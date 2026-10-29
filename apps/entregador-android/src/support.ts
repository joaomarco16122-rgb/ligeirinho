export interface SupportContext {
  audience: 'courier' | 'establishment';
  version: string;
  apiUrl: string;
  lastSyncAt: number | null;
  status?: string;
  now?: number;
}
function utc(timestamp: number | null): string {
  if (timestamp === null) return 'Ainda não confirmada';
  const date = new Date(timestamp);
  return Number.isFinite(date.getTime()) ? date.toISOString() : 'Data indisponível';
}
/** Deliberately selects non-secret diagnostics; never includes session, GPS or addresses. */
export function supportReport(context: SupportContext): string {
  let server = 'Endereço indisponível';
  try {
    const url = new URL(context.apiUrl);
    if (url.protocol === 'https:' || url.protocol === 'http:') server = url.origin;
  } catch {
    // A malformed configuration should not block the support screen.
  }
  const status =
    context.status && /^[A-Z_]{1,60}$/.test(context.status) ? context.status : 'Não confirmado';
  const version = /^\d[\w.+-]{0,30}$/.test(context.version) ? context.version : 'Não informada';
  return [
    'Suporte Ligeirinho',
    `Aplicativo: ${context.audience === 'courier' ? 'Entregador' : 'Estabelecimento'} Android`,
    `Versão: ${version}`,
    `Hora do diagnóstico (UTC): ${utc(context.now ?? Date.now())}`,
    `Última sincronização confirmada (UTC): ${utc(context.lastSyncAt)}`,
    `Situação informada pelo servidor: ${status}`,
    `Servidor: ${server}`,
    'Descreva o que aconteceu e qual ação você tentava realizar:',
  ].join('\n');
}
