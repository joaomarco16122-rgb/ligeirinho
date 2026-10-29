import { Inject, Body, Controller, Get, Header, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Actor } from '../common/auth.types';
import { parse } from '../common/zod.pipe';
import { AuthService } from './auth.service';
import { BearerGuard } from './bearer.guard';
import { CurrentUser } from './current-user.decorator';
export const passwordSchema = z.string().min(12).max(128);
@ApiTags('Autenticação')
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Get('provider')
  @Header('Cache-Control', 'no-store')
  provider() {
    return this.auth.provider();
  }
  @Post('login')
  login(@Body() body: unknown) {
    const data = parse(
      z
        .object({ email: z.string().email().max(254), password: z.string().min(1).max(128) })
        .strict(),
      body,
    );
    return this.auth.login(data.email, data.password);
  }
  @Post('refresh')
  refresh(@Body() body: unknown) {
    return this.auth.refresh(
      parse(z.object({ refreshToken: z.string().min(20).max(300) }).strict(), body).refreshToken,
    );
  }
  @Get('me')
  @UseGuards(BearerGuard)
  @ApiBearerAuth()
  me(@CurrentUser() user: Actor) {
    return this.auth.profile(user.id);
  }
  @Post('logout')
  @UseGuards(BearerGuard)
  @ApiBearerAuth()
  logout(@CurrentUser() user: Actor) {
    return this.auth.logout(user);
  }
  @Post('logout-all')
  @UseGuards(BearerGuard)
  @ApiBearerAuth()
  logoutAll(@CurrentUser() user: Actor) {
    return this.auth.logoutAll(user);
  }
  @Post('change-password')
  @UseGuards(BearerGuard)
  @ApiBearerAuth()
  changePassword(@CurrentUser() user: Actor, @Body() body: unknown) {
    const data = parse(
      z
        .object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema })
        .strict(),
      body,
    );
    return this.auth.changePassword(user, data.currentPassword, data.newPassword);
  }
}
