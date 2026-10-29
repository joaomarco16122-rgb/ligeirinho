import { describe, expect, it } from 'vitest';
import type { Delivery } from './domain';
import {
  calendarDate,
  filterHistory,
  historyCsv,
  navigationUrls,
  parseBrazilianDate,
  periodRange,
  summarizeFinalized,
} from './history';

const zone = 'America/Sao_Paulo';
function delivery(patch: Partial<Delivery> = {}): Delivery {
  return {
    id: 'delivery-1',
    status: 'FINALIZADO',
    totalCents: 1500,
    createdAt: '2026-10-01T12:00:00Z',
    completedAt: '2026-11-01T02:59:59Z',
    stops: [{ address: 'Rua privada, 9', latitude: -23.555, longitude: -46.666 }],
    establishment: { name: 'Loja', address: 'Coleta privada', latitude: -23, longitude: -46 },
    ...patch,
  };
}

describe('períodos civis e instantes UTC', () => {
  it('conta a conclusão antes de 03h UTC no dia anterior de São Paulo', () => {
    expect(calendarDate('2026-11-01T02:59:59Z', zone)).toBe('2026-10-31');
    expect(calendarDate('2026-11-01T03:00:00Z', zone)).toBe('2026-11-01');
    expect(calendarDate('2026-11-01T02:59:59Z', 'UTC')).toBe('2026-11-01');
  });
  it('não confunde a data UTC com a data de um aparelho no Pacífico', () => {
    expect(calendarDate('2026-10-29T10:59:59Z', 'Pacific/Apia')).toBe('2026-10-29');
    expect(calendarDate('2026-10-29T11:00:00Z', 'Pacific/Apia')).toBe('2026-10-30');
  });
  it('respeita transições de verão e o dia civil omitido de Samoa', () => {
    expect(calendarDate('2018-11-04T02:30:00Z', zone)).toBe('2018-11-03');
    expect(calendarDate('2018-11-04T03:30:00Z', zone)).toBe('2018-11-04');
    expect(calendarDate('2011-12-30T09:59:59Z', 'Pacific/Apia')).toBe('2011-12-29');
    expect(calendarDate('2011-12-30T10:00:00Z', 'Pacific/Apia')).toBe('2011-12-31');
  });
  it('calcula hoje pelo fuso do aparelho e a semana de segunda a domingo entre anos', () => {
    expect(periodRange('day', Date.parse('2026-11-01T02:00:00Z'), zone)).toEqual({
      start: '2026-10-31',
      end: '2026-10-31',
    });
    expect(periodRange('week', Date.parse('2026-01-04T12:00:00Z'), zone)).toEqual({
      start: '2025-12-29',
      end: '2026-01-04',
    });
  });
  it('inclui o último dia do mês bissexto e todos os dias do ano', () => {
    expect(periodRange('month', Date.parse('2024-02-15T12:00:00Z'), zone)).toEqual({
      start: '2024-02-01',
      end: '2024-02-29',
    });
    expect(periodRange('year', Date.parse('2024-02-15T12:00:00Z'), zone)).toEqual({
      start: '2024-01-01',
      end: '2024-12-31',
    });
    expect(periodRange('all', Number.NaN, zone)).toEqual({ start: null, end: null });
  });
  it('valida datas reais e limites personalizados inclusivos, sem normalizar datas impossíveis', () => {
    expect(parseBrazilianDate('29/02/2024')).toBe('2024-02-29');
    expect(periodRange('custom', 0, zone, '31/10/2026', '01/11/2026')).toEqual({
      start: '2026-10-31',
      end: '2026-11-01',
    });
    for (const invalid of [
      '29/02/2025',
      '31/04/2026',
      '00/01/2026',
      '01/13/2026',
      '01/01/0000',
      '2026-10-29',
      '1/1/2026',
    ])
      expect(() => parseBrazilianDate(invalid)).toThrow();
    expect(() => periodRange('custom', 0, zone, '02/11/2026', '01/11/2026')).toThrow('inicial');
    expect(calendarDate('inválida', zone)).toBeNull();
  });
});

