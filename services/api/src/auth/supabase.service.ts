import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../common/prisma.service';
import { Actor } from '../common/auth.types';
import { AuthService } from './auth.service';
import { SupabaseIdentityClient } from './supabase.client';
@Injectable()
export class SupabaseAuthService {
  constructor(
    @Inject(PrismaService) private readonly db: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(SupabaseIdentityClient) private readonly identities: SupabaseIdentityClient,
  ) {}
  async exchange(accessToken: string) {
    const identity = await this.identities.verify(accessToken);
    const user = await this.db.user.findUnique({ where: { supabaseUserId: identity.id } });
    if (!user?.active)
      throw new ForbiddenException(
        'Conta Supabase ainda não vinculada a um usuário ativo do Ligeirinho.',
      );
    // Email match and metadata roles deliberately do not create or authorize an account.
    return this.auth.issueForUser(user.id, 'supabase', {
      supabaseUserId: identity.id,
      supabaseSessionId: identity.sessionId,
      expiresAt: identity.expiresAt,
    });
  }
  async bind(
    actor: Actor,
    userId: string,
    input: { supabaseUserId: string; reason: string; confirm: true; proofAccessToken?: string },
  ) {
    if (actor.role !== 'SUPER_ADMIN')
      throw new ForbiddenException('Somente Super Admin pode vincular identidades.');
    this.identities.assertConfigured();
    const target = await this.db.user.findUnique({ where: { id: userId } });
    if (!target) throw new NotFoundException('Usuário não encontrado.');
    if (!target.active)
      throw new ConflictException('Ative o cadastro antes de vincular uma identidade.');
    if (target.role === 'SUPER_ADMIN') {
      if (target.id !== actor.id || !input.proofAccessToken)
        throw new ForbiddenException(
          'Super Admin só pode vincular a própria identidade após comprovar a sessão Supabase.',
        );
      const proof = await this.identities.verify(input.proofAccessToken);
      if (proof.id !== input.supabaseUserId)
        throw new BadRequestException(
          'A sessão comprovada não corresponde à identidade informada.',
        );
    }
    const binding = await this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${userId} FOR UPDATE`;
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
      if (!user.active || user.role !== target.role)
        throw new ConflictException('Cadastro mudou; atualize antes de confirmar.');
      const updated = await tx.user.update({
        where: { id: userId },
        data: { supabaseUserId: input.supabaseUserId },
        select: { id: true, supabaseUserId: true, mustChangePassword: true },
      });
      await tx.session.updateMany({ where: { userId }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({
        data: {
          actorId: actor.id,
          action: 'SUPABASE_IDENTITY_BOUND',
          entityType: 'User',
          entityId: userId,
          reason: input.reason,
          metadata: {
            previousSupabaseUserId: user.supabaseUserId,
            supabaseUserId: input.supabaseUserId,
          },
        },
      });
      return updated;
    });
    return {
      ...binding,
      message:
        'Identidade vinculada explicitamente. Sessões Nest anteriores revogadas; a troca inicial de senha foi preservada.',
    };
  }
}
