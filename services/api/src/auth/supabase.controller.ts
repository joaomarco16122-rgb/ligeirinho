import { Body, Controller, Inject, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Actor } from '../common/auth.types';
import { parse } from '../common/zod.pipe';
import { BearerGuard } from './bearer.guard';
import { CurrentUser } from './current-user.decorator';
import { Roles, RolesGuard } from './roles.guard';
import { supabaseAccessToken } from './supabase.client';
import { SupabaseAuthService } from './supabase.service';
@ApiTags('Supabase Auth')
@Controller()
export class SupabaseAuthController {
  constructor(@Inject(SupabaseAuthService) private readonly service: SupabaseAuthService) {}
  @Post('auth/supabase')
  exchange(@Body() body: unknown) {
    return this.service.exchange(
      parse(z.object({ accessToken: supabaseAccessToken }).strict(), body).accessToken,
    );
  }
  @Post('admin/users/:id/link-supabase')
  @UseGuards(BearerGuard, RolesGuard)
  @Roles('SUPER_ADMIN')
  @ApiBearerAuth()
  bind(@CurrentUser() actor: Actor, @Param('id') id: string, @Body() body: unknown) {
    return this.service.bind(
      actor,
      parse(z.string().uuid(), id),
      parse(
        z
          .object({
            supabaseUserId: z
              .string()
              .uuid()
              .transform((value) => value.toLowerCase()),
            reason: z.string().trim().min(10).max(500),
            confirm: z.literal(true),
            proofAccessToken: supabaseAccessToken.optional(),
          })
          .strict(),
        body,
      ),
    );
  }
}
