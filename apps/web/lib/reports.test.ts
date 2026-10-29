import { describe, expect, it } from 'vitest';
import {
  csvCell,
  deliveryCsv,
  filterDeliveries,
  reportDay,
  summarizeDeliveries,
  type ReportDelivery,
} from './reports';

const delivery = (
  id: string,
  createdAt: string,
  status = 'FINALIZADO',
  totalCents = 101,
): ReportDelivery => ({
  id,
  createdAt,
  status,
  totalCents,
  stops: [{ address: 'Rua Exemplo, 123' }],
});

describe('Relatórios de atendimentos autorizados', () => {
  it('filtra pela data de São Paulo, incluindo os limites de meia-noite', () => {
    const deliveries = [
      delivery('before', '2026-10-29T02:59:59.999Z'),
      delivery('start', '2026-10-29T03:00:00.000Z'),
      delivery('end', '2026-10-30T02:59:59.999Z'),
      delivery('after', '2026-10-30T03:00:00.000Z'),
    ];
    expect(
      filterDeliveries(deliveries, { from: '2026-10-29', to: '2026-10-29' }).map((d) => d.id),
    ).toEqual(['start', 'end']);
    expect(reportDay('2026-10-29T02:59:59Z')).toBe('2026-10-28');
  });
  it('combina situação e período sem modificar os dados originais', () => {
    const deliveries = [
      delivery('1', '2026-10-29T12:00:00Z'),
      delivery('2', '2026-10-29T13:00:00Z', 'CANCELADO'),
    ];
    expect(
      filterDeliveries(deliveries, { status: 'CANCELADO', from: '2026-10-29' }).map((d) => d.id),
    ).toEqual(['2']);
    expect(deliveries.map((d) => d.id)).toEqual(['1', '2']);
    expect(filterDeliveries(deliveries, { from: '2026-10-30', to: '2026-10-29' })).toEqual([]);
    expect(filterDeliveries([delivery('invalid', 'invalid')], {})).toEqual([]);
  });
  it('separa valores finalizados de cancelados e pendentes, usando centavos inteiros', () => {
    const summary = summarizeDeliveries([
      delivery('1', '2026-10-29T12:00:00Z', 'FINALIZADO', 101),
      delivery('2', '2026-10-29T12:00:00Z', 'FINALIZADO', 202),
      delivery('3', '2026-10-29T12:00:00Z', 'CANCELADO', 999),
      delivery('4', '2026-10-29T12:00:00Z', 'AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO', 500),
      { ...delivery('5', '2026-10-29T12:00:00Z'), totalCents: undefined },
    ]);
    expect(summary).toEqual({
      total: 5,
      completed: 3,
      cancelled: 1,
      active: 1,
      stops: 5,
      totalCents: 1802,
      completedCents: 303,
      withoutAmount: 1,
    });
    expect(
      summarizeDeliveries([delivery('invalid', '2026-10-29T12:00:00Z', 'FINALIZADO', 1.5)])
        .withoutAmount,
    ).toBe(1);
  });
  it.each([
    '=HYPERLINK("https://example.test")',
    '+SUM(1;2)',
    '-1+2',
    '@SUM(A1)',
    '  =1+2',
    '\t=1+2',
    '\r=1+2',
    '\n+1',
    '\uFEFF=1+2',
  ])('neutraliza uma fórmula fornecida pelo usuário: %j', (value) => {
    expect(csvCell(value).startsWith('"\'')).toBe(true);
  });
  it('exporta CSV real com BOM, separadores, aspas escapadas e observação de não recebimento', () => {
    const item = {
      ...delivery('id', '2026-10-29T12:00:00Z', 'FINALIZADO', 1234),
      establishment: { name: '=1+1' },
      stops: [{ address: 'Rua "A"; número 2\nCentro' }],
    };
    const csv = deliveryCsv([item]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('não comprovam pagamento');
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('"Rua ""A""; número 2\nCentro"');
    expect(csv).toContain('"12,34"');
    expect(csv).toContain('29/10/2026');
  });
});
