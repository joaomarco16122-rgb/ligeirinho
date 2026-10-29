export type Role = 'SUPER_ADMIN' | 'ADMIN' | 'ESTABLISHMENT' | 'COURIER';
export interface User {
  id: string;
  name: string;
  role: Role;
  mustChangePassword?: boolean;
  establishmentId?: string;
  courierId?: string;
}
export interface Stop {
  id?: string;
  address: string;
  latitude: number;
  longitude: number;
  sequence?: number;
}
export interface Delivery {
  id: string;
  status: string;
  totalCents: number;
  createdAt?: string;
  completedAt?: string | null;
  stops: Stop[];
  establishment: { name: string; address: string; latitude: number; longitude: number };
  courier?: { name: string; latitude?: number; longitude?: number };
  cancellations?: { requestedById: string; requestedByRole: Role }[];
}
export interface Offer {
  id: string;
  expiresAt: string;
  delivery: Delivery;
}
export interface Quote {
  id: string;
  totalCents: number;
  distanceKm: number;
  expiresAt: string;
}
export interface Message {
  id: string;
  userId?: string;
  text: string;
  createdAt: string;
  sender?: { name: string };
  user?: { name: string };
}
export const finalStatuses = new Set(['FINALIZADO', 'CANCELADO']);
export const money = (cents: number) =>
  (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const label = (status: string) =>
  ({
    AVAILABLE: 'Disponível',
    OFFER_PENDING: 'Oferta pendente',
    BUSY: 'Em atendimento',
    DISCONNECTED: 'Sem localização recente',
    DISPONIVEL: 'Disponível',
    OFFLINE: 'Offline',
    OFERTA_PENDENTE: 'Oferta pendente',
    OCUPADO: 'Em atendimento',
    INDISPONIVEL_CONEXAO: 'Sem localização recente',
    SOLICITADO: 'Solicitado',
    BUSCANDO: 'Buscando entregador',
    AGUARDANDO: 'Aguardando entregador',
    OFERTADO: 'Oferta em andamento',
    ACEITO: 'Entregador confirmou',
    A_CAMINHO_COLETA: 'A caminho da coleta',
    NO_ESTABELECIMENTO: 'No estabelecimento',
    EM_ENTREGA: 'Em entrega',
    ENTREGADOR_CONCLUIU: 'Entregador concluiu',
    AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO: 'Aguardando confirmação da loja',
    FINALIZADO: 'Finalizado',
    CANCELAMENTO_SOLICITADO: 'Cancelamento solicitado',
    CANCELADO: 'Cancelado',
    INTERVENCAO_ADMIN: 'Intervenção administrativa',
  })[status] ?? status;
export function remainingSeconds(expiresAt: string, now = Date.now()): number {
  const remaining = Date.parse(expiresAt) - now;
  return Number.isFinite(remaining) ? Math.max(0, Math.ceil(remaining / 1000)) : 0;
}
export function parseCoordinate(value: string, kind: 'latitude' | 'longitude'): number {
  const normalized = value.trim().replace(',', '.');
  if (!normalized) throw new Error(`Informe a ${kind === 'latitude' ? 'latitude' : 'longitude'}.`);
  const number = Number(normalized);
  const limit = kind === 'latitude' ? 90 : 180;
  if (!Number.isFinite(number) || Math.abs(number) > limit)
    throw new Error(`${kind === 'latitude' ? 'Latitude' : 'Longitude'} inválida.`);
  return number;
}
export function nextProgress(status: string): { status: string; text: string } | null {
  return (
    (
      {
        ACEITO: { status: 'A_CAMINHO_COLETA', text: 'Estou a caminho da coleta' },
        A_CAMINHO_COLETA: { status: 'NO_ESTABELECIMENTO', text: 'Cheguei ao estabelecimento' },
        NO_ESTABELECIMENTO: { status: 'EM_ENTREGA', text: 'Iniciar entregas' },
        EM_ENTREGA: {
          status: 'AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO',
          text: 'Concluí todas as entregas',
        },
      } as Record<string, { status: string; text: string }>
    )[status] ?? null
  );
}
