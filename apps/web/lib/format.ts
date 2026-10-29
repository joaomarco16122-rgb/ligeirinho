export const money = (cents: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
export const date = (value: string) =>
  new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(value));
export const statusLabel = (status: string) =>
  ({
    SOLICITADO: 'Solicitado',
    BUSCANDO: 'Buscando entregador',
    AGUARDANDO: 'Aguardando disponibilidade',
    OFERTADO: 'Oferta enviada',
    ACEITO: 'Aceito',
    A_CAMINHO_COLETA: 'A caminho da coleta',
    NO_ESTABELECIMENTO: 'No estabelecimento',
    EM_ENTREGA: 'Em entrega',
    ENTREGADOR_CONCLUIU: 'Entregador concluiu',
    AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO: 'Aguardando sua confirmação',
    FINALIZADO: 'Finalizado',
    CANCELAMENTO_SOLICITADO: 'Cancelamento solicitado',
    CANCELADO: 'Cancelado',
    INTERVENCAO_ADMIN: 'Intervenção administrativa',
  })[status] || status.replaceAll('_', ' ');
export const isFinished = (status: string) => ['FINALIZADO', 'CANCELADO'].includes(status);
