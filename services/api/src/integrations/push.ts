import { z } from 'zod';
import {
  HttpTransport,
  IntegrationUnavailable,
  production,
  proxyAwareTransport,
} from './transport';
const push = z
  .object({
    token: z.string().min(20).max(4096),
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().min(1).max(500),
    eventId: z.string().uuid(),
    deliveryId: z.string().uuid().optional(),
  })
  .strict();
export type PushInput = z.infer<typeof push>;
export interface PushAdapter {
  send(input: PushInput): Promise<{ state: 'accepted' | 'disabled'; providerMessageId?: string }>;
}
export class DisabledDevelopmentPush implements PushAdapter {
  async send(input: PushInput): Promise<{ state: 'disabled' }> {
    push.parse(input);
    return { state: 'disabled' };
  }
}
export class FcmHttpPush implements PushAdapter {
  constructor(
    private readonly projectId: string,
    private readonly accessToken: () => Promise<string>,
    private readonly transport: HttpTransport = proxyAwareTransport,
  ) {
    if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(projectId))
      throw new Error('FCM_PROJECT_ID inválido.');
  }
  async send(input: PushInput): Promise<{ state: 'accepted'; providerMessageId: string }> {
    const message = push.parse(input);
    try {
      const token = await this.accessToken();
      if (!token) throw new Error('credential missing');
      const response = await this.transport(
        `https://fcm.googleapis.com/v1/projects/${this.projectId}/messages:send`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            message: {
              token: message.token,
              notification: { title: message.title, body: message.body },
              data: {
                eventId: message.eventId,
                ...(message.deliveryId ? { deliveryId: message.deliveryId } : {}),
              },
              android: {
                priority: 'HIGH',
                ttl: '10s',
                notification: { channel_id: 'ofertas', sound: 'default' },
              },
            },
          }),
          signal: AbortSignal.timeout(8000),
          redirect: 'error',
        },
      );
      if (!response.ok) throw new Error('provider rejected');
      const result = z.object({ name: z.string().min(1).max(500) }).parse(await response.json());
      // Accepted by FCM does not establish delivery, display, or acceptance by Android.
      return { state: 'accepted', providerMessageId: result.name };
    } catch {
      throw new IntegrationUnavailable('FCM');
    }
  }
}
export function createPushAdapter(
  env: NodeJS.ProcessEnv,
  options: { transport?: HttpTransport; accessToken?: () => Promise<string> } = {},
): PushAdapter {
  const provider = env.PUSH_PROVIDER ?? 'disabled';
  if (provider === 'disabled') {
    if (production(env))
      throw new Error(
        'Push desativado não é permitido em produção neste adaptador. Configure FCM.',
      );
    return new DisabledDevelopmentPush();
  }
  if (provider !== 'fcm' || !env.FCM_PROJECT_ID || !options.accessToken)
    throw new Error('FCM requer projeto e provedor OAuth de token renovável.');
  return new FcmHttpPush(env.FCM_PROJECT_ID, options.accessToken, options.transport);
}
