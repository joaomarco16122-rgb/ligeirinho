import {
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import { BearerGuard } from '../auth/bearer.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Actor } from '../common/auth.types';
import { PrismaService } from '../common/prisma.service';
import { parse } from '../common/zod.pipe';
import { includeDelivery } from '../deliveries/delivery.service';
import { DispatchService } from './dispatch.service';
@Controller('courier')
@UseGuards(BearerGuard)
export class CourierController {
  constructor(
    private readonly db: PrismaService,
    private readonly dispatch: DispatchService,
  ) {}
  private id(user: Actor) {
    if (user.role !== 'COURIER' || !user.courierId)
      throw new ForbiddenException('Acesso exclusivo de entregadores.');
    return user.courierId;
  }
  @Get('me') me(@CurrentUser() user: Actor) {
    return this.db.courier.findUniqueOrThrow({ where: { id: this.id(user) } });
  }
  @Post('availability') async availability(@CurrentUser() user: Actor, @Body() body: unknown) {
    const id = this.id(user),
      { online, latitude, longitude } = parse(
        z
          .object({
            online: z.boolean(),
            latitude: z.number().min(-90).max(90).optional(),
            longitude: z.number().min(-180).max(180).optional(),
          })
          .strict(),
        body,
      );
    if ((latitude === undefined) !== (longitude === undefined))
      throw new ConflictException('Informe as duas coordenadas de ativação.');
    const result = await this.dispatch.transaction(async (tx) => {
      const c = await tx.courier.findUniqueOrThrow({ where: { id } });
      if (!c.active) throw new ForbiddenException('Cadastro de entregador inativo.');
      if (c.status === 'OFFER_PENDING')
        throw new ConflictException(
          'Responda à oferta pendente antes de alterar a disponibilidade.',
        );
      if (
        online &&
        latitude === undefined &&
        (!c.locationAt || Date.now() - c.locationAt.getTime() > this.dispatch.maxAge * 1000)
      )
        throw new ConflictException('Atualize sua localização antes de ficar online.');
      return tx.courier.update({
        where: { id },
        data: {
          online,
          ...(online && latitude !== undefined
            ? { latitude, longitude, locationAt: new Date() }
            : {}),
          status: c.status === 'BUSY' ? 'BUSY' : online ? 'AVAILABLE' : 'OFFLINE',
        },
      });
    });
    if (online) await this.dispatch.sweep();
    return result;
  }
  @Post('location') async location(@CurrentUser() user: Actor, @Body() body: unknown) {
    const id = this.id(user),
      point = parse(
        z
          .object({
            latitude: z.number().min(-90).max(90),
            longitude: z.number().min(-180).max(180),
          })
          .strict(),
        body,
      );
    return this.dispatch.transaction(async (tx) => {
      const c = await tx.courier.findUniqueOrThrow({ where: { id } });
      if (!c.active || (!c.online && c.status !== 'BUSY'))
        throw new ForbiddenException(
          'Localização disponível somente durante o trabalho. Use a ativação online com localização para iniciar.',
        );
      return tx.courier.update({ where: { id }, data: { ...point, locationAt: new Date() } });
    });
  }
  @Get('offers') offers(@CurrentUser() user: Actor) {
    return this.db.dispatchOffer.findMany({
      where: { courierId: this.id(user), status: 'PENDING', expiresAt: { gt: new Date() } },
      include: { delivery: { include: includeDelivery } },
    });
  }
  @Post('offers/:id/accept') accept(@CurrentUser() user: Actor, @Param('id') id: string) {
    return this.dispatch.respond(id, this.id(user), true);
  }
  @Post('offers/:id/reject') reject(@CurrentUser() user: Actor, @Param('id') id: string) {
    return this.dispatch.respond(id, this.id(user), false);
  }
}
