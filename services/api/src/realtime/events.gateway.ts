import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WsException,
} from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { DeliveryService } from '../deliveries/delivery.service';
@WebSocketGateway({
  namespace: '/events',
  cors: { origin: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',') },
})
export class EventsGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  constructor(
    private auth: AuthService,
    private deliveries: DeliveryService,
  ) {}
  async handleConnection(socket: Socket) {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string') throw new Error('token');
      const user = await this.auth.verifyAccess(token);
      if (user.mustChangePassword) throw new Error('password');
      socket.data.token = token;
      socket.data.actor = user;
      socket.emit('ready', { timestamp: new Date().toISOString() });
    } catch {
      socket.disconnect(true);
    }
  }
  handleDisconnect(socket: Socket) {
    const timer = this.timers.get(socket.id);
    if (timer) clearInterval(timer);
    this.timers.delete(socket.id);
  }
  @SubscribeMessage('subscribe.delivery') async subscribe(
    @ConnectedSocket() socket: Socket,
    @MessageBody() body: unknown,
  ) {
    if (
      !body ||
      typeof body !== 'object' ||
      !('deliveryId' in body) ||
      typeof body.deliveryId !== 'string'
    )
      throw new WsException('Atendimento inválido.');
    const id = body.deliveryId;
    try {
      const actor = await this.auth.verifyAccess(socket.data.token);
      const delivery = await this.deliveries.read(actor, id);
      this.handleDisconnect(socket);
      let busy = false;
      const timer = setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
          const fresh = await this.auth.verifyAccess(socket.data.token);
          const state = await this.deliveries.read(fresh, id);
          socket.emit('delivery.updated', {
            eventId: crypto.randomUUID(),
            timestamp: new Date().toISOString(),
            delivery: state,
          });
        } catch {
          socket.disconnect(true);
        } finally {
          busy = false;
        }
      }, 2000);
      timer.unref();
      this.timers.set(socket.id, timer);
      return { ok: true, delivery };
    } catch {
      throw new WsException('Atendimento indisponível.');
    }
  }
}
