import { describe, expect, it } from 'vitest';
import { configureAndroidRelease, validateReleaseApiUrl } from '../app.config';

const destination = 'https://api.ligeirinho.com.br/api/v1';
const base = {
  name: 'Ligeirinho Estabelecimento',
  slug: 'ligeirinho-estabelecimento',
  android: { package: 'br.com.ligeirinho.estabelecimento', versionCode: 1 },
  extra: { existing: true, integrationMode: 'development' },
};

describe('destino e versão do APK independente', () => {
  it('aceita somente a API HTTPS pública e normaliza a barra final', () => {
    expect(validateReleaseApiUrl(destination)).toBe(destination);
    expect(validateReleaseApiUrl(destination + '/')).toBe(destination);
    expect(validateReleaseApiUrl('https://api.ligeirinho.com.br:443/api/v1')).toBe(destination);
  });
  it.each([
    undefined,
    '',
    ' ' + destination,
    'http://api.ligeirinho.com.br/api/v1',
    'https://api.ligeirinho.com.br',
    destination + '/other',
    destination + '?key=test',
    destination + '#fragment',
    destination + '?',
    destination + '#',
    'https://api.ligeirinho.com.br\\api/v1',
    'https://api.li\ngeirinho.com.br/api/v1',
    'https://api.li\tgeirinho.com.br/api/v1',
    'https://api.ligeirinho.com.br/api/v1\u0000',
    'https://api.ligeirinho.com.br/api/v1\u007f',
    'https://user:secret@api.ligeirinho.com.br/api/v1',
    'https://api.ligeirinho.com.br:444/api/v1',
    'https://localhost/api/v1',
    'https://127.0.0.1/api/v1',
    'https://10.0.0.1/api/v1',
    'https://[::1]/api/v1',
    'https://api.local/api/v1',
    'https://api.internal/api/v1',
    'https://api.example.test/api/v1',
    'https://api.example.com/api/v1',
    'https://api.invalid/api/v1',
    'https://api.home.arpa/api/v1',
  ])('recusa destino incompleto, privado ou reservado: %s', (value) => {
    expect(() => validateReleaseApiUrl(value)).toThrow(/EXPO_PUBLIC_API_URL/);
  });
  it.each(['preview', 'production'])('EAS %s também exige API pública', (profile) => {
    expect(() => configureAndroidRelease(base, { EAS_BUILD_PROFILE: profile })).toThrow(
      /EXPO_PUBLIC_API_URL/,
    );
  });
  it.each(['preview', 'production'])('EAS %s exige e aplica um código explícito', (profile) => {
    const environment = { EAS_BUILD_PROFILE: profile, EXPO_PUBLIC_API_URL: destination };
    expect(() => configureAndroidRelease(base, environment)).toThrow(/VERSION_CODE/);
    expect(
      configureAndroidRelease(base, {
        ...environment,
        LIGEIRINHO_ANDROID_VERSION_CODE: '42',
      }),
    ).toMatchObject({ android: { versionCode: 42 }, extra: { integrationMode: 'production' } });
  });
  it('release usa versão explícita e preserva identidade, pacote e extras do aplicativo', () => {
    const result = configureAndroidRelease(base, {
      LIGEIRINHO_RELEASE: '1',
      EXPO_PUBLIC_API_URL: destination,
      LIGEIRINHO_ANDROID_VERSION_CODE: '42',
    });
    expect(result).toMatchObject({
      name: base.name,
      slug: base.slug,
      android: { package: base.android.package, versionCode: 42 },
      extra: { existing: true, integrationMode: 'production' },
    });
    expect(base.android.versionCode).toBe(1);
    expect(base.extra.integrationMode).toBe('development');
  });
  it('release direto exige um código de versão explícito', () => {
    expect(() =>
      configureAndroidRelease(base, {
        LIGEIRINHO_RELEASE: '1',
        EXPO_PUBLIC_API_URL: destination,
      }),
    ).toThrow(/VERSION_CODE/);
  });
  it.each(['', '0', '-1', '1.2', '1e3', '01', ' 2', '2100000001', 'Infinity'])(
    'recusa código de versão inválido: %s',
    (version) => {
      expect(() =>
        configureAndroidRelease(base, {
          LIGEIRINHO_RELEASE: '1',
          EXPO_PUBLIC_API_URL: destination,
          LIGEIRINHO_ANDROID_VERSION_CODE: version,
        }),
      ).toThrow(/VERSION_CODE/);
    },
  );
  it('desenvolvimento mantém configuração local sem exigir API ou assinatura', () => {
    expect(configureAndroidRelease(base, {})).toEqual(base);
    expect(configureAndroidRelease({}, {})).toMatchObject({
      name: 'Ligeirinho',
      slug: 'ligeirinho',
    });
  });
});
