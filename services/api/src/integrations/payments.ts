import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  HttpTransport,
  IntegrationUnavailable,
  production,
  proxyAwareTransport,
} from './transport';
const invoiceSchema = z
  .object({
    id: z.string().uuid(),
    establishmentId: z.string().uuid(),
    amountCents: z.number().int().min(1).max(10000000),
    currency: z.literal('BRL'),
    payerEmail: z.string().email().max(254),
  })
  .strict();
export type PlatformInvoiceSnapshot = z.infer<typeof invoiceSchema>;
const paymentSchema = z
  .object({
    id: z.string().min(1).max(120),
    invoiceId: z.string().uuid(),
    amountCents: z.number().int().positive().max(10000000),
    currency: z.literal('BRL'),
    status: z.enum(['pending', 'paid', 'failed', 'refunded']),
  })
  .strict();
export type PlatformPayment = z.infer<typeof paymentSchema>;
export interface PlatformBillingAdapter {
  createCheckout(
    invoice: PlatformInvoiceSnapshot,
  ): Promise<{ providerInvoiceId: string; checkoutUrl: string }>;
  retrievePayment(paymentId: string): Promise<PlatformPayment>;
}
// Connector contract for an operator-managed gateway, NOT a claim of Stripe/Mercado Pago compatibility.
export class ContractGatewayBilling implements PlatformBillingAdapter {
  private readonly origin: string;
  constructor(
    endpoint: string,
    private readonly token: string,
    private readonly transport: HttpTransport = proxyAwareTransport,
  ) {
    const url = new URL(endpoint);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      !token
    )
      throw new Error('Gateway exige origem HTTPS e autenticação configurada.');
    this.origin = url.origin;
  }
  async createCheckout(input: PlatformInvoiceSnapshot) {
    const invoice = invoiceSchema.parse(input);
    try {
      const response = await this.transport(`${this.origin}/v1/platform-invoices`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': invoice.id,
        },
        body: JSON.stringify(invoice),
        signal: AbortSignal.timeout(8000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('provider rejected');
      const result = z
        .object({ providerInvoiceId: z.string().min(1).max(120), checkoutUrl: z.string().url() })
        .strict()
        .parse(await response.json());
      const checkout = new URL(result.checkoutUrl);
      if (checkout.protocol !== 'https:' || checkout.username || checkout.password)
        throw new Error('invalid checkout');
      return result;
    } catch {
      throw new IntegrationUnavailable('cobrança da plataforma');
    }
  }
  async retrievePayment(paymentId: string) {
    const id = z
      .string()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9_-]+$/)
      .parse(paymentId);
    try {
      const response = await this.transport(
        `${this.origin}/v1/platform-payments/${encodeURIComponent(id)}`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${this.token}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(8000),
          redirect: 'error',
        },
      );
      if (!response.ok) throw new Error('provider rejected');
      const payment = paymentSchema.parse(await response.json());
      if (payment.id !== id) throw new Error('payment mismatch');
      return payment;
    } catch {
      throw new IntegrationUnavailable('cobrança da plataforma');
    }
  }
}
export function createBillingAdapter(
  env: NodeJS.ProcessEnv,
  transport?: HttpTransport,
): PlatformBillingAdapter | null {
  const provider = env.PAYMENT_PROVIDER ?? 'disabled';
  if (provider === 'disabled') {
    if (production(env))
      throw new Error(
        'Cobrança desativada: habilite adaptador validado ou não habilite o módulo em produção.',
      );
    return null;
  }
  if (provider !== 'contract-gateway' || !env.PAYMENT_GATEWAY_ORIGIN || !env.PAYMENT_GATEWAY_TOKEN)
    throw new Error('Gateway de cobrança não configurado.');
  return new ContractGatewayBilling(
    env.PAYMENT_GATEWAY_ORIGIN,
    env.PAYMENT_GATEWAY_TOKEN,
    transport,
  );
}
const notificationSchema = z
  .object({
    eventId: z.string().uuid(),
    type: z.literal('platform.payment.updated'),
    paymentId: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9_-]+$/),
    invoiceId: z.string().uuid(),
  })
  .strict();
export type PlatformPaymentNotification = z.infer<typeof notificationSchema>;
export function authenticateWebhook(
  rawBody: Buffer,
  signature: string,
  secret: string,
  nowMilliseconds = Date.now(),
): { event: PlatformPaymentNotification; digest: string } {
  if (
    secret.length < 32 ||
    rawBody.byteLength === 0 ||
    rawBody.byteLength > 65536 ||
    signature.length > 200
  )
    throw new Error('Webhook inválido.');
  const match = /^t=(\d{10}),v1=([a-f0-9]{64})$/.exec(signature);
  if (!match || Math.abs(nowMilliseconds - Number(match[1]) * 1000) > 300000)
    throw new Error('Webhook inválido ou fora do prazo.');
  const expected = createHmac('sha256', secret).update(`${match[1]}.`).update(rawBody).digest();
  const supplied = Buffer.from(match[2]!, 'hex');
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
    throw new Error('Webhook inválido.');
  let value: unknown;
  try {
    value = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new Error('Webhook inválido.');
  }
  return {
    event: notificationSchema.parse(value),
    digest: createHash('sha256').update(rawBody).digest('hex'),
  };
}
export function reconcilePlatformPayment(
  event: PlatformPaymentNotification,
  invoice: PlatformInvoiceSnapshot,
  suppliedPayment: PlatformPayment,
) {
  const trustedInvoice = invoiceSchema.parse(invoice);
  const payment = paymentSchema.parse(suppliedPayment);
  if (
    event.invoiceId !== trustedInvoice.id ||
    payment.invoiceId !== trustedInvoice.id ||
    payment.id !== event.paymentId ||
    payment.amountCents !== trustedInvoice.amountCents ||
    payment.currency !== trustedInvoice.currency
  )
    throw new Error('Pagamento divergente; conciliação exige intervenção.');
  return {
    eventId: event.eventId,
    invoiceId: trustedInvoice.id,
    paymentId: payment.id,
    status: payment.status,
    amountCents: trustedInvoice.amountCents,
    currency: trustedInvoice.currency,
  };
}
export type ReconciledPayment = ReturnType<typeof reconcilePlatformPayment>;
// A durable implementation MUST atomically compare digest, apply reconciliation and record
// the event under a unique eventId. No process-memory implementation is used by runtime.
export interface DurablePaymentInbox {
  applyOnce(
    eventId: string,
    digest: string,
    reconciliation: ReconciledPayment,
  ): Promise<'applied' | 'duplicate'>;
}
export async function processPlatformWebhook(
  rawBody: Buffer,
  signature: string,
  secret: string,
  loadInvoice: (id: string) => Promise<PlatformInvoiceSnapshot>,
  adapter: PlatformBillingAdapter,
  inbox: DurablePaymentInbox,
  nowMilliseconds = Date.now(),
) {
  const { event, digest } = authenticateWebhook(rawBody, signature, secret, nowMilliseconds);
  const invoice = await loadInvoice(event.invoiceId);
  // Amount/status are fetched through the authenticated provider API, never from notification input.
  const payment = await adapter.retrievePayment(event.paymentId);
  const reconciliation = reconcilePlatformPayment(event, invoice, payment);
  return { result: await inbox.applyOnce(event.eventId, digest, reconciliation), reconciliation };
}
