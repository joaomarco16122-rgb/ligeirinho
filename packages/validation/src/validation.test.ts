import { describe, expect, it } from 'vitest';
import {
  coordinatesSchema,
  credentialSchema,
  deliverySchema,
  moneySchema,
  quoteSchema,
} from './index';
describe('Contratos públicos', () => {
  it('rejeita coordenadas fora do globo e não finitas', () => {
    for (const latitude of [91, -91, NaN, Infinity])
      expect(coordinatesSchema.safeParse({ latitude, longitude: 0 }).success).toBe(false);
  });
  it('não permite que cliente envie preço arbitrário na cotação', () => {
    expect(
      quoteSchema.safeParse({
        stops: [{ address: 'Rua das Flores, 10', latitude: -23, longitude: -46 }],
        totalCents: 1,
      }).success,
    ).toBe(false);
  });
  it('exige destinos e identificador de idempotência', () => {
    expect(deliverySchema.safeParse({ quoteId: 'q', idempotencyKey: '', stops: [] }).success).toBe(
      false,
    );
  });
  it('rejeita moeda fracionária/negativa e credencial inicial fraca', () => {
    expect(moneySchema.safeParse(1.5).success).toBe(false);
    expect(moneySchema.safeParse(-1).success).toBe(false);
    expect(
      credentialSchema.safeParse({ email: 'admin@example.test', password: '123' }).success,
    ).toBe(false);
  });
});
