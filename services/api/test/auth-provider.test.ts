import 'reflect-metadata';
import { Module, ServiceUnavailableException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { AuthController } from '../src/auth/auth.controller';
import { AuthService } from '../src/auth/auth.service';
import {
  publicAuthProviderConfiguration,
  SupabaseIdentityClient,
} from '../src/auth/supabase.client';

const reference = 'abcdefghijklmnopqrst';
const publicKey = 'sb_publishable_synthetic_discovery_test';
const fixture = (): NodeJS.ProcessEnv => ({
  AUTH_PROVIDER: 'supabase',
  SUPABASE_URL: `https://${reference}.supabase.co`,
  SUPABASE_PUBLISHABLE_KEY: publicKey,
});
const jwt = (role: string) =>
  `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.synthetic`;
function failsClosed(env: NodeJS.ProcessEnv) {
  try {
    publicAuthProviderConfiguration(env);
    throw new Error('Configuration should have failed');
  } catch (error) {
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    const failure = error as ServiceUnavailableException;
    expect(failure.getStatus()).toBe(503);
    expect(failure.getResponse()).toEqual({
      configured: false,
      message: 'A autenticação não está configurada corretamente. Consulte a administração.',
    });
  }
}

describe('Descoberta pública do provedor de autenticação', () => {
  it('mantém legado por padrão e quando selecionado sem expor configuração privada', () => {
    for (const env of [{}, { AUTH_PROVIDER: 'legacy' }, { AUTH_PROVIDER: ' legacy ' }])
      expect(
        publicAuthProviderConfiguration({
          ...env,
          DATABASE_URL: 'postgresql://synthetic-private-credential',
          JWT_SECRET: 'synthetic-private-secret',
          SUPABASE_SERVICE_ROLE_KEY: 'synthetic-private-key',
        }),
      ).toEqual({ provider: 'legacy', configured: true });
  });
  it('retorna somente URL normalizada e chave publicável do projeto Supabase válido', () => {
    expect(
      publicAuthProviderConfiguration({
        ...fixture(),
        SUPABASE_URL: `https://${reference}.supabase.co/`,
        SUPABASE_AUTH_ENABLED: '1',
        SUPABASE_REQUIRE_EMAIL_CONFIRMED: '1',
        DATABASE_URL: 'postgresql://synthetic-private-credential',
        SUPABASE_SERVICE_ROLE_KEY: 'synthetic-administrative-key',
      }),
    ).toEqual({
      provider: 'supabase',
      configured: true,
      url: `https://${reference}.supabase.co`,
      publishableKey: publicKey,
    });
  });
  it('descoberta e configuração de troca aceitam a mesma seleção com espaços', () => {
    const env = { ...fixture(), AUTH_PROVIDER: ' supabase ' };
    expect(publicAuthProviderConfiguration(env).provider).toBe('supabase');
    expect(() => new SupabaseIdentityClient(undefined, env).assertConfigured()).not.toThrow();
    failsClosed({ ...env, SUPABASE_AUTH_ENABLED: 'true' });
    failsClosed({ ...env, NEXT_PUBLIC_AUTH_PROVIDER: 'legacy' });
  });
  it('aceita anon pública legada e domínio personalizado com referência explícita', () => {
    const key = jwt('anon');
    expect(
      new SupabaseIdentityClient(undefined, {
        AUTH_PROVIDER: 'supabase',
        SUPABASE_URL: 'https://auth.example.test',
        SUPABASE_PROJECT_REF: reference,
        SUPABASE_ANON_KEY: key,
      }).publicConfiguration(),
    ).toEqual({
      provider: 'supabase',
      configured: true,
      url: 'https://auth.example.test',
      publishableKey: key,
    });
  });
  it('recusa seleção inválida e flags contraditórias sem cair no legado', () => {
    for (const env of [
      { AUTH_PROVIDER: 'supabse' },
      { AUTH_PROVIDER: 'legacy', SUPABASE_AUTH_ENABLED: '1' },
      { AUTH_PROVIDER: undefined, SUPABASE_AUTH_ENABLED: '1' },
      { AUTH_PROVIDER: 'supabase', NEXT_PUBLIC_AUTH_PROVIDER: 'legacy' },
      { AUTH_PROVIDER: 'legacy', NEXT_PUBLIC_AUTH_PROVIDER: 'supabase' },
      { AUTH_PROVIDER: 'legacy', NEXT_PUBLIC_AUTH_PROVIDER: 'invalid' },
      { AUTH_PROVIDER: 'legacy', SUPABASE_AUTH_ENABLED: 'true' },
    ])
      failsClosed({ ...fixture(), ...env });
  });
  it('recusa URL ou chave ausente, endereço inseguro e referência divergente', () => {
    for (const env of [
      { SUPABASE_URL: '' },
      { SUPABASE_PUBLISHABLE_KEY: '' },
      { SUPABASE_URL: 'http://auth.example.test' },
      { SUPABASE_URL: 'https://localhost' },
      { SUPABASE_URL: 'https://user:synthetic-private@auth.example.test' },
      { SUPABASE_URL: 'https://auth.example.test' },
      { SUPABASE_PROJECT_REF: 'zzzzzzzzzzzzzzzzzzzz' },
    ])
      failsClosed({ ...fixture(), ...env });
  });
  it('recusa service-role/secret em qualquer alias público, inclusive o não preferido', () => {
    for (const value of ['sb_secret_synthetic_private', jwt('service_role'), 'malformed-key']) {
      failsClosed({ ...fixture(), SUPABASE_PUBLISHABLE_KEY: value });
      failsClosed({ ...fixture(), SUPABASE_ANON_KEY: value });
    }
  });
  it('expõe GET sem Bearer e no-store; configuração inválida responde503 sem valores', async () => {
    let env = fixture();
    @Module({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: { provider: () => publicAuthProviderConfiguration(env) },
        },
      ],
    })
    class TestModule {}
    const app = await NestFactory.create(TestModule, { logger: false });
    app.setGlobalPrefix('api/v1');
    await app.init();
    try {
      const good = await request(app.getHttpServer()).get('/api/v1/auth/provider');
      expect(good.status).toBe(200);
      expect(good.headers['cache-control']).toBe('no-store');
      expect(good.body).toEqual(publicAuthProviderConfiguration(env));
      env = { ...fixture(), SUPABASE_PUBLISHABLE_KEY: 'sb_secret_synthetic_private' };
      const failure = await request(app.getHttpServer()).get('/api/v1/auth/provider');
      expect(failure.status).toBe(503);
      expect(failure.headers['cache-control']).toBe('no-store');
      expect(failure.body.configured).toBe(false);
      expect(JSON.stringify(failure.body)).not.toContain('synthetic_private');
      expect(failure.body).not.toHaveProperty('url');
      expect(failure.body).not.toHaveProperty('publishableKey');
    } finally {
      await app.close();
    }
  });
});
