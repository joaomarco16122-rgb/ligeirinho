export const defaults = Object.freeze({
  offerTimeoutSeconds: 10,
  locationMaxAgeSeconds: 120,
  maximumStops: 20,
  quoteValiditySeconds: 300,
  currency: 'BRL',
  locale: 'pt-BR',
});
export function requireHttpsInProduction(url: string, production: boolean): URL {
  const parsed = new URL(url);
  if (production && parsed.protocol !== 'https:')
    throw new Error('HTTPS é obrigatório em produção');
  return parsed;
}
