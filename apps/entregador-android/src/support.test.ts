import { describe, expect, it } from 'vitest';
import { supportReport } from './support';

describe('diagnóstico compartilhável de suporte', () => {
  it('remove credenciais, query, caminho e fragmento da URL pública', () => {
    const report = supportReport({
      audience: 'courier',
      version: '0.1.0',
      apiUrl: 'https://usuario:senha@example.com/api/v1?token=segredo#chave',
      lastSyncAt: Date.parse('2026-10-29T02:00:00Z'),
      status: 'BUSY',
      now: Date.parse('2026-10-29T03:00:00Z'),
    });
    expect(report).toContain('Servidor: https://example.com');
    for (const value of ['usuario', 'senha', 'token', 'segredo', '/api/v1', 'chave'])
      expect(report).not.toContain(value);
    expect(report).toContain('2026-10-29T02:00:00.000Z');
    expect(report).toContain('2026-10-29T03:00:00.000Z');
  });
  it('continua utilizável sem primeira sincronização e com configuração inválida', () => {
    const report = supportReport({
      audience: 'establishment',
      version: '0.1.0',
      apiUrl: 'endereço inválido',
      lastSyncAt: null,
      now: 0,
    });
    expect(report).toContain('Estabelecimento Android');
    expect(report).toContain('Ainda não confirmada');
    expect(report).toContain('Servidor: Endereço indisponível');
  });
  it('não reproduz informações arbitrárias em campos de estado ou versão', () => {
    const report = supportReport({
      audience: 'courier',
      version: 'minha senha é confidencial',
      apiUrl: 'file:///etc/passwd',
      lastSyncAt: NaN,
      status: 'BUSY\nAuthorization: segredo',
      now: 0,
    });
    expect(report).not.toContain('segredo');
    expect(report).not.toContain('confidencial');
    expect(report).not.toContain('/etc/passwd');
    expect(report).toContain('Data indisponível');
  });
});
