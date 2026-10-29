import type { ConfigContext, ExpoConfig } from 'expo/config';

type ReleaseEnvironment = Record<string, string | undefined>;
const configurationError =
  'Defina EXPO_PUBLIC_API_URL com uma origem HTTPS pública real e o caminho /api/v1 antes de gerar um APK independente.';

export function validateReleaseApiUrl(input: string | undefined): string {
  try {
    if (
      !input ||
      /[\s\\?#]/u.test(input) ||
      Array.from(input).some(
        (character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127,
      )
    )
      throw new Error();
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    const labels = host.split('.');
    const reserved = [
      'localhost',
      'local',
      'internal',
      'test',
      'example',
      'invalid',
      'lan',
      'home',
      'home.arpa',
      'onion',
      'example.com',
      'example.net',
      'example.org',
    ];
    if (
      url.protocol !== 'https:' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/api\/v1\/?$/.test(url.pathname) ||
      host.length > 253 ||
      labels.length < 2 ||
      !labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      /^\d+(?:\.\d+){3}$/.test(host) ||
      reserved.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
    )
      throw new Error();
    return `${url.origin}/api/v1`;
  } catch {
    throw new Error(configurationError);
  }
}

export function configureAndroidRelease(
  config: ConfigContext['config'],
  environment: ReleaseEnvironment,
): ExpoConfig {
  const release =
    ['production', 'preview'].includes(environment.EAS_BUILD_PROFILE || '') ||
    environment.LIGEIRINHO_RELEASE === '1';
  const rawVersion = environment.LIGEIRINHO_ANDROID_VERSION_CODE;
  if (release) validateReleaseApiUrl(environment.EXPO_PUBLIC_API_URL);
  if (release && !rawVersion)
    throw new Error('Defina LIGEIRINHO_ANDROID_VERSION_CODE para este APK independente.');
  let versionCode: number | undefined;
  if (rawVersion !== undefined) {
    if (!/^[1-9]\d*$/.test(rawVersion) || Number(rawVersion) > 2_100_000_000)
      throw new Error('LIGEIRINHO_ANDROID_VERSION_CODE deve ser um inteiro de 1 a 2100000000.');
    versionCode = Number(rawVersion);
  }
  return {
    ...config,
    name: config.name ?? 'Ligeirinho',
    slug: config.slug ?? 'ligeirinho',
    ...(versionCode === undefined ? {} : { android: { ...config.android, versionCode } }),
    ...(release ? { extra: { ...config.extra, integrationMode: 'production' } } : {}),
  };
}

export default function appConfig({ config }: ConfigContext): ExpoConfig {
  return configureAndroidRelease(config, process.env);
}
