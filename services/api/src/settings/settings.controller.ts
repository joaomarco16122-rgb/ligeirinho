import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { BearerGuard } from '../auth/bearer.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles, RolesGuard } from '../auth/roles.guard';
import { Actor } from '../common/auth.types';
import { parse } from '../common/zod.pipe';
import { scopes, settingCatalog, target } from './settings.rules';
import { SettingsService } from './settings.service';

const scopeFields = { scope: z.enum(scopes), scopeId: z.string().max(50).optional() };
const writeFields = {
  ...scopeFields,
  expectedVersion: z.number().int().min(0).max(2147483646),
  reason: z.string().trim().min(10).max(500),
  confirm: z.literal(true),
};
@ApiTags('Configurações')
@ApiBearerAuth()
@Controller('admin/settings')
@UseGuards(BearerGuard, RolesGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}
  @Get('catalog') catalog() {
    return Object.entries(settingCatalog).map(([key, { schema: _, ...definition }]) => ({
      key,
      ...definition,
    }));
  }
  @Get('effective') effective(@CurrentUser() actor: Actor, @Query() query: unknown) {
    return this.settings.effective(
      actor,
      parse(
        z
          .object({
            cityId: z.string().uuid().optional(),
            establishmentId: z.string().uuid().optional(),
            userId: z.string().uuid().optional(),
          })
          .strict(),
        query,
      ),
    );
  }
  @Get() list(@CurrentUser() actor: Actor, @Query() query: unknown) {
    const input = parse(z.object(scopeFields).strict(), query);
    return this.settings.list(actor, target(input.scope, input.scopeId));
  }
  @Get(':key/history') history(
    @CurrentUser() actor: Actor,
    @Param('key') key: string,
    @Query() query: unknown,
  ) {
    const input = parse(z.object(scopeFields).strict(), query);
    return this.settings.history(actor, key, target(input.scope, input.scopeId));
  }
  @Put(':key') update(
    @CurrentUser() actor: Actor,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    const input = parse(z.object({ ...writeFields, value: z.unknown() }).strict(), body);
    return this.settings.update(actor, key, target(input.scope, input.scopeId), input);
  }
  @Post(':key/rollback') rollback(
    @CurrentUser() actor: Actor,
    @Param('key') key: string,
    @Body() body: unknown,
  ) {
    const input = parse(
      z.object({ ...writeFields, toVersion: z.number().int().min(1) }).strict(),
      body,
    );
    return this.settings.rollback(actor, key, target(input.scope, input.scopeId), input);
  }
}
