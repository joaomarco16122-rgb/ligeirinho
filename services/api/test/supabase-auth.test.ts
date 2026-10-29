import { createHash, randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { describe, expect, it, vi } from 'vitest';
import { SupabaseIdentityClient, supabaseAuthConfiguration } from '../src/auth/supabase.client';
import { SupabaseAuthService } from '../src/auth/supabase.service';
import { AuthService } from '../src/auth/auth.service';
import { AdminService } from '../src/admin/admin.service';
import { HttpTransport } from '../src/integrations/transport';
import { Actor } from '../src/common/auth.types';
const externalId = randomUUID();
const externalSessionId = randomUUID();
const env = {
  AUTH_PROVIDER: 'supabase',
  SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic-test-only',
};
const providerUser = (id = externalId) => ({
  id,
  email: 'staff@example.test',
  email_confirmed_at: '2026-01-01T00:00:00Z',
  user_metadata: { role: 'SUPER_ADMIN' },
  app_metadata: { role: 'SUPER_ADMIN' },
});
const token = (
  sub = externalId,
  exp = Math.floor(Date.now() / 1000) + 3600,
  sessionId: string | undefined = externalSessionId,
) =>
  `${Buffer.from('{"alg":"RS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub, exp, session_id: sessionId })).toString('base64url')}.synthetic-signature-not-real`;
const response = (value: unknown, ok = true) => ({
  ok,
  status: ok ? 200 : 401,
  json: async () => value,
});
function fakeDb(overrides: Record<string, unknown> = {}) {
  const user: any = {
    id: randomUUID(),
    name: 'Funcionário',
    email: 'staff@example.test',
    passwordHash: 'not-used-in-supabase-path',
    role: 'ESTABLISHMENT',
    cityId: randomUUID(),
    establishmentId: randomUUID(),
    courierId: null,
    active: true,
    mustChangePassword: true,
    supabaseUserId: externalId,
    ...overrides,
  };
  const db: any = {
    user: {
      findUnique: vi.fn(async () => user),
      findUniqueOrThrow: vi.fn(async () => user),
      update: vi.fn(async ({ data }: any) => ({ ...user, ...data })),
    },
    session: {
      create: vi.fn(async ({ data }: any) => ({ id: randomUUID(), ...data })),
      update: vi.fn(async () => ({})),
      updateMany: vi.fn(async () => ({ count: 2 })),
      findUnique: vi.fn(),
    },
    auditLog: { create: vi.fn(async () => ({})) },
    $queryRaw: vi.fn(async () => []),
  };
  db.$transaction = vi.fn(async (work: any) =>
    typeof work === 'function' ? work(db) : Promise.all(work),
  );
  return { db, user };
}
function statefulSessions(overrides: Record<string, unknown> = {}) {
  const fixture = fakeDb(overrides);
  const sessions = new Map<string, any>();
  fixture.db.session.create = vi.fn(async ({ data }: any) => {
    const row = { id: randomUUID(), revokedAt: null, ...data };
    sessions.set(row.id, row);
    return { ...row };
  });
  fixture.db.session.findUnique = vi.fn(async ({ where, include }: any) => {
    const key = where.userId_supabaseSessionId;
    const row = key
      ? [...sessions.values()].find(
          (value) =>
            value.userId === key.userId && value.supabaseSessionId === key.supabaseSessionId,
        )
      : sessions.get(where.id);
    return row ? { ...row, ...(include?.user ? { user: fixture.user } : {}) } : null;
  });
  fixture.db.session.update = vi.fn(async ({ where, data }: any) => {
    const row = sessions.get(where.id);
    if (!row) throw new Error('Unknown fixture session');
    Object.assign(row, data);
    return { ...row };
  });
  fixture.db.session.updateMany = vi.fn(async ({ where, data }: any) => {
    let count = 0;
    for (const row of sessions.values()) {
      if (
        Object.entries(where).every(([key, value]: [string, any]) =>
          key === 'id' && value?.not ? row.id !== value.not : row[key] === value,
        )
      ) {
        Object.assign(row, data);
        count++;
      }
    }
    return { count };
  });
  return { ...fixture, sessions };
}
const jwt = () => new JwtService({ secret: 'synthetic-nest-secret-unit-tests-only-at-least32' });
const actor = (user: any): Actor => ({
  ...user,
  sessionId: randomUUID(),
  authProvider: 'supabase',
});

describe('Supabase identity: prova remota no projeto configurado', () => {
  it('chave de configuração admite somente publishable ou legado anon, nunca service-role ou lixo', () => {
    const legacyKey = (role: string) =>
      `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
    expect(() =>
      supabaseAuthConfiguration({ ...env, SUPABASE_PUBLISHABLE_KEY: legacyKey('anon') }),
    ).not.toThrow();
    for (const key of [
      legacyKey('service_role'),
      legacyKey('authenticated'),
      'arbitrary-garbage',
      'sb_secret_wrong-kind',
    ]) {
      expect(() => supabaseAuthConfiguration({ ...env, SUPABASE_PUBLISHABLE_KEY: key })).toThrow(
        ServiceUnavailableException,
      );
    }
  });

  it('consulta servidor fixo com apikey e Bearer; ignora papéis de qualquer metadata', async () => {
    const transport = vi.fn<HttpTransport>().mockResolvedValue(response(providerUser()));
    const accessToken = token();
    const identity = await new SupabaseIdentityClient(transport, env).verify(accessToken);
    expect(transport.mock.calls[0]![0]).toBe(
      'https://abcdefghijklmnopqrst.supabase.co/auth/v1/user',
    );
    expect(transport.mock.calls[0]![1]).toMatchObject({
      method: 'GET',
      redirect: 'error',
      headers: { apikey: env.SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${accessToken}` },
    });
    expect(identity.id).toBe(externalId);
    expect(identity.sessionId).toBe(externalSessionId);
    expect(identity).not.toHaveProperty('role');
    expect(identity).not.toHaveProperty('user_metadata');
    expect(identity.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
  it('exige session_id UUID verificado e não aceita família ausente ou malformada', async () => {
    const transport = vi.fn<HttpTransport>().mockResolvedValue(response(providerUser()));
    const client = new SupabaseIdentityClient(transport, env);
    for (const sessionId of ['', 'caller-controlled-family', 'https://attacker.example.test']) {
      await expect(
        client.verify(token(externalId, Math.floor(Date.now() / 1000) + 60, sessionId)),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
    const missing = token().split('.');
    missing[1] = Buffer.from(
      JSON.stringify({ sub: externalId, exp: Math.floor(Date.now() / 1000) + 60 }),
    ).toString('base64url');
    await expect(client.verify(missing.join('.'))).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('rejeita token expirado, sub divergente e resposta sem confirmação de e-mail', async () => {
    const transport = vi.fn<HttpTransport>().mockResolvedValue(response(providerUser()));
    const client = new SupabaseIdentityClient(transport, env);
    await expect(
      client.verify(token(externalId, Math.floor(Date.now() / 1000) - 1)),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(client.verify(token(randomUUID()))).rejects.toBeInstanceOf(UnauthorizedException);
    transport.mockResolvedValue(response({ ...providerUser(), email_confirmed_at: null }));
    await expect(client.verify(token())).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('falha fechado quando desativado, sem chave ou com URL não confiável, antes de HTTP', async () => {
    const transport = vi.fn<HttpTransport>();
    for (const config of [
      {},
      { ...env, SUPABASE_PUBLISHABLE_KEY: '' },
      { ...env, SUPABASE_URL: 'http://localhost:3000' },
      { ...env, SUPABASE_URL: 'https://user:pass@project.example.test' },
      { ...env, SUPABASE_URL: env.SUPABASE_URL + '/arbitrary' },
      { ...env, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_wrong-key-kind' },
    ]) {
      await expect(new SupabaseIdentityClient(transport, config).verify(token())).rejects.toThrow();
    }
    expect(transport).not.toHaveBeenCalled();
    expect(() =>
      supabaseAuthConfiguration({ ...env, SUPABASE_PROJECT_REF: 'zzzzzzzzzzzzzzzzzzzz' }),
    ).toThrow(ServiceUnavailableException);
  });
  it('não aceita objeto de usuário local, token com URL, anonimato ou negativa do servidor', async () => {
    const transport = vi.fn<HttpTransport>().mockResolvedValue(response(providerUser(), false));
    const client = new SupabaseIdentityClient(transport, env);
    await expect(client.verify(token())).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(client.verify('https://attacker.example.test/token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(transport).toHaveBeenCalledTimes(1);
    transport.mockResolvedValue(response({ ...providerUser(), is_anonymous: true }));
    await expect(client.verify(token())).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('vínculo explícito e sessão Nest limitada à prova Supabase', () => {
  it('troca somente UID vinculado e conserva papel e troca obrigatória do banco', async () => {
    const { db, user } = fakeDb();
    const issue = vi.fn(async (_userId: string, _provider: string, _proof: unknown) => ({
      accessToken: 'nest',
      refreshToken: 'opaque',
      user,
    }));
    const identities = {
      verify: vi.fn(async () => ({
        id: externalId,
        sessionId: externalSessionId,
        email: 'different-email@example.test',
        emailConfirmed: true,
        expiresAt: new Date(Date.now() + 60000),
      })),
    };
    const service = new SupabaseAuthService(db, { issueForUser: issue } as any, identities as any);
    const result = await service.exchange(token());
    expect(db.user.findUnique).toHaveBeenCalledWith({ where: { supabaseUserId: externalId } });
    expect(issue.mock.calls[0]).toMatchObject([
      user.id,
      'supabase',
      { supabaseUserId: externalId, supabaseSessionId: externalSessionId },
    ]);
    expect(result.user.role).toBe('ESTABLISHMENT');
    expect(result.user.mustChangePassword).toBe(true);
  });
  it('não vincula automaticamente por e-mail, nem emite sessão para usuário inativo', async () => {
    const { db } = fakeDb();
    db.user.findUnique.mockResolvedValue(null);
    const issue = vi.fn();
    const identities = {
      verify: vi.fn(async () => ({
        id: externalId,
        sessionId: externalSessionId,
        email: 'staff@example.test',
        expiresAt: new Date(Date.now() + 60000),
      })),
    };
    const service = new SupabaseAuthService(db, { issueForUser: issue } as any, identities as any);
    await expect(service.exchange(token())).rejects.toBeInstanceOf(ForbiddenException);
    db.user.findUnique.mockResolvedValue({ active: false });
    await expect(service.exchange(token())).rejects.toBeInstanceOf(ForbiddenException);
    expect(issue).not.toHaveBeenCalled();
  });
  it('usa exp remoto no banco e assina JWT Nest sem ultrapassar esse prazo', async () => {
    const { db, user } = fakeDb();
    const signer = jwt();
    const service = new AuthService(db, signer);
    const expiresAt = new Date((Math.floor(Date.now() / 1000) + 60) * 1000);
    const result = await service.issueForUser(user.id, 'supabase', {
      supabaseUserId: externalId,
      supabaseSessionId: externalSessionId,
      expiresAt,
    });
    const claims = signer.decode(result.accessToken);
    expect(claims.exp * 1000).toBeLessThanOrEqual(expiresAt.getTime());
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(60);
    expect(db.session.create.mock.calls[0]![0].data).toMatchObject({
      authProvider: 'supabase',
      expiresAt,
    });
    expect(result.user.mustChangePassword).toBe(true);
  });
  it('recusa refresh Nest de sessão Supabase mesmo com hash válido; exige nova prova do provedor', async () => {
    const { db, user } = fakeDb();
    const refresh = 'session.valid-opaque-token';
    db.session.findUnique.mockResolvedValue({
      id: 'session',
      user,
      authProvider: 'supabase',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60000),
      refreshHash: createHash('sha256').update(refresh).digest('hex'),
    });
    await expect(new AuthService(db, jwt()).refresh(refresh)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(db.session.update).not.toHaveBeenCalled();
  });
  it('não cria sessão se vínculo mudou ou prova expirou antes da transação', async () => {
    const { db, user } = fakeDb();
    const service = new AuthService(db, jwt());
    await expect(
      service.issueForUser(user.id, 'supabase', {
        supabaseUserId: randomUUID(),
        supabaseSessionId: externalSessionId,
        expiresAt: new Date(Date.now() + 60000),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.issueForUser(user.id, 'supabase', {
        supabaseUserId: externalId,
        supabaseSessionId: externalSessionId,
        expiresAt: new Date(Date.now() - 1),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.session.create).not.toHaveBeenCalled();
  });
  it('vínculo administrativo revoga sessões, audita e não remove troca inicial', async () => {
    const { db, user } = fakeDb({ supabaseUserId: null });
    const service = new SupabaseAuthService(db, {} as any, { assertConfigured() {} } as any);
    const admin = { ...actor(user), id: randomUUID(), role: 'SUPER_ADMIN' } as Actor;
    const result = await service.bind(admin, user.id, {
      supabaseUserId: externalId,
      reason: 'Vinculação explícita conferida no painel',
      confirm: true,
    });
    expect(db.user.update.mock.calls[0]![0].data).toEqual({ supabaseUserId: externalId });
    expect(db.session.updateMany).toHaveBeenCalledWith({
      where: { userId: user.id },
      data: { revokedAt: expect.any(Date) },
    });
    expect(db.auditLog.create.mock.calls[0]![0].data.action).toBe('SUPABASE_IDENTITY_BOUND');
    expect(result.mustChangePassword).toBe(true);
  });
  it('outro perfil não vincula usuários e Super Admin precisa comprovar a própria identidade', async () => {
    const { db, user } = fakeDb({ role: 'SUPER_ADMIN' });
    const service = new SupabaseAuthService(db, {} as any, { assertConfigured() {} } as any);
    const input = {
      supabaseUserId: externalId,
      reason: 'Vinculação explícita conferida no painel',
      confirm: true as const,
    };
    await expect(
      service.bind({ ...actor(user), role: 'ADMIN' }, user.id, input),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.bind(actor(user), user.id, input)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.user.update).not.toHaveBeenCalled();
  });
});

describe('troca obrigatória de senha Supabase reautentica e só então atualiza flag local', () => {
  it('reautentica por senha, exige UID igual e atualiza senha com token renovado', async () => {
    const transport = vi
      .fn<HttpTransport>()
      .mockResolvedValueOnce(response({ access_token: token(), user: providerUser() }))
      .mockResolvedValueOnce(response(providerUser()));
    await new SupabaseIdentityClient(transport, env).changePassword({
      expectedUserId: externalId,
      email: 'staff@example.test',
      currentPassword: 'CurrentSyntheticPassword1',
      newPassword: 'NewSyntheticPassword2',
    });
    expect(transport.mock.calls[0]![0]).toBe(
      env.SUPABASE_URL + '/auth/v1/token?grant_type=password',
    );
    expect(transport.mock.calls[0]![1].method).toBe('POST');
    expect(transport.mock.calls[1]![0]).toBe(env.SUPABASE_URL + '/auth/v1/user');
    expect(transport.mock.calls[1]![1].method).toBe('PUT');
    expect(JSON.parse(transport.mock.calls[1]![1].body!)).toEqual({
      password: 'NewSyntheticPassword2',
    });
  });
  it('UID divergente no reauth não envia PUT de senha', async () => {
    const transport = vi
      .fn<HttpTransport>()
      .mockResolvedValue(response({ access_token: token(), user: providerUser(randomUUID()) }));
    await expect(
      new SupabaseIdentityClient(transport, env).changePassword({
        expectedUserId: externalId,
        email: 'staff@example.test',
        currentPassword: 'current',
        newPassword: 'new',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it('erro de reauth, nonce ou update deixa flag e hash locais intactos', async () => {
    for (const failedCall of [0, 1]) {
      const { db, user } = fakeDb();
      const transport = vi
        .fn<HttpTransport>()
        .mockResolvedValueOnce(
          failedCall === 0
            ? response({}, false)
            : response({ access_token: token(), user: providerUser() }),
        )
        .mockResolvedValueOnce(response({ error: 'reauthentication_nonce_required' }, false));
      const service = new AuthService(db, jwt(), new SupabaseIdentityClient(transport, env));
      await expect(
        service.changePassword(actor(user), 'CurrentSyntheticPassword1', 'NewSyntheticPassword2'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(db.user.update).not.toHaveBeenCalled();
      expect(db.session.updateMany).not.toHaveBeenCalled();
      expect(db.auditLog.create).not.toHaveBeenCalled();
    }
  });
  it('sucesso confirmado limpa flag sem reescrever Argon e revoga somente outras sessões Nest', async () => {
    const { db, user } = fakeDb();
    const changePassword = vi
      .fn<SupabaseIdentityClient['changePassword']>()
      .mockResolvedValue(undefined);
    const service = new AuthService(db, jwt(), { changePassword } as any);
    const sessionActor = actor(user);
    await service.changePassword(
      sessionActor,
      'CurrentSyntheticPassword1',
      'NewSyntheticPassword2',
    );
    expect(changePassword.mock.calls[0]![0]).toMatchObject({
      expectedUserId: externalId,
      email: user.email,
    });
    expect(db.user.update.mock.calls[0]![0].data).toEqual({ mustChangePassword: false });
    expect(db.session.updateMany.mock.calls[0]![0].where).toEqual({
      userId: user.id,
      id: { not: sessionActor.sessionId },
    });
    expect(db.auditLog.create.mock.calls[0]![0].data.action).toBe('SUPABASE_PASSWORD_CHANGED');
  });
  it('mudança de vínculo durante operação externa impede limpar flag da nova identidade', async () => {
    const { db, user } = fakeDb();
    db.user.findUniqueOrThrow
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce({ ...user, supabaseUserId: randomUUID() });
    const service = new AuthService(db, jwt(), { changePassword: async () => {} } as any);
    await expect(
      service.changePassword(actor(user), 'CurrentSyntheticPassword1', 'NewSyntheticPassword2'),
    ).rejects.toThrow('Vínculo de identidade mudou');
    expect(db.user.update).not.toHaveBeenCalled();
  });
  it('não admite login com hash Argon antigo de conta vinculada e mantém logout-all próprio', async () => {
    const password = 'OldLocalSyntheticPassword1';
    const passwordHash = await argon2.hash(password, { memoryCost: 8192, timeCost: 1 });
    const { db, user } = fakeDb({ passwordHash, mustChangePassword: false });
    const service = new AuthService(db, jwt());
    await expect(service.login(user.email, password)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.session.create).not.toHaveBeenCalled();
    await service.logoutAll(actor(user));
    expect(db.session.updateMany.mock.calls[0]![0].where).toEqual({ userId: user.id });
  });
});

describe('regressões da transição de identidade', () => {
  it('renova a mesma família sem criar sessões independentes; logout invalida todos os seus JWTs', async () => {
    const { db, user, sessions } = statefulSessions();
    const signer = jwt();
    const service = new AuthService(db, signer);
    const proof = {
      supabaseUserId: externalId,
      supabaseSessionId: externalSessionId,
      expiresAt: new Date(Date.now() + 60000),
    };
    const first = await service.issueForUser(user.id, 'supabase', proof);
    const renewed = await service.issueForUser(user.id, 'supabase', {
      ...proof,
      expiresAt: new Date(Date.now() + 120000),
    });
    expect(signer.decode(first.accessToken).sid).toBe(signer.decode(renewed.accessToken).sid);
    expect(sessions.size).toBe(1);
    const otherDevice = await service.issueForUser(user.id, 'supabase', {
      ...proof,
      supabaseSessionId: randomUUID(),
    });
    await expect(service.verifyAccess(first.accessToken)).resolves.toMatchObject({ id: user.id });
    await service.logout(await service.verifyAccess(renewed.accessToken));
    for (const access of [first.accessToken, renewed.accessToken])
      await expect(service.verifyAccess(access)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.verifyAccess(otherDevice.accessToken)).resolves.toMatchObject({
      id: user.id,
    });
    // Provider JWTs can survive external sign-out until exp. The Nest tombstone
    // prevents replay of that already-logged-out family from reopening access.
    await expect(service.issueForUser(user.id, 'supabase', proof)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    const newLogin = await service.issueForUser(user.id, 'supabase', {
      ...proof,
      supabaseSessionId: randomUUID(),
    });
    await expect(service.verifyAccess(newLogin.accessToken)).resolves.toMatchObject({
      id: user.id,
    });
    expect(sessions.size).toBe(3);
  });
  it('uma prova antiga não encurta a família nem emite JWT além da própria expiração', async () => {
    const { db, user, sessions } = statefulSessions();
    const signer = jwt();
    const service = new AuthService(db, signer);
    const renewedExpiry = new Date((Math.floor(Date.now() / 1000) + 120) * 1000);
    const staleExpiry = new Date(renewedExpiry.getTime() - 60000);
    const proof = {
      supabaseUserId: externalId,
      supabaseSessionId: externalSessionId,
      expiresAt: renewedExpiry,
    };
    await service.issueForUser(user.id, 'supabase', proof);
    const stale = await service.issueForUser(user.id, 'supabase', {
      ...proof,
      expiresAt: staleExpiry,
    });
    expect(sessions.size).toBe(1);
    expect([...sessions.values()][0].expiresAt).toEqual(renewedExpiry);
    expect(signer.decode(stale.accessToken).exp * 1000).toBeLessThanOrEqual(staleExpiry.getTime());
  });
  it('logout-all conserva tombstones de todas as famílias conhecidas', async () => {
    const { db, user } = statefulSessions();
    const service = new AuthService(db, jwt());
    const families = [externalSessionId, randomUUID()];
    const issued = [];
    for (const supabaseSessionId of families)
      issued.push(
        await service.issueForUser(user.id, 'supabase', {
          supabaseUserId: externalId,
          supabaseSessionId,
          expiresAt: new Date(Date.now() + 60000),
        }),
      );
    await service.logoutAll(await service.verifyAccess(issued[0]!.accessToken));
    for (const [index, current] of issued.entries()) {
      await expect(service.verifyAccess(current.accessToken)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      await expect(
        service.issueForUser(user.id, 'supabase', {
          supabaseUserId: externalId,
          supabaseSessionId: families[index]!,
          expiresAt: new Date(Date.now() + 60000),
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });
  it('um reset entre a verificação Argon e a emissão bloqueia a senha antiga', async () => {
    const password = 'OldBeforeConcurrentReset1';
    const passwordHash = await argon2.hash(password, { memoryCost: 8192, timeCost: 1 });
    const { db, user } = fakeDb({ passwordHash, supabaseUserId: null });
    db.user.findUnique
      .mockResolvedValueOnce(user)
      .mockResolvedValueOnce({ ...user, passwordHash: 'new-hash-after-reset' });
    await expect(new AuthService(db, jwt()).login(user.email, password)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(db.session.create).not.toHaveBeenCalled();
  });
  it('sessões locais continuam separadas por dispositivo e logout não agrupa valores nulos', async () => {
    const password = 'LegacyMultipleDevicePassword1';
    const passwordHash = await argon2.hash(password, { memoryCost: 8192, timeCost: 1 });
    const { db, user, sessions } = statefulSessions({ passwordHash, supabaseUserId: null });
    const service = new AuthService(db, jwt());
    const first = await service.login(user.email, password);
    const second = await service.login(user.email, password);
    expect(sessions.size).toBe(2);
    expect([...sessions.values()].every((value) => value.supabaseSessionId === null)).toBe(true);
    await service.logout(await service.verifyAccess(first.accessToken));
    await expect(service.verifyAccess(first.accessToken)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(service.verifyAccess(second.accessToken)).resolves.toMatchObject({ id: user.id });
  });
  it('derive provider e papel da sessão/banco, nunca de claims enviados pelo cliente', async () => {
    const { db, user } = fakeDb();
    const signer = jwt();
    const id = randomUUID();
    db.session.findUnique.mockResolvedValue({
      id,
      userId: user.id,
      user,
      authProvider: 'supabase',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60000),
    });
    const access = await signer.signAsync(
      { sub: user.id, sid: id, role: 'SUPER_ADMIN', authProvider: 'local' },
      { issuer: 'ligeirinho-api', audience: 'ligeirinho', expiresIn: 60 },
    );
    const result = await new AuthService(db, signer).verifyAccess(access);
    expect(result.role).toBe('ESTABLISHMENT');
    expect(result.authProvider).toBe('supabase');
  });
  it('login Argon continua funcionando para conta legada não vinculada', async () => {
    const password = 'UnboundLocalSyntheticPassword1';
    const passwordHash = await argon2.hash(password, { memoryCost: 8192, timeCost: 1 });
    const { db, user } = fakeDb({ passwordHash, supabaseUserId: null });
    const result = await new AuthService(db, jwt()).login(user.email, password);
    expect(result.accessToken).toBeTruthy();
    expect(result.user.mustChangePassword).toBe(true);
    expect(db.session.create.mock.calls[0]![0].data.authProvider).toBe('local');
  });
  it('vínculo administrativo falha antes de escrever quando provedor não está configurado', async () => {
    const { db, user } = fakeDb({ supabaseUserId: null });
    const service = new SupabaseAuthService(
      db,
      {} as any,
      {
        assertConfigured() {
          throw new ServiceUnavailableException();
        },
      } as any,
    );
    await expect(
      service.bind({ ...actor(user), role: 'SUPER_ADMIN' }, user.id, {
        supabaseUserId: externalId,
        reason: 'Vínculo conferido com o responsável',
        confirm: true,
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.session.updateMany).not.toHaveBeenCalled();
  });
  it('reset administrativo Argon não afirma alterar senha de conta Supabase', async () => {
    const { db, user } = fakeDb();
    await expect(
      new AdminService(db).resetPassword({ ...actor(user), role: 'SUPER_ADMIN' }, user.id, {
        password: 'TemporarySyntheticPassword1',
        reason: 'Solicitação administrativa com motivo',
        confirm: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.session.updateMany).not.toHaveBeenCalled();
  });
});
