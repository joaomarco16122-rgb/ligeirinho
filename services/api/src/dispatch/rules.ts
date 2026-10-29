import { ConflictException } from '@nestjs/common';
export type Point = { latitude: number; longitude: number };
export function meters(a: Point, b: Point): number {
  const rad = Math.PI / 180,
    dLat = (b.latitude - a.latitude) * rad,
    dLon = (b.longitude - a.longitude) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLon / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h))));
}
export function eligible(
  c: {
    active: boolean;
    online: boolean;
    status: string;
    latitude: number | null;
    longitude: number | null;
    locationAt: Date | null;
  },
  now: Date,
  maxAgeSeconds: number,
): boolean {
  return (
    c.active &&
    c.online &&
    c.status === 'AVAILABLE' &&
    c.latitude !== null &&
    c.longitude !== null &&
    !!c.locationAt &&
    c.locationAt.getTime() <= now.getTime() &&
    now.getTime() - c.locationAt.getTime() <= maxAgeSeconds * 1000
  );
}
export function validOffer(status: string, expiresAt: Date, now: Date): void {
  if (status !== 'PENDING' || expiresAt.getTime() <= now.getTime())
    throw new ConflictException('Oferta encerrada; sincronize novamente.');
}
export const nextStatus: Record<string, string> = {
  ACEITO: 'A_CAMINHO_COLETA',
  A_CAMINHO_COLETA: 'NO_ESTABELECIMENTO',
  NO_ESTABELECIMENTO: 'EM_ENTREGA',
  EM_ENTREGA: 'AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO',
};
export function assertProgress(previous: string, next: string): void {
  if (nextStatus[previous] !== next)
    throw new ConflictException('Transição de atendimento inválida.');
}
export function price(base: number, perKm: number, distanceMeters: number): number {
  const result = base + Math.round((perKm * distanceMeters) / 1000);
  if (!Number.isSafeInteger(result) || result < 0 || result > 10000000)
    throw new ConflictException('Cotação fora do limite permitido.');
  return result;
}
