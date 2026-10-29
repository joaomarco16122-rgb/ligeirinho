import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { describe, it, expect, vi } from 'vitest';
import { configureProxyTrust, trafficKey, trafficLimit } from '../src/common/traffic';
@Module({})
class TestModule {}
async function withApp(
  flag: string | undefined,
  run: (app: NestExpressApplication) => Promise<void>,
  address?: string,
) {
  const app = await NestFactory.create<NestExpressApplication>(TestModule, { logger: false });
  configureProxyTrust(app, flag, address);
  app
    .getHttpAdapter()
    .getInstance()
    .get('/identity', (req: any, res: any) =>
      res.json({ ip: req.ip, key: trafficKey(req, 60000) }),
    );
  await app.init();
  try {
    await run(app);
  } finally {
    await app.close();
  }
}
describe('IP real e limites atrás do proxy local', () => {
  it('ignora X-Forwarded-For vindo de cliente direto por padrão', async () => {
    await withApp(undefined, async (app) => {
      const result = await request(app.getHttpServer())
        .get('/identity')
        .set('X-Forwarded-For', '203.0.113.42');
      expect(result.status).toBe(200);
      expect(result.body.ip).not.toBe('203.0.113.42');
      expect(result.body.key).toContain(result.body.ip);
      expect(result.body.key).not.toContain('203.0.113.42');
    });
  });
  it('separa clientes encaminhados pelo proxy loopback com opt-in explícito', async () => {
    await withApp('1', async (app) => {
      const first = await request(app.getHttpServer())
        .get('/identity')
        .set('X-Forwarded-For', '203.0.113.42');
      const second = await request(app.getHttpServer())
        .get('/identity')
        .set('X-Forwarded-For', '203.0.113.43');
      expect(first.body.ip).toBe('203.0.113.42');
      expect(second.body.ip).toBe('203.0.113.43');
      expect(first.body.key).not.toBe(second.body.key);
    });
  });
  it('não confia em saltos externos e ignora endereço injetado antes deles', async () => {
    await withApp('1', async (app) => {
      const result = await request(app.getHttpServer())
        .get('/identity')
        .set('X-Forwarded-For', '203.0.113.99, 198.51.100.30');
      expect(result.body.ip).toBe('198.51.100.30');
      expect(result.body.key).not.toContain('203.0.113.99');
    });
  });
  it('valor diferente de 1 não habilita confiança no proxy', async () => {
    await withApp('true', async (app) => {
      const result = await request(app.getHttpServer())
        .get('/identity')
        .set('X-Forwarded-For', '203.0.113.42');
      expect(result.body.ip).not.toBe('203.0.113.42');
    });
  });
});

describe('proxy por endereço explícito de bridge', () => {
  function capture(flag: string | undefined, address: string) {
    const set = vi.fn();
    configureProxyTrust({ set } as unknown as Pick<NestExpressApplication, 'set'>, flag, address);
    expect(set.mock.calls[0]![0]).toBe('trust proxy');
    return set.mock.calls[0]![1] as (remoteAddress: string) => boolean;
  }
  it('confia somente no IP exato e normaliza IPv4 mapeado em IPv6', () => {
    const trust = capture('0', '172.30.237.1');
    expect(trust('172.30.237.1')).toBe(true);
    expect(trust('::ffff:172.30.237.1')).toBe(true);
    expect(trust('::ffff:ac1e:ed01')).toBe(true);
    expect(trust('172.30.237.2')).toBe(false);
    expect(trust('203.0.113.42')).toBe(false);
    expect(trust('172.30.237.1.example.test')).toBe(false);
  });
  it('endereço explícito não herda confiança loopback e aceita IPv6 equivalente', () => {
    const trust = capture('1', '172.30.237.1');
    expect(trust('127.0.0.1')).toBe(false);
    expect(trust('::1')).toBe(false);
    const trustV6 = capture('0', '2001:db8:0:0:0:0:0:1');
    expect(trustV6('2001:db8::1')).toBe(true);
    expect(trustV6('2001:db8::2')).toBe(false);
  });
  it('CIDR, hostname e endereço inválido interrompem configuração sem habilitar confiança', () => {
    for (const value of [
      '172.30.237.0/24',
      'true',
      '*',
      'proxy.example.test',
      '172.30.237.999',
      ' 172.30.237.1',
    ]) {
      const set = vi.fn();
      expect(() =>
        configureProxyTrust({ set } as unknown as Pick<NestExpressApplication, 'set'>, '1', value),
      ).toThrow('TRUST_PROXY_ADDRESS');
      expect(set).not.toHaveBeenCalled();
    }
  });
  it('conexão de IP não confiável não pode forjar XFF mesmo com proxy explícito configurado', async () => {
    await withApp(
      '0',
      async (app) => {
        const result = await request(app.getHttpServer())
          .get('/identity')
          .set('X-Forwarded-For', '203.0.113.42');
        expect(result.body.ip).not.toBe('203.0.113.42');
        expect(result.body.key).not.toContain('203.0.113.42');
      },
      '172.30.237.1',
    );
  });
});

describe('limites das rotas de autenticação', () => {
  it('troca Supabase, refresh e senha usam o mesmo grupo restrito que login', () => {
    for (const path of [
      '/api/v1/auth/login',
      '/api/v1/auth/supabase',
      '/api/v1/auth/refresh',
      '/api/v1/auth/change-password',
    ]) {
      expect(trafficLimit({ path })).toBe(10);
      expect(trafficKey({ path, ip: '203.0.113.42', socket: {} }, 60000)).toBe(
        'limit:203.0.113.42:login:1',
      );
    }
    expect(trafficLimit({ path: '/api/v1/deliveries' })).toBe(240);
    expect(trafficLimit({ path: '/api/v1/auth/supabase-unrelated' })).toBe(240);
  });
});
