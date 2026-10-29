import { Inject, Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Actor } from '../common/auth.types';
import { parse } from '../common/zod.pipe';
import { BearerGuard } from '../auth/bearer.guard';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { passwordSchema } from '../auth/auth.controller';
import { AdminService } from './admin.service';
const id = z.string().uuid();
const name = z.string().trim().min(2).max(160);
const loginFields = {
  name,
  cityId: id,
  email: z.string().trim().email().max(254),
  password: passwordSchema,
};
@ApiTags('Administração')
@ApiBearerAuth()
@Controller('admin')
@UseGuards(BearerGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
export class AdminController {
  constructor(@Inject(AdminService) private readonly admin: AdminService) {}
  @Get('cities') cities(@CurrentUser() actor: Actor) {
    return this.admin.cities(actor);
  }
  @Post('cities') createCity(@CurrentUser() actor: Actor, @Body() body: unknown) {
    return this.admin.createCity(
      actor,
      parse(z.object({ name, state: z.string().length(2).toUpperCase() }).strict(), body),
    );
  }
  @Get('establishments') establishments(@CurrentUser() actor: Actor) {
    return this.admin.establishments(actor);
  }
  @Post('establishments') createEstablishment(@CurrentUser() actor: Actor, @Body() body: unknown) {
    return this.admin.createEstablishment(
      actor,
      parse(
        z
          .object({
            ...loginFields,
            address: z.string().trim().min(5).max(500),
            latitude: z.number().min(-90).max(90),
            longitude: z.number().min(-180).max(180),
            responsibleName: name.optional(),
          })
          .strict(),
        body,
      ),
    );
  }
  @Get('couriers') couriers(@CurrentUser() actor: Actor) {
    return this.admin.couriers(actor);
  }
  @Post('couriers') createCourier(@CurrentUser() actor: Actor, @Body() body: unknown) {
    return this.admin.createCourier(actor, parse(z.object(loginFields).strict(), body));
  }
  @Get('users') users(@CurrentUser() actor: Actor) {
    return this.admin.users(actor);
  }
  @Post('users') createAdmin(@CurrentUser() actor: Actor, @Body() body: unknown) {
    return this.admin.createAdmin(actor, parse(z.object(loginFields).strict(), body));
  }
  @Post('users/:id/reset-password') resetPassword(
    @CurrentUser() actor: Actor,
    @Param('id') userId: string,
    @Body() body: unknown,
  ) {
    return this.admin.resetPassword(
      actor,
      parse(id, userId),
      parse(
        z
          .object({
            password: passwordSchema,
            reason: z.string().trim().min(10).max(500),
            confirm: z.literal(true),
          })
          .strict(),
        body,
      ),
    );
  }
  @Get('tariffs') tariffs(@CurrentUser() actor: Actor) {
    return this.admin.tariffs(actor);
  }
  @Post('tariffs') createTariff(@CurrentUser() actor: Actor, @Body() body: unknown) {
    return this.admin.createTariff(
      actor,
      parse(
        z
          .object({
            cityId: id,
            baseCents: z.number().int().min(0).max(1000000),
            perKmCents: z.number().int().min(0).max(100000),
          })
          .strict(),
        body,
      ),
    );
  }
  @Post('blocks') block(@CurrentUser() actor: Actor, @Body() body: unknown) {
    return this.admin.setRelationship(
      actor,
      parse(
        z
          .object({
            establishmentId: id,
            courierId: id,
            reason: z.string().trim().min(10).max(500),
          })
          .strict(),
        body,
      ),
      'block',
    );
  }
  @Post('preferences') preference(@CurrentUser() actor: Actor, @Body() body: unknown) {
    return this.admin.setRelationship(
      actor,
      parse(
        z
          .object({
            establishmentId: id,
            courierId: id,
            priority: z.number().int().min(0).max(10000),
          })
          .strict(),
        body,
      ),
      'preference',
    );
  }
  @Get('audit') audit(@CurrentUser() actor: Actor) {
    return this.admin.audit(actor);
  }
}
