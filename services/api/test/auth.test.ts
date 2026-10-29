import { describe, expect, it } from 'vitest';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { BearerGuard } from '../src/auth/bearer.guard';
import { RolesGuard } from '../src/auth/roles.guard';
import { passwordSchema } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import { Reflector } from '@nestjs/core';
import { ExecutionContext } from '@nestjs/common';
const ctx = (req: unknown) =>
  ({
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => () => {},
    getClass: () => class {},
  }) as unknown as ExecutionContext;
describe('Proteções de autenticação', () => {
  it('rejeita chamada sem bearer antes de consultar sessão', async () => {
    let called = false;
    const guard = new BearerGuard({
      verifyAccess: async () => {
        called = true;
        return {};
      },
    } as unknown as AuthService);
    await expect(
      guard.canActivate(ctx({ headers: {}, url: '/api/v1/deliveries' })),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(called).toBe(false);
  });
  it('bloqueia operações de uma credencial temporária e permite trocar a senha', async () => {
    const guard = new BearerGuard({
      verifyAccess: async () => ({ mustChangePassword: true }),
    } as unknown as AuthService);
    await expect(
      guard.canActivate(
        ctx({ headers: { authorization: 'Bearer token' }, url: '/api/v1/deliveries' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      guard.canActivate(
        ctx({ headers: { authorization: 'Bearer token' }, url: '/api/v1/auth/change-password' }),
      ),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(
        ctx({ headers: { authorization: 'Bearer token' }, url: '/api/v1/auth/me?profile=true' }),
      ),
    ).resolves.toBe(true);
  });
  it('não aceita perfis externos à lista permitida', () => {
    const guard = new RolesGuard({
      getAllAndOverride: () => ['SUPER_ADMIN'],
    } as unknown as Reflector);
    expect(() => guard.canActivate(ctx({ user: { role: 'ESTABLISHMENT' } }))).toThrow(
      ForbiddenException,
    );
    expect(guard.canActivate(ctx({ user: { role: 'SUPER_ADMIN' } }))).toBe(true);
  });
  it('exige senha de pelo menos doze caracteres e limita entrada', () => {
    expect(passwordSchema.safeParse('curta').success).toBe(false);
    expect(passwordSchema.safeParse('a'.repeat(129)).success).toBe(false);
    expect(passwordSchema.safeParse('senha-longa-temporaria').success).toBe(true);
  });
});
