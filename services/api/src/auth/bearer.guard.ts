import {
  Inject,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from './auth.service';
@Injectable()
export class BearerGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    const match = /^Bearer ([^\s]+)$/.exec(req.headers.authorization ?? '');
    if (!match) throw new UnauthorizedException('Entre na sua conta para continuar.');
    req.user = await this.auth.verifyAccess(match[1]);
    if (
      req.user.mustChangePassword &&
      !/^\/api\/v1\/auth\/(me|change-password|logout|logout-all)(?:\?|$)/.test(
        req.originalUrl ?? req.url,
      )
    ) {
      throw new ForbiddenException({
        message: 'Troque a senha inicial antes de continuar.',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }
    return true;
  }
}
