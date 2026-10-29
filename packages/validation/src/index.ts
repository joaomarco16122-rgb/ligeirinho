import { z } from 'zod';
export const coordinatesSchema = z.object({
  latitude: z.number().finite().min(-90).max(90),
  longitude: z.number().finite().min(-180).max(180),
});
export const stopSchema = coordinatesSchema
  .extend({ address: z.string().trim().min(5).max(500) })
  .strict();
export const loginSchema = z
  .object({ email: z.email().max(254), password: z.string().min(1).max(256) })
  .strict();
export const credentialSchema = z
  .object({ email: z.email().max(254), password: z.string().min(12).max(128) })
  .strict();
export const quoteSchema = z.object({ stops: z.array(stopSchema).min(1).max(20) }).strict();
export const moneySchema = z.number().int().nonnegative().max(100_000_000);
export const reasonSchema = z.string().trim().min(5).max(1000);
export const deliverySchema = quoteSchema
  .extend({ quoteId: z.string().min(1).max(100), idempotencyKey: z.string().min(8).max(128) })
  .strict();
