import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { DeliveryStatus } from '@prisma/client';
import { BearerGuard } from '../auth/bearer.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Actor } from '../common/auth.types';
import { parse } from '../common/zod.pipe';
import { DeliveryService } from './delivery.service';
const stop = z
  .object({
    address: z.string().trim().min(3).max(300),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
  })
  .strict();
const stops = z.array(stop).min(1).max(20);
@Controller('deliveries')
@UseGuards(BearerGuard)
export class DeliveryController {
  constructor(private readonly service: DeliveryService) {}
  @Get() list(@CurrentUser() user: Actor) {
    return this.service.list(user);
  }
  @Post('quote') quote(@CurrentUser() user: Actor, @Body() body: unknown) {
    return this.service.quote(user, parse(z.object({ stops }).strict(), body).stops);
  }
  @Post() create(@CurrentUser() user: Actor, @Body() body: unknown) {
    return this.service.create(
      user,
      parse(
        z
          .object({
            quoteId: z.string().uuid(),
            idempotencyKey: z.string().min(8).max(100),
            stops: stops.optional(),
          })
          .strict(),
        body,
      ),
    );
  }
  @Get(':id') get(@CurrentUser() user: Actor, @Param('id') id: string) {
    return this.service.read(user, id);
  }
  @Patch(':id/progress') progress(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.progress(
      user,
      id,
      parse(z.object({ status: z.nativeEnum(DeliveryStatus) }).strict(), body).status,
    );
  }
  @Post(':id/confirm') confirm(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.confirm(
      user,
      id,
      parse(
        z.object({ stopCount: z.number().int().min(1).max(20).optional() }).strict(),
        body ?? {},
      ).stopCount,
    );
  }
  @Post(':id/cancellation') cancel(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.cancel(
      user,
      id,
      parse(z.object({ reason: z.string().trim().min(5).max(1000) }).strict(), body).reason,
    );
  }
  @Post(':id/cancellation/approve') approve(@CurrentUser() user: Actor, @Param('id') id: string) {
    return this.service.approveCancel(user, id);
  }
  @Post(':id/intervene') intervene(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    const p = parse(
      z
        .object({
          action: z.enum(['cancel', 'release']),
          reason: z.string().trim().min(10).max(1000),
          confirm: z.literal(true),
        })
        .strict(),
      body,
    );
    return this.service.intervene(user, id, p.action, p.reason);
  }
  @Get(':id/events') events(@CurrentUser() user: Actor, @Param('id') id: string) {
    return this.service.events(user, id);
  }
  @Get(':id/messages') messages(@CurrentUser() user: Actor, @Param('id') id: string) {
    return this.service.messages(user, id);
  }
  @Post(':id/messages') message(
    @CurrentUser() user: Actor,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.service.message(
      user,
      id,
      parse(z.object({ text: z.string().trim().min(1).max(2000) }).strict(), body).text,
    );
  }
}
