import {
  Inject,
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../common/prisma.service';
import { Actor } from '../common/auth.types';
import { SupabaseIdentityClient } from './supabase.client';

const hashToken = (value: string) => createHash('sha256').update(value).digest('hex');
const safeUser = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  cityId: u.cityId,
  establishmentId: u.establishmentId,
  courierId: u.courierId,
  mustChangePassword: u.mustChangePassword,
});
@Injectable()
export class AuthService {
  private readonly dummyHash = argon2.hash(randomBytes(32).toString('hex'), {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(JwtService) private readonly jwt: JwtService,
    @Inject(SupabaseIdentityClient)
    private readonly supabase: SupabaseIdentityClient = new SupabaseIdentityClient(),
  ) {}
  provider() {
    return this.supabase.publicConfiguration();
  }
  private async tokens(user: User, sessionId: string, expiresAt: Date) {
    const accessTtlSeconds = Math.min(900, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
    if (accessTtlSeconds < 1)
      throw new UnauthorizedException('Comprovação de identidade expirada. Entre novamente.');
    const raw = randomBytes(32).toString('base64url');
    const refreshToken = `${sessionId}.${raw}`;
    await this.db.session.update({
      where: { id: sessionId },
      data: { refreshHash: hashToken(refreshToken) },
    });
    return {
      accessToken: await this.jwt.signAsync(
        { sub: user.id, sid: sessionId },
        { expiresIn: accessTtlSeconds, audience: 'ligeirinho', issuer: 'ligeirinho-api' },
      ),
      refreshToken,
      user: await this.profile(user.id),
    };
  }
  async profile(id: string) {
    const u = await this.db.user.findUniqueOrThrow({
      where: { id },
      include: { courier: true, establishment: true },
    });
    return { ...safeUser(u), courier: u.courier, establishment: u.establishment };
  }
  async login(email: string, password: string) {
    const user = await this.db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    const validPassword = await argon2.verify(
      user && !user.supabaseUserId ? user.passwordHash : await this.dummyHash,
      password,
    );
    if (!user || !user.active || user.supabaseUserId || !validPassword)
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    return this.issueForUser(user.id, 'local', undefined, user.passwordHash);
  }
  async issueForUser(
    userId: string,
    authProvider: 'local' | 'supabase',
    proof?: { supabaseUserId: string; supabaseSessionId: string; expiresAt: Date },
    expectedPasswordHash?: string,
  ) {
    const issued = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (
        !user?.active ||
        (authProvider === 'supabase' &&
          (!proof ||
            user.supabaseUserId !== proof.supabaseUserId ||
            !proof.supabaseSessionId ||
            proof.expiresAt.getTime() <= Date.now())) ||
        (authProvider === 'local' &&
          (user.supabaseUserId ||
            !expectedPasswordHash ||
            user.passwordHash !== expectedPasswordHash))
      )
        throw new UnauthorizedException('Conta não está disponível para este método de entrada.');
      const expiresAt =
        authProvider === 'supabase' ? proof!.expiresAt : new Date(Date.now() + 30 * 86400000);
      // A provider session is one client/device family. Keep its Nest row stable
      // across reloads and refreshes so logout invalidates every JWT for it.
      const existing =
        authProvider === 'supabase'
          ? await tx.session.findUnique({
              where: {
                userId_supabaseSessionId: {
                  userId: user.id,
                  supabaseSessionId: proof!.supabaseSessionId,
                },
              },
            })
          : null;
      if (existing && (existing.revokedAt || existing.authProvider !== 'supabase'))
        throw new UnauthorizedException('Esta sessão foi encerrada. Entre novamente no provedor.');
      const session = existing
        ? await tx.session.update({
            where: { id: existing.id },
            data: {
              // A stale tab must not shorten a family already renewed elsewhere.
              expiresAt:
                existing.expiresAt.getTime() > expiresAt.getTime() ? existing.expiresAt : expiresAt,
            },
          })
        : await tx.session.create({
            data: {
              userId: user.id,
              authProvider,
              supabaseSessionId: authProvider === 'supabase' ? proof!.supabaseSessionId : null,
              refreshHash: 'pending',
              expiresAt,
            },
          });
      return { user, session, tokenExpiresAt: expiresAt };
    });
    return this.tokens(issued.user, issued.session.id, issued.tokenExpiresAt);
  }
  async verifyAccess(token: string): Promise<Actor> {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; sid: string }>(token, {
        audience: 'ligeirinho',
        issuer: 'ligeirinho-api',
      });
      const s = await this.db.session.findUnique({
        where: { id: payload.sid },
        include: { user: true },
      });
      if (
        !s ||
        s.userId !== payload.sub ||
        s.revokedAt ||
        s.expiresAt.getTime() <= Date.now() ||
        !s.user.active
      )
        throw new Error('revoked');
      return {
        ...safeUser(s.user),
        sessionId: s.id,
        authProvider: s.authProvider === 'supabase' ? 'supabase' : 'local',
      };
    } catch {
      throw new UnauthorizedException('Sessão inválida ou expirada. Entre novamente.');
    }
  }
  async refresh(refreshToken: string) {
    const sessionId = refreshToken.split('.')[0];
    if (!sessionId) throw new UnauthorizedException('Sessão inválida.');
    const result = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Session" WHERE id = ${sessionId} FOR UPDATE`;
      const session = await tx.session.findUnique({
        where: { id: sessionId },
        include: { user: true },
      });
      if (
        !session ||
        session.revokedAt ||
        session.expiresAt.getTime() <= Date.now() ||
        !session.user.active ||
        session.authProvider === 'supabase'
      )
        return null;
      if (session.refreshHash !== hashToken(refreshToken)) {
        await tx.session.update({ where: { id: sessionId }, data: { revokedAt: new Date() } });
        return null;
      }
      const nextRefresh = `${sessionId}.${randomBytes(32).toString('base64url')}`;
      await tx.session.update({
        where: { id: sessionId },
        data: { refreshHash: hashToken(nextRefresh) },
      });
      return { user: session.user, refreshToken: nextRefresh };
    });
    if (!result) throw new UnauthorizedException('Sessão inválida. Entre novamente.');
    return {
      accessToken: await this.jwt.signAsync(
        { sub: result.user.id, sid: sessionId },
        { expiresIn: '15m', audience: 'ligeirinho', issuer: 'ligeirinho-api' },
      ),
      refreshToken: result.refreshToken,
      user: await this.profile(result.user.id),
    };
  }
  async logout(actor: Actor) {
    await this.db.$transaction(async (tx) => {
      // Serialize with exchanges: a revoked family remains a tombstone and can
      // never be recreated from the same still-unexpired provider JWT.
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR UPDATE`;
      const session = await tx.session.findUnique({ where: { id: actor.sessionId } });
      if (!session || session.userId !== actor.id)
        throw new UnauthorizedException('Sessão inválida.');
      if (session.authProvider === 'supabase' && session.supabaseSessionId) {
        await tx.session.updateMany({
          where: {
            userId: actor.id,
            authProvider: 'supabase',
            supabaseSessionId: session.supabaseSessionId,
          },
          data: { revokedAt: new Date() },
        });
      } else {
        await tx.session.update({
          where: { id: actor.sessionId },
          data: { revokedAt: new Date() },
        });
      }
    });
    return { message: 'Sessão encerrada.' };
  }
  async logoutAll(actor: Actor) {
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR UPDATE`;
      await tx.session.updateMany({
        where: { userId: actor.id },
        data: { revokedAt: new Date() },
      });
    });
    return {
      message: 'Todas as sessões Nest foram encerradas. Encerre também as sessões do provedor.',
    };
  }
  async changePassword(actor: Actor, currentPassword: string, newPassword: string) {
    const user = await this.db.user.findUniqueOrThrow({ where: { id: actor.id } });
    if (actor.authProvider === 'supabase') {
      if (!user.supabaseUserId)
        throw new UnauthorizedException('Vínculo Supabase não está disponível.');
      if (currentPassword === newPassword)
        throw new BadRequestException('Escolha uma senha diferente da atual.');
      await this.supabase.changePassword({
        expectedUserId: user.supabaseUserId,
        email: user.email,
        currentPassword,
        newPassword,
      });
      await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR UPDATE`;
        const current = await tx.user.findUniqueOrThrow({ where: { id: actor.id } });
        if (!current.active || current.supabaseUserId !== user.supabaseUserId)
          throw new ConflictException(
            'Vínculo de identidade mudou durante a operação. Entre novamente.',
          );
        await tx.user.update({ where: { id: actor.id }, data: { mustChangePassword: false } });
        await tx.session.updateMany({
          where: { userId: actor.id, id: { not: actor.sessionId } },
          data: { revokedAt: new Date() },
        });
        await tx.auditLog.create({
          data: {
            actorId: actor.id,
            action: 'SUPABASE_PASSWORD_CHANGED',
            entityType: 'User',
            entityId: actor.id,
          },
        });
      });
      return {
        message:
          'Senha alterada no Supabase. Outras sessões Nest encerradas; entre novamente no provedor.',
      };
    }
    if (user.supabaseUserId)
      throw new UnauthorizedException(
        'Esta conta utiliza autenticação Supabase. Entre novamente pelo provedor.',
      );
    if (!(await argon2.verify(user.passwordHash, currentPassword)))
      throw new UnauthorizedException('Senha atual inválida.');
    if (await argon2.verify(user.passwordHash, newPassword))
      throw new BadRequestException('Escolha uma senha diferente da atual.');
    const passwordHash = await argon2.hash(newPassword, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
    });
    await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id} FOR UPDATE`;
      const current = await tx.user.findUniqueOrThrow({ where: { id: actor.id } });
      if (!current.active || current.supabaseUserId || current.passwordHash !== user.passwordHash)
        throw new ConflictException('Credencial mudou durante a operação. Entre novamente.');
      await tx.user.update({
        where: { id: actor.id },
        data: { passwordHash, mustChangePassword: false },
      });
      await tx.session.updateMany({
        where: { userId: actor.id, id: { not: actor.sessionId } },
        data: { revokedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'PASSWORD_CHANGED',
          entityType: 'User',
          entityId: actor.id,
        },
      });
    });
    return { message: 'Senha alterada. Outras sessões foram encerradas.' };
  }
}
