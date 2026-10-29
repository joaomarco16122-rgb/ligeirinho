import { describe, it, expect } from 'vitest';
import { assertProgress, eligible, meters, price, validOffer } from '../src/dispatch/rules';
describe('regras de despacho', () => {
  const now = new Date('2026-01-01T12:00:00Z');
  const courier = {
    active: true,
    online: true,
    status: 'AVAILABLE',
    latitude: -23.5,
    longitude: -46.6,
    locationAt: now,
  };
  it('rejeita ocupado, offline, sem GPS, localização antiga ou futura', () => {
    expect(eligible(courier, now, 120)).toBe(true);
    for (const change of [
      { status: 'BUSY' },
      { online: false },
      { latitude: null },
      { active: false },
      { locationAt: new Date(now.getTime() - 120001) },
      { locationAt: new Date(now.getTime() + 1) },
    ])
      expect(eligible({ ...courier, ...change }, now, 120)).toBe(false);
  });
  it('prazo validado no servidor inclui fronteira exata', () => {
    expect(() => validOffer('PENDING', new Date(now.getTime() + 1), now)).not.toThrow();
    expect(() => validOffer('PENDING', now, now)).toThrow();
    expect(() => validOffer('ACCEPTED', new Date(now.getTime() + 1000), now)).toThrow();
  });
  it('não permite liberação ou salto de estados pelo entregador', () => {
    expect(() =>
      assertProgress('EM_ENTREGA', 'AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO'),
    ).not.toThrow();
    expect(() => assertProgress('EM_ENTREGA', 'FINALIZADO')).toThrow();
    expect(() => assertProgress('ACEITO', 'EM_ENTREGA')).toThrow();
  });
  it('distância de mesma coordenada zero, escala geográfica e arredondamento em centavos', () => {
    expect(meters(courier, courier)).toBe(0);
    expect(meters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 1 })).toBeGreaterThan(
      111000,
    );
    expect(price(500, 175, 1500)).toBe(763);
    expect(() => price(-500, 0, 0)).toThrow();
  });
});
