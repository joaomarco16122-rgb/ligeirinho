export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'ESTABLISHMENT' | 'COURIER';
export type DeliveryStatus =
  | 'SOLICITADO'
  | 'BUSCANDO'
  | 'AGUARDANDO'
  | 'OFERTADO'
  | 'ACEITO'
  | 'A_CAMINHO_COLETA'
  | 'NO_ESTABELECIMENTO'
  | 'EM_ENTREGA'
  | 'ENTREGADOR_CONCLUIU'
  | 'AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO'
  | 'FINALIZADO'
  | 'CANCELAMENTO_SOLICITADO'
  | 'CANCELADO'
  | 'INTERVENCAO_ADMIN';
export type CourierStatus = 'OFFLINE' | 'AVAILABLE' | 'OFFER_PENDING' | 'BUSY' | 'DISCONNECTED';
export interface Coordinates {
  latitude: number;
  longitude: number;
}
export interface DeliveryStopInput extends Coordinates {
  address: string;
}
export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  cityId?: string | null;
  establishmentId?: string | null;
}
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
}
export interface Quote {
  id: string;
  totalCents: number;
  distanceKm: number;
  expiresAt: string;
}
export interface EventEnvelope<T> {
  id: string;
  timestamp: string;
  correlationId: string;
  data: T;
}
export const DELIVERY_STATUS_LABELS: Record<DeliveryStatus, string> = {
  SOLICITADO: 'Solicitado',
  BUSCANDO: 'Buscando entregador',
  AGUARDANDO: 'Aguardando disponibilidade',
  OFERTADO: 'Oferta enviada',
  ACEITO: 'Aceito',
  A_CAMINHO_COLETA: 'A caminho da coleta',
  NO_ESTABELECIMENTO: 'No estabelecimento',
  EM_ENTREGA: 'Em entrega',
  ENTREGADOR_CONCLUIU: 'Entregador concluiu',
  AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO: 'Aguardando confirmação',
  FINALIZADO: 'Finalizado',
  CANCELAMENTO_SOLICITADO: 'Cancelamento solicitado',
  CANCELADO: 'Cancelado',
  INTERVENCAO_ADMIN: 'Intervenção administrativa',
};
