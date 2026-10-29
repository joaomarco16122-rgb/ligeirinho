import { date, statusLabel } from './format';

/** A report is a view of the authorized API result, never a complete-ledger assertion. */
export type ReportDelivery = {
  id: string;
  status: string;
  createdAt: string;
  totalCents?: number;
  stops?: { address: string }[];
  establishment?: { name: string };
  courier?: { name?: string } | null;
};
export type ReportFilters = { from?: string; to?: string; status?: string };
export const REPORT_TIME_ZONE = 'America/Sao_Paulo';
const calendar = new Intl.DateTimeFormat('en', {
  timeZone: REPORT_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Convert an instant to its Brazilian calendar day without the execution host timezone. */
export function reportDay(timestamp: string): string | null {
  const instant = new Date(timestamp);
  if (!Number.isFinite(instant.getTime())) return null;
  const parts = calendar.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function filterDeliveries<T extends ReportDelivery>(
  deliveries: readonly T[],
  filters: ReportFilters,
): T[] {
  if (filters.from && filters.to && filters.from > filters.to) return [];
  return deliveries.filter((delivery) => {
    const day = reportDay(delivery.createdAt);
    return (
      day !== null &&
      (!filters.from || day >= filters.from) &&
      (!filters.to || day <= filters.to) &&
      (!filters.status || filters.status === 'all' || delivery.status === filters.status)
    );
  });
}

function validAmount(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && value! >= 0;
}

export function summarizeDeliveries(deliveries: readonly ReportDelivery[]) {
  return deliveries.reduce(
    (summary, delivery) => {
      summary.total += 1;
      const completed = delivery.status === 'FINALIZADO';
      if (completed) summary.completed += 1;
      else if (delivery.status === 'CANCELADO') summary.cancelled += 1;
      else summary.active += 1;
      if (validAmount(delivery.totalCents)) {
        summary.totalCents += delivery.totalCents;
        if (completed) summary.completedCents += delivery.totalCents;
      } else summary.withoutAmount += 1;
      summary.stops += delivery.stops?.length ?? 0;
      return summary;
    },
    {
      total: 0,
      completed: 0,
      cancelled: 0,
      active: 0,
      stops: 0,
      totalCents: 0,
      completedCents: 0,
      withoutAmount: 0,
    },
  );
}

/** Quote all fields and neutralize spreadsheet formula starters, including whitespace tricks. */
export function csvCell(value: string): string {
  const clean = value.replaceAll('\0', '');
  const text = /^\s*[=+\-@]/u.test(clean) || /^[\t\r\n]/u.test(clean) ? `'${clean}` : clean;
  return `"${text.replaceAll('"', '""')}"`;
}

export function deliveryCsv(deliveries: readonly ReportDelivery[]): string {
  const lines = [
    ['Ligeirinho — relatório dos atendimentos carregados (até 100 registros)'],
    ['Valores informativos de entregas; não comprovam pagamento ou recebimento.'],
    [
      'Referência',
      'Criado em (America/Sao_Paulo)',
      'Estabelecimento',
      'Entregador',
      'Situação',
      'Destinos',
      'Valor (BRL)',
    ],
    ...deliveries.map((delivery) => [
      delivery.id,
      Number.isFinite(new Date(delivery.createdAt).getTime()) ? date(delivery.createdAt) : '',
      delivery.establishment?.name ?? '',
      delivery.courier?.name ?? '',
      statusLabel(delivery.status),
      delivery.stops?.map((stop) => stop.address).join(' | ') ?? '',
      validAmount(delivery.totalCents)
        ? (delivery.totalCents / 100).toFixed(2).replace('.', ',')
        : '',
    ]),
  ];
  return `\uFEFF${lines.map((line) => line.map(csvCell).join(';')).join('\r\n')}\r\n`;
}
