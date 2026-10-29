import { describe, expect, it } from 'vitest';
import { finalStatuses, nextProgress, parseCoordinate, remainingSeconds } from './domain';
describe('contratos de domínio do cliente Android', () => {
  it('não mostra prazo negativo ou inválido', () => {
    expect(remainingSeconds('2026-10-29T10:00:10Z', Date.parse('2026-10-29T10:00:00Z'))).toBe(10);
    expect(remainingSeconds('2026-10-29T10:00:00Z', Date.parse('2026-10-29T10:00:10Z'))).toBe(0);
    expect(remainingSeconds('inválido')).toBe(0);
  });
  it('não libera o entregador quando ele conclui sua parte', () => {
    const progress = nextProgress('EM_ENTREGA');
    expect(progress?.status).toBe('AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO');
    expect(finalStatuses.has(progress!.status)).toBe(false);
    expect(nextProgress(progress!.status)).toBeNull();
  });
  it('aceita vírgula decimal e rejeita coordenadas vazias ou fora dos limites', () => {
    expect(parseCoordinate('-23,5', 'latitude')).toBe(-23.5);
    expect(() => parseCoordinate('', 'latitude')).toThrow();
    expect(() => parseCoordinate('91', 'latitude')).toThrow();
    expect(() => parseCoordinate('-181', 'longitude')).toThrow();
    expect(() => parseCoordinate('NaN', 'longitude')).toThrow();
  });
});
