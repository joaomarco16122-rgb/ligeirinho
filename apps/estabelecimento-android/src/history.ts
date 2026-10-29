import { label, type Delivery } from './domain';

export type Period = 'day' | 'week' | 'month' | 'year' | 'custom' | 'all';
export type HistoryStatus = 'ALL' | 'FINALIZADO' | 'CANCELADO' | 'ACTIVE' | 'AWAITING_CONFIRMATION';
/** Inclusive civil dates in the selected IANA timezone; null means unbounded. */
export interface DateRange {
  start: string | null;
  end: string | null;
}

function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/** Converts an instant into a civil day without assuming that a local day is 24 hours. */
export function calendarDate(
  timestamp: string | number,
  timeZone = deviceTimeZone(),
): string | null {
  const instant = new Date(timestamp);
  if (!Number.isFinite(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)!.value;
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

function civilDate(year: number, month: number, day: number): Date {
  const result = new Date(0);
  result.setUTCFullYear(year, month - 1, day);
  result.setUTCHours(0, 0, 0, 0);
  return result;
}

function civilKey(date: Date): string {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

export function parseBrazilianDate(text: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!match) throw new Error('Informe uma data válida no formato DD/MM/AAAA.');
  const [, rawDay, rawMonth, rawYear] = match;
  const day = Number(rawDay);
  const month = Number(rawMonth);
  const year = Number(rawYear);
  const date = civilDate(year, month, day);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error('A data informada não existe. Confira dia, mês e ano.');
  }
  return civilKey(date);
}

export function periodRange(
  period: Period,
  now: number,
  timeZone: string,
  customStart?: string,
  customEnd?: string,
): DateRange {
  if (period === 'all') return { start: null, end: null };
  if (period === 'custom') {
    const start = parseBrazilianDate(customStart ?? '');
    const end = parseBrazilianDate(customEnd ?? '');
    if (start > end) throw new Error('A data inicial deve ser anterior ou igual à data final.');
    return { start, end };
  }
  const today = calendarDate(now, timeZone);
  if (!today) throw new Error('Não foi possível determinar a data atual.');
  const [year, month, day] = today.split('-').map(Number);
  if (period === 'day') return { start: today, end: today };
  if (period === 'month') {
    return {
      start: civilKey(civilDate(year, month, 1)),
      end: civilKey(civilDate(year, month + 1, 0)),
    };
  }
  if (period === 'year') return { start: `${year}-01-01`, end: `${year}-12-31` };
  const start = civilDate(year, month, day);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return { start: civilKey(start), end: civilKey(end) };
}

function matchesStatus(status: string, selected: HistoryStatus): boolean {
  if (selected === 'ALL') return true;
  if (selected === 'ACTIVE') return status !== 'FINALIZADO' && status !== 'CANCELADO';
  if (selected === 'AWAITING_CONFIRMATION') {
    return status === 'ENTREGADOR_CONCLUIU' || status === 'AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO';
  }
  return status === selected;
}

export function filterHistory<
  T extends { status: string; createdAt?: string; completedAt?: string | null },
>(records: T[], range: DateRange, status: HistoryStatus, timeZone: string): T[] {
  return records.filter((record) => {
    if (!matchesStatus(record.status, status)) return false;
    if (!range.start && !range.end) return true;
    // Earnings belong to completion, not the earlier request date. Never silently
    // substitute createdAt for a missing completion timestamp in a closed record.
    const timestamp = ['FINALIZADO', 'CANCELADO'].includes(record.status)
      ? record.completedAt
      : record.createdAt;
    const date = timestamp ? calendarDate(timestamp, timeZone) : null;
    return Boolean(
      date && (!range.start || date >= range.start) && (!range.end || date <= range.end),
    );
  });
}

function validCents(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

export function summarizeFinalized<
  T extends { status: string; totalCents: number; stops: unknown[] },
>(
  records: T[],
): { totalCents: number; count: number; stopCount: number; invalidAmountCount: number } {
  let totalCents = 0;
  let count = 0;
  let stopCount = 0;
  let invalidAmountCount = 0;
  for (const record of records) {
    if (record.status !== 'FINALIZADO') continue;
    count++;
    stopCount += record.stops.length;
    if (!validCents(record.totalCents) || !Number.isSafeInteger(totalCents + record.totalCents)) {
      invalidAmountCount++;
      continue;
    }
    totalCents += record.totalCents;
  }
  return { totalCents, count, stopCount, invalidAmountCount };
}

function csvCell(value: string | number): string {
  let text = Array.from(String(value), (character) => {
    const code = character.charCodeAt(0);
    return (code < 32 && !['\t', '\r', '\n'].includes(character)) || code === 127 ? ' ' : character;
  }).join('');
  // Quoting alone does not prevent spreadsheets from evaluating formulas.
  if (/^\s*[=+\-@]|^[\t\r\n]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function historyCsv(records: Delivery[]): string {
  const rows: (string | number)[][] = [
    [
      'Atendimento',
      'Situação',
      'Data UTC',
      'Estabelecimento',
      'Destinos',
      'Valor em centavos',
      'Observação',
    ],
  ];
  for (const record of records) {
    const value = ['FINALIZADO', 'CANCELADO'].includes(record.status)
      ? record.completedAt
      : record.createdAt;
    const instant = value ? new Date(value) : null;
    rows.push([
      record.id,
      label(record.status),
      instant && Number.isFinite(instant.getTime()) ? instant.toISOString() : '',
      record.establishment.name,
      record.stops.length,
      validCents(record.totalCents) ? record.totalCents : 'VALOR INVÁLIDO',
      'Valor registrado; não é comprovante de pagamento. Exportação limitada aos registros carregados.',
    ]);
  }
  // Deliberately omit addresses, GPS and contact details from this financial share.
  return '\ufeff' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

export function navigationUrls(
  latitude: number,
  longitude: number,
): { google: string; waze: string } {
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    Math.abs(latitude) > 90 ||
    Math.abs(longitude) > 180
  ) {
    throw new Error('A localização não é válida para iniciar a navegação.');
  }
  return {
    google: `https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}`,
    waze: `https://www.waze.com/ul?ll=${latitude},${longitude}&navigate=yes`,
  };
}
