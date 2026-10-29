import { createHmac, randomUUID } from 'node:crypto';
import { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { createMapsAdapter, GoogleRoutesMaps } from '../src/integrations/maps';
import { createPushAdapter, FcmHttpPush } from '../src/integrations/push';
import {
  authorizeUpload,
  createS3UploadAdapter,
  S3QuarantineUploads,
  type PostSigner,
} from '../src/integrations/storage';
import {
  authenticateWebhook,
  ContractGatewayBilling,
  createBillingAdapter,
  processPlatformWebhook,
  reconcilePlatformPayment,
  type PlatformInvoiceSnapshot,
  type PlatformPayment,
  type DurablePaymentInbox,
} from '../src/integrations/payments';
import { HttpTransport } from '../src/integrations/transport';
const origin = { latitude: -23.55, longitude: -46.63 };
const destination = { latitude: -23.57, longitude: -46.65 };
const response = (json: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 503,
  json: async () => json,
});

describe('rotas: fonte de preço explícita e requests do provedor', () => {
  it('mantém fallback de desenvolvimento identificado e nunca o permite em produção', async () => {
    const route = await createMapsAdapter({ NODE_ENV: 'test' }).route([origin, destination]);
    expect(route.source).toBe('STRAIGHT_LINE_DEVELOPMENT');
    expect(route.distanceMeters).toBeGreaterThan(1000);
    expect(route.durationSeconds).toBeNull();
    expect(() => createMapsAdapter({ NODE_ENV: 'production' })).toThrow();
  });
  it('Google preserva origem, ordem dos destinos e máscara mínima', async () => {
    const middle = { latitude: -23.56, longitude: -46.64 };
    const transport = vi
      .fn<HttpTransport>()
      .mockResolvedValue(response({ routes: [{ distanceMeters: 7890, duration: '123.5s' }] }));
    const result = await new GoogleRoutesMaps('test-key-not-real', transport).route([
      origin,
      middle,
      destination,
    ]);
    const [url, options] = transport.mock.calls[0]!;
    expect(url).toBe('https://routes.googleapis.com/directions/v2:computeRoutes');
    expect(options.redirect).toBe('error');
    expect(options.headers['X-Goog-Api-Key']).toBe('test-key-not-real');
    expect(options.headers['X-Goog-FieldMask']).toBe('routes.distanceMeters,routes.duration');
    expect(JSON.parse(options.body!)).toMatchObject({
      origin: { location: { latLng: origin } },
      intermediates: [{ location: { latLng: middle } }],
      destination: { location: { latLng: destination } },
    });
    expect(result).toEqual({
      distanceMeters: 7890,
      durationSeconds: 123.5,
      source: 'GOOGLE_ROUTES',
    });
  });
  it('falha do provedor não troca a tarifa silenciosamente nem expõe segredo', async () => {
    const transport = vi
      .fn<HttpTransport>()
      .mockResolvedValue(response({ error: 'secret-provider-body' }, false));
    await expect(
      new GoogleRoutesMaps('secret-key', transport).route([origin, destination]),
    ).rejects.toThrow('Google Routes indisponível');
    expect(transport).toHaveBeenCalledTimes(1);
    const malformed = vi
      .fn<HttpTransport>()
      .mockResolvedValue(response({ routes: [{ distanceMeters: -1, duration: '5s' }] }));
    await expect(
      new GoogleRoutesMaps('test-key', malformed).route([origin, destination]),
    ).rejects.toThrow();
  });
  it('coordenadas inválidas e chave ausente são rejeitadas antes de requisição', async () => {
    const transport = vi.fn<HttpTransport>();
    await expect(
      new GoogleRoutesMaps('test-key', transport).route([origin, { latitude: 100, longitude: 0 }]),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
    expect(() => createMapsAdapter({ MAPS_PROVIDER: 'google' })).toThrow();
  });
});

describe('push FCM: aceitação não significa entrega no dispositivo', () => {
  const message = {
    token: 'device-token-for-unit-test-only',
    title: 'Nova oferta',
    body: 'Abra o aplicativo.',
    eventId: randomUUID(),
    deliveryId: randomUUID(),
  };
  it('modo desativado informa disabled e é proibido em produção', async () => {
    expect(await createPushAdapter({ NODE_ENV: 'test' }).send(message)).toEqual({
      state: 'disabled',
    });
    expect(() => createPushAdapter({ NODE_ENV: 'production' })).toThrow();
    expect(() =>
      createPushAdapter({ PUSH_PROVIDER: 'fcm', FCM_PROJECT_ID: 'project-test' }),
    ).toThrow();
  });
  it('envia HTTP v1 com token renovável, prazo curto e ID de sincronização', async () => {
    const accessToken = vi.fn(async () => 'oauth-test-token');
    const transport = vi
      .fn<HttpTransport>()
      .mockResolvedValue(response({ name: 'projects/project-test/messages/123' }));
    const push = new FcmHttpPush('project-test', accessToken, transport);
    const result = await push.send(message);
    expect(accessToken).toHaveBeenCalledTimes(1);
    expect(transport.mock.calls[0]![0]).toBe(
      'https://fcm.googleapis.com/v1/projects/project-test/messages:send',
    );
    const options = transport.mock.calls[0]![1];
    expect(options.headers.Authorization).toBe('Bearer oauth-test-token');
    expect(JSON.parse(options.body!)).toMatchObject({
      message: {
        token: message.token,
        data: { eventId: message.eventId, deliveryId: message.deliveryId },
        android: { ttl: '10s' },
      },
    });
    expect(result).toEqual({
      state: 'accepted',
      providerMessageId: 'projects/project-test/messages/123',
    });
    expect(result).not.toHaveProperty('delivered');
  });
  it('recusa payload extra e falhas de autenticação sem afirmar envio', async () => {
    const transport = vi.fn<HttpTransport>().mockResolvedValue(response({}, false));
    await expect(
      new FcmHttpPush('project-test', async () => '', transport).send(message),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
    await expect(
      new FcmHttpPush('project-test', async () => 'token', transport).send({
        ...message,
        admin: true,
      } as typeof message),
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});

describe('cobrança da plataforma: autenticação, conciliação e idempotência', () => {
  const invoice: PlatformInvoiceSnapshot = {
    id: randomUUID(),
    establishmentId: randomUUID(),
    amountCents: 1990,
    currency: 'BRL',
    payerEmail: 'loja@example.test',
  };
  const event = {
    eventId: randomUUID(),
    type: 'platform.payment.updated' as const,
    paymentId: 'payment-123',
    invoiceId: invoice.id,
  };
  const payment: PlatformPayment = {
    id: event.paymentId,
    invoiceId: invoice.id,
    amountCents: 1990,
    currency: 'BRL',
    status: 'paid',
  };
  const secret = 'unit-test-webhook-secret-only-32-or-more';
  const now = 1800000000000;
  const sign = (body: Buffer, seconds = now / 1000) =>
    `t=${seconds},v1=${createHmac('sha256', secret).update(`${seconds}.`).update(body).digest('hex')}`;
  it('valida assinatura sobre bytes originais e extrai somente referência de evento', () => {
    const body = Buffer.from(JSON.stringify(event));
    const verified = authenticateWebhook(body, sign(body), secret, now);
    expect(verified.event).toEqual(event);
    expect(verified.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(() =>
      authenticateWebhook(
        Buffer.from(JSON.stringify({ ...event, paymentId: 'tampered' })),
        sign(body),
        secret,
        now,
      ),
    ).toThrow();
  });
  it('rejeita notificações antigas, futuras, enormes ou com segredo inválido', () => {
    const body = Buffer.from(JSON.stringify(event));
    expect(() => authenticateWebhook(body, sign(body, now / 1000 - 301), secret, now)).toThrow();
    expect(() => authenticateWebhook(body, sign(body, now / 1000 + 301), secret, now)).toThrow();
    expect(() => authenticateWebhook(Buffer.alloc(65537), sign(body), secret, now)).toThrow();
    expect(() => authenticateWebhook(body, sign(body), 'short', now)).toThrow();
  });
  it('não aceita status ou valores financeiros fornecidos pelo webhook, mesmo assinado', () => {
    const body = Buffer.from(JSON.stringify({ ...event, amountCents: 1, status: 'paid' }));
    expect(() => authenticateWebhook(body, sign(body), secret, now)).toThrow();
  });
  it('concilia só pagamento consultado com valor, fatura e moeda do snapshot confiável', () => {
    expect(reconcilePlatformPayment(event, invoice, payment)).toMatchObject({
      status: 'paid',
      amountCents: 1990,
    });
    expect(() =>
      reconcilePlatformPayment(event, invoice, { ...payment, amountCents: 1 }),
    ).toThrow();
    expect(() =>
      reconcilePlatformPayment(event, invoice, { ...payment, invoiceId: randomUUID() }),
    ).toThrow();
    expect(() =>
      reconcilePlatformPayment(event, invoice, {
        ...payment,
        currency: 'USD',
      } as unknown as PlatformPayment),
    ).toThrow();
  });
  it('repete evento no inbox durável pelo mesmo ID e digest; assinatura inválida não consulta provedor', async () => {
    const body = Buffer.from(JSON.stringify(event));
    const load = vi.fn(async () => invoice);
    const retrieve = vi.fn(async () => payment);
    // Test double for the durable transaction port; this is not a production inbox.
    const records = new Map<string, string>();
    const inbox: DurablePaymentInbox = {
      async applyOnce(id, digest) {
        const previous = records.get(id);
        if (previous && previous !== digest) throw new Error('event collision');
        if (previous) return 'duplicate';
        records.set(id, digest);
        return 'applied';
      },
    };
    const adapter = { createCheckout: vi.fn(), retrievePayment: retrieve };
    await expect(
      processPlatformWebhook(body, 'invalid-signature', secret, load, adapter, inbox, now),
    ).rejects.toThrow();
    expect(load).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
    expect(
      (await processPlatformWebhook(body, sign(body), secret, load, adapter, inbox, now)).result,
    ).toBe('applied');
    expect(
      (await processPlatformWebhook(body, sign(body), secret, load, adapter, inbox, now)).result,
    ).toBe('duplicate');
    const changed = Buffer.from(JSON.stringify({ ...event, paymentId: 'payment-other' }));
    const otherAdapter = {
      ...adapter,
      retrievePayment: vi.fn(async () => ({ ...payment, id: 'payment-other' })),
    };
    await expect(
      processPlatformWebhook(changed, sign(changed), secret, load, otherAdapter, inbox, now),
    ).rejects.toThrow('event collision');
  });
  it('connector HTTPS usa chave idempotente e consulta autenticada; não alega compatibilidade com gateway específico', async () => {
    const transport = vi
      .fn<HttpTransport>()
      .mockResolvedValueOnce(
        response({
          providerInvoiceId: 'invoice-operator-1',
          checkoutUrl: 'https://checkout.example.test/pay/1',
        }),
      )
      .mockResolvedValueOnce(response(payment));
    const gateway = new ContractGatewayBilling(
      'https://billing.example.test',
      'operator-test-token',
      transport,
    );
    await gateway.createCheckout(invoice);
    await gateway.retrievePayment('payment-123');
    expect(transport.mock.calls[0]![1].headers['Idempotency-Key']).toBe(invoice.id);
    expect(JSON.parse(transport.mock.calls[0]![1].body!)).toEqual(invoice);
    expect(transport.mock.calls[1]![0]).toBe(
      'https://billing.example.test/v1/platform-payments/payment-123',
    );
    expect(transport.mock.calls[1]![1].headers.Authorization).toBe('Bearer operator-test-token');
    expect(() => new ContractGatewayBilling('http://billing.example.test', 'token')).toThrow();
    await expect(gateway.retrievePayment('../private')).rejects.toThrow();
    expect(() => createBillingAdapter({ NODE_ENV: 'production' })).toThrow();
    expect(createBillingAdapter({ NODE_ENV: 'test' })).toBeNull();
  });
});

describe('S3: autorização e política de upload em quarentena', () => {
  const establishmentId = randomUUID(),
    deliveryId = randomUUID(),
    courierId = randomUUID();
  const actor = { id: randomUUID(), role: 'ESTABLISHMENT', establishmentId, courierId: null };
  const delivery = { id: deliveryId, establishmentId, courierId, status: 'EM_ENTREGA' };
  const input = { deliveryId, contentType: 'image/jpeg' as const, sizeBytes: 1024 };
  it('isola estabelecimento/entregador e não dá upload irrestrito para admin', () => {
    expect(authorizeUpload(actor, delivery, input).state).toBe('quarantined');
    expect(() =>
      authorizeUpload({ ...actor, establishmentId: randomUUID() }, delivery, input),
    ).toThrow();
    expect(() => authorizeUpload({ ...actor, role: 'ADMIN' }, delivery, input)).toThrow();
    expect(() => authorizeUpload(actor, { ...delivery, status: 'FINALIZADO' }, input)).toThrow();
    expect(() =>
      authorizeUpload(actor, delivery, { ...input, deliveryId: randomUUID() }),
    ).toThrow();
  });
  it('recusa HTML/SVG, nomes/caminhos do cliente e imagens acima do limite', () => {
    expect(() =>
      authorizeUpload(actor, delivery, {
        ...input,
        contentType: 'image/svg+xml',
      } as unknown as typeof input),
    ).toThrow();
    expect(() =>
      authorizeUpload(actor, delivery, { ...input, filename: '../evil.jpg' } as typeof input),
    ).toThrow();
    expect(() =>
      authorizeUpload(actor, delivery, { ...input, sizeBytes: 5 * 1024 * 1024 + 1 }),
    ).toThrow();
    const policy = authorizeUpload(actor, delivery, input, () => 'server-generated-id');
    expect(policy.key).toBe(`quarantine/${establishmentId}/${deliveryId}/server-generated-id.jpg`);
  });
  it('SDK recebe condições assinadas de tamanho, tipo, objeto e expiração de 60s', async () => {
    const client = new S3Client({
      region: 'us-east-1',
      credentials: { accessKeyId: 'unit-test-not-real', secretAccessKey: 'unit-test-not-real' },
    });
    const signPost = vi.fn<PostSigner>().mockResolvedValue({
      url: 'https://bucket.example.test',
      fields: { policy: 'test-signed-policy' },
    });
    const result = await new S3QuarantineUploads(client, 'bucket-test', signPost).prepare(
      actor,
      delivery,
      input,
    );
    const options = signPost.mock.calls[0]![1];
    expect(options).toMatchObject({ Bucket: 'bucket-test', Expires: 60 });
    expect(options.Conditions).toContainEqual(['content-length-range', 1, 5 * 1024 * 1024]);
    expect(options.Conditions).toContainEqual(['eq', '$Content-Type', 'image/jpeg']);
    expect(options.Conditions).toContainEqual(['eq', '$key', result.objectKey]);
    expect(result.state).toBe('quarantined');
    expect(result).not.toHaveProperty('publicUrl');
    client.destroy();
  });
  it('gera política S3 realmente assinada localmente pelo SDK sem contato com o provedor', async () => {
    const client = new S3Client({
      region: 'us-east-1',
      credentials: { accessKeyId: 'unit-test-not-real', secretAccessKey: 'unit-test-not-real' },
    });
    try {
      const result = await new S3QuarantineUploads(client, 'bucket-test').prepare(
        actor,
        delivery,
        input,
      );
      expect(result.fields['X-Amz-Signature']).toMatch(/^[a-f0-9]{64}$/);
      const signedPolicy = JSON.parse(
        Buffer.from(result.fields.Policy!, 'base64').toString('utf8'),
      );
      expect(signedPolicy.conditions).toContainEqual(['content-length-range', 1, 5 * 1024 * 1024]);
      expect(signedPolicy.conditions).toContainEqual(['eq', '$key', result.objectKey]);
      expect(signedPolicy.conditions).toContainEqual(['eq', '$Content-Type', 'image/jpeg']);
      expect(new Date(signedPolicy.expiration).getTime()).toBeGreaterThan(Date.now());
      expect(result.url).toMatch(/^https:/);
    } finally {
      client.destroy();
    }
  });
  it('recusa endpoints sem TLS em produção antes de acessar credenciais', () => {
    expect(() =>
      createS3UploadAdapter({
        NODE_ENV: 'production',
        STORAGE_PROVIDER: 's3',
        S3_BUCKET: 'bucket-test',
        S3_REGION: 'us-east-1',
        S3_ENDPOINT: 'http://localhost:9000',
      }),
    ).toThrow();
    expect(() =>
      createS3UploadAdapter({
        STORAGE_PROVIDER: 's3',
        S3_BUCKET: 'bucket-test',
        S3_REGION: 'us-east-1',
        S3_ENDPOINT: 'https://name:secret@s3.example.test',
      }),
    ).toThrow();
  });
});