describe('histórico e valores confirmados', () => {
  it('usa conclusão dos finalizados, criação dos ativos e inclui as bordas do intervalo', () => {
    const records = [
      delivery({ id: 'concluiu-no-dia' }),
      delivery({ id: 'concluiu-depois', completedAt: '2026-11-01T03:00:00Z' }),
      delivery({ id: 'sem-conclusao', completedAt: null }),
      delivery({
        id: 'ativo-criado-no-dia',
        status: 'EM_ENTREGA',
        createdAt: '2026-10-31T03:00:00Z',
        completedAt: null,
      }),
      delivery({
        id: 'ativo-criado-depois',
        status: 'EM_ENTREGA',
        createdAt: '2026-11-01T03:00:00Z',
        completedAt: null,
      }),
    ];
    expect(
      filterHistory(records, { start: '2026-10-31', end: '2026-10-31' }, 'ALL', zone).map(
        (record) => record.id,
      ),
    ).toEqual(['concluiu-no-dia', 'ativo-criado-no-dia']);
    expect(filterHistory(records, { start: null, end: null }, 'ALL', zone)).toHaveLength(5);
  });
  it('filtra situações sem incluir cancelados ou finalizados nos ativos', () => {
    const records = [
      delivery(),
      delivery({ status: 'CANCELADO' }),
      delivery({ status: 'EM_ENTREGA' }),
      delivery({ status: 'AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO' }),
    ];
    const all = { start: null, end: null };
    expect(filterHistory(records, all, 'ACTIVE', zone).map((record) => record.status)).toEqual([
      'EM_ENTREGA',
      'AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO',
    ]);
    expect(filterHistory(records, all, 'AWAITING_CONFIRMATION', zone)).toHaveLength(1);
    expect(filterHistory(records, all, 'CANCELADO', zone)).toHaveLength(1);
  });
  it('soma centavos somente de atendimentos finalizados, mantendo contagem dos destinos', () => {
    const records = [
      delivery({ totalCents: 1001 }),
      delivery({
        id: 'delivery-2',
        totalCents: 2099,
        stops: [delivery().stops[0], delivery().stops[0]],
      }),
      delivery({ status: 'CANCELADO', totalCents: 99999 }),
      delivery({ status: 'EM_ENTREGA', totalCents: 99999 }),
    ];
    expect(summarizeFinalized(records)).toEqual({
      totalCents: 3100,
      count: 2,
      stopCount: 3,
      invalidAmountCount: 0,
    });
  });
  it('sinaliza valores inválidos e overflow em vez de produzir total NaN ou impreciso', () => {
    const invalid = [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ].map((totalCents) => delivery({ totalCents }));
    expect(summarizeFinalized(invalid)).toEqual({
      totalCents: 0,
      count: 5,
      stopCount: 5,
      invalidAmountCount: 5,
    });
    expect(
      summarizeFinalized([
        delivery({ totalCents: Number.MAX_SAFE_INTEGER }),
        delivery({ totalCents: 1 }),
      ]).invalidAmountCount,
    ).toBe(1);
  });
});

describe('compartilhamento e navegação', () => {
  it('protege CSV contra fórmulas e escapa aspas, delimitadores e quebras de linha', () => {
    const csv = historyCsv([
      delivery({
        establishment: { ...delivery().establishment, name: ' \t=HYPERLINK("url");\nLoja' },
      }),
    ]);
    expect(csv).toContain('"\' \t=HYPERLINK(""url"");\nLoja"');
    expect(csv).toContain('"Finalizado"');
    expect(csv).toContain('"2026-11-01T02:59:59.000Z"');
    expect(csv).toContain('"1500"');
    expect(csv).toContain('não é comprovante de pagamento');
    expect(csv).not.toContain('Rua privada');
    expect(csv).not.toContain('Coleta privada');
    expect(csv).not.toContain('-23.555');
    expect(csv.endsWith('\r\n')).toBe(true);
  });
  it('protege também identificadores iniciados por fórmula e informa valor inválido no CSV', () => {
    const csv = historyCsv([delivery({ id: '@SUM(A1:A2)', totalCents: Number.NaN })]);
    expect(csv).toContain('"\'@SUM(A1:A2)"');
    expect(csv).toContain('"VALOR INVÁLIDO"');
  });
  it('gera links HTTPS de navegação e rejeita coordenadas impossíveis', () => {
    expect(navigationUrls(-23.5, -46.6)).toEqual({
      google: 'https://www.google.com/maps/dir/?api=1&destination=-23.5,-46.6',
      waze: 'https://www.waze.com/ul?ll=-23.5,-46.6&navigate=yes',
    });
    expect(navigationUrls(90, -180).waze).toContain('ll=90,-180');
    expect(() => navigationUrls(91, 0)).toThrow();
    expect(() => navigationUrls(0, -181)).toThrow();
    expect(() => navigationUrls(Number.NaN, 0)).toThrow();
    expect(() => navigationUrls(0, Number.POSITIVE_INFINITY)).toThrow();
  });
});
