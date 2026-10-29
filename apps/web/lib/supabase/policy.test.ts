import { describe, expect, it } from 'vitest';
import {
  canAccess,
  isSameOrigin,
  roleDestination,
  roleFromMetadata,
  safeReturnPath,
} from './policy';

describe('Política Supabase sem confiar em metadados editáveis pelo usuário', () => {
  it('aceita somente papéis previstos de app_metadata', () => {
    expect(roleFromMetadata({ app_metadata: { role: 'SUPER_ADMIN' } })).toBe('SUPER_ADMIN');
    expect(roleFromMetadata({ app_metadata: { role: 'ESTABLISHMENT' } })).toBe('ESTABLISHMENT');
    expect(roleFromMetadata({ app_metadata: { role: 'owner' } })).toBeNull();
    expect(roleFromMetadata({ app_metadata: {} })).toBeNull();
    expect(roleFromMetadata({ app_metadata: Object.create({ role: 'SUPER_ADMIN' }) })).toBeNull();
  });
  it('não autoriza um estabelecimento no painel administrativo', () => {
    expect(canAccess('ESTABLISHMENT', '/admin')).toBe(false);
    expect(canAccess('ESTABLISHMENT', '/admin/configuracoes')).toBe(false);
    expect(canAccess('ADMIN', '/admin/configuracoes')).toBe(true);
    expect(canAccess('ADMIN', '/portal')).toBe(false);
    expect(canAccess(null, '/portal')).toBe(false);
    expect(canAccess('COURIER', '/portal')).toBe(false);
    expect(roleDestination('COURIER')).toBe('/downloads');
    expect(canAccess(null, '/administrator')).toBe(true);
  });
  it.each([
    'https://evil.example/',
    '//evil.example/',
    '\\\\evil.example/',
    '/\\evil.example/',
    '/%2f%2fevil.example/',
    '/%252f%252fevil.example/',
    '/portal%0d%0aLocation:https://evil.example',
    '/auth/callback?code=anything',
    '/login',
    '/%61uth/session',
  ])('rejeita retorno inseguro ou loop: %s', (input) => {
    expect(safeReturnPath(input, '/admin')).toBe('/admin');
  });
  it('preserva retorno relativo permitido no mesmo domínio', () => {
    expect(safeReturnPath('/portal?filtro=abertos#lista')).toBe('/portal?filtro=abertos#lista');
    expect(safeReturnPath('/admin/tarifas')).toBe('/admin/tarifas');
    expect(safeReturnPath(null, '/downloads')).toBe('/downloads');
  });
  it('mutações exigem Origin presente e correspondente', () => {
    const request = (origin: string | null) => ({
      url: 'https://ligeirinho.example/auth/logout',
      headers: { get: (name: string) => (name.toLowerCase() === 'origin' ? origin : null) },
    });
    expect(isSameOrigin(request('https://ligeirinho.example'))).toBe(true);
    expect(isSameOrigin(request('https://outro.example'))).toBe(false);
    expect(isSameOrigin(request(null))).toBe(false);
    expect(isSameOrigin(request('null'))).toBe(false);
    expect(isSameOrigin(request('https://ligeirinho.example/evil'))).toBe(false);
  });
  it('usa Host real quando Next canonicaliza o endereço 127.0.0.1 para localhost', () => {
    const request = {
      url: 'http://localhost:34567/auth/logout',
      headers: new Headers({
        host: '127.0.0.1:34567',
        origin: 'http://127.0.0.1:34567',
        'x-forwarded-proto': 'http',
      }),
    };
    expect(isSameOrigin(request)).toBe(true);
    request.headers.set('origin', 'http://127.0.0.1:34568');
    expect(isSameOrigin(request)).toBe(false);
  });
  it('aceita HTTPS externo no proxy que preserva Host e sobrescreve o protocolo', () => {
    const request = {
      url: 'http://localhost:3000/auth/logout',
      headers: new Headers({
        host: 'ligeirinho.example',
        origin: 'https://ligeirinho.example',
        'x-forwarded-proto': 'https',
      }),
    };
    expect(isSameOrigin(request)).toBe(true);
    request.headers.set('origin', 'https://foreign.example');
    expect(isSameOrigin(request)).toBe(false);
  });
  it('não confia em X-Forwarded-Host para autorizar uma origem estrangeira', () => {
    expect(
      isSameOrigin({
        url: 'http://localhost:3000/auth/logout',
        headers: new Headers({
          host: 'ligeirinho.example',
          origin: 'https://foreign.example',
          'x-forwarded-host': 'foreign.example',
          'x-forwarded-proto': 'https',
        }),
      }),
    ).toBe(false);
  });
  it.each(['https,http', 'https, https', 'ftp', 'HTTPS', ''])(
    'rejeita protocolo encaminhado ambíguo ou inválido: %s',
    (forwarded) => {
      expect(
        isSameOrigin({
          url: 'http://localhost:3000/auth/logout',
          headers: new Headers({
            host: 'ligeirinho.example',
            origin: 'https://ligeirinho.example',
            'x-forwarded-proto': forwarded,
          }),
        }),
      ).toBe(false);
    },
  );
  it.each([
    'ligeirinho.example,foreign.example',
    'ligeirinho.example/path',
    'user@ligeirinho.example',
    'ligeirinho.example#fragment',
    'https://ligeirinho.example',
  ])('rejeita Host sem autoridade única: %s', (host) => {
    expect(
      isSameOrigin({
        url: 'https://ligeirinho.example/auth/logout',
        headers: new Headers({ host, origin: 'https://ligeirinho.example' }),
      }),
    ).toBe(false);
  });
  it('não aceita mudança de protocolo sem o encaminhamento explícito suportado', () => {
    expect(
      isSameOrigin({
        url: 'https://ligeirinho.example/auth/logout',
        headers: new Headers({ host: 'ligeirinho.example', origin: 'http://ligeirinho.example' }),
      }),
    ).toBe(false);
  });
});
