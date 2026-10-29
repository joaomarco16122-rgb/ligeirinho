#!/usr/bin/env python3
"""Build a signed, standalone Android APK against a verified public API.

Signing passwords are read from the environment, never command arguments or
generated source. This command does not provision hosting, Auth, or signing keys.
"""
import argparse
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import runpy
import shutil
import stat
import subprocess
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SIGNING_NAMES = (
    'ANDROID_RELEASE_KEYSTORE',
    'ANDROID_RELEASE_STORE_PASSWORD',
    'ANDROID_RELEASE_KEY_ALIAS',
    'ANDROID_RELEASE_KEY_PASSWORD',
)
SIGNING_OVERRIDE = '''
// Ligeirinho: generated release-only signing; credentials stay in the process.
android.signingConfigs {
    ligeirinhoRelease {
        storeFile file(System.getenv("ANDROID_RELEASE_KEYSTORE"))
        storePassword System.getenv("ANDROID_RELEASE_STORE_PASSWORD")
        keyAlias System.getenv("ANDROID_RELEASE_KEY_ALIAS")
        keyPassword System.getenv("ANDROID_RELEASE_KEY_PASSWORD")
    }
}
android.buildTypes.release.signingConfig = android.signingConfigs.ligeirinhoRelease
'''


def validate_api_url(value):
    """Reject local/reserved/credential-bearing URLs without contacting DNS."""
    error = 'Defina uma API HTTPS pública real com caminho /api/v1.'
    if (not value or value != value.strip() or any(ord(c) <= 32 or ord(c) == 127 for c in value)
            or '?' in value or '#' in value):
        raise RuntimeError(error)
    try:
        parsed = urllib.parse.urlsplit(value)
        host = (parsed.hostname or '').lower()
        port = parsed.port
    except ValueError:
        raise RuntimeError(error) from None
    labels = host.split('.')
    reserved = ('localhost', 'local', 'internal', 'test', 'example', 'invalid', 'lan', 'home', 'home.arpa', 'onion')
    if (parsed.scheme != 'https' or parsed.username or parsed.password
            or port not in (None, 443) or parsed.query or parsed.fragment
            or parsed.path not in ('/api/v1', '/api/v1/') or len(host) > 253
            or len(labels) < 2 or host.endswith('.') or '\\' in value
            or not all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label) for label in labels)
            or all(re.fullmatch(r'(?:0x[0-9a-f]+|[0-9]+)', label) for label in labels)
            or any(host == suffix or host.endswith('.' + suffix) for suffix in reserved)
            or any(host == suffix or host.endswith('.' + suffix)
                   for suffix in ('example.com', 'example.net', 'example.org'))):
        raise RuntimeError(error)
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise RuntimeError(error)
    return urllib.parse.urlunsplit(('https', host, '/api/v1', '', ''))


def validate_version(value):
    if not value or not re.fullmatch(r'[1-9][0-9]{0,9}', value) or int(value) > 2100000000:
        raise RuntimeError('Defina LIGEIRINHO_ANDROID_VERSION_CODE entre 1 e 2100000000.')
    return int(value)


def validate_signing(environment):
    missing = [name for name in SIGNING_NAMES if not environment.get(name)]
    if missing:
        raise RuntimeError('Configuração de assinatura ausente: ' + ', '.join(missing))
    path = Path(environment['ANDROID_RELEASE_KEYSTORE']).expanduser()
    if path.is_symlink() or not path.is_file():
        raise RuntimeError('O keystore precisa ser um arquivo privado regular existente.')
    path = path.resolve()
    if os.name == 'posix' and stat.S_IMODE(path.stat().st_mode) & 0o077:
        raise RuntimeError('Proteja o keystore com permissão 0600 antes do build.')
    if path.stat().st_size > 10 * 1024 * 1024:
        raise RuntimeError('Arquivo de keystore inesperadamente grande.')
    try:
        relative = path.relative_to(ROOT)
        if '.local' not in relative.parts:
            raise RuntimeError('Mantenha o keystore fora do código ou sob .local ignorado.')
    except ValueError:
        pass
    return path


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def verify_backend(api_url):
    """Real health/config requests; this does not authenticate an external user."""
    opener = urllib.request.build_opener(NoRedirect)

    def read(path):
        try:
            request = urllib.request.Request(api_url + path, headers={'Accept': 'application/json'})
            with opener.open(request, timeout=10) as response:
                if response.status != 200:
                    raise RuntimeError('A API não respondeu com sucesso.')
                raw = response.read(65537)
                if len(raw) > 65536:
                    raise RuntimeError('Resposta inesperada da API.')
                return json.loads(raw)
        except urllib.error.HTTPError as error:
            raise RuntimeError('A verificação da API falhou com HTTP ' + str(error.code) + '.') from None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            raise RuntimeError('Não foi possível verificar a API HTTPS configurada.') from None

    health = read('/health')
    if not isinstance(health, dict) or any(
            health.get(name) != expected
            for name, expected in (('status', 'ok'), ('database', 'ready'), ('redis', 'ready'))):
        raise RuntimeError('A API precisa confirmar status ok, banco ready e Redis ready.')
    provider = read('/auth/provider')
    if (not isinstance(provider, dict) or provider.get('configured') is not True
            or provider.get('provider') not in ('legacy', 'supabase')):
        raise RuntimeError('A autenticação da API precisa estar configurada antes do APK.')
    return provider['provider']


def java_home(setup, allow_download=True):
    configured = os.environ.get('JAVA_HOME')
    if configured and (Path(configured) / 'bin/java').is_file():
        java = Path(configured)
    else:
        installed = sorted((ROOT / '.local/java17').glob('*/bin/java'))
        if installed:
            java = installed[-1].parent.parent
        elif allow_download:
            java = setup['ensure_java17']()
        else:
            raise RuntimeError('Instale Java 17 antes de executar --check-only; nada foi baixado.')
    result = subprocess.run([str(java / 'bin/java'), '-version'], capture_output=True, text=True)
    if result.returncode or not re.search(r'version "17(?:[.\"]|$)', result.stderr):
        raise RuntimeError('O build Android requer JAVA_HOME apontando para Java 17.')
    return java


def signer_digest(java, environment):
    # :env keeps passwords out of process arguments and shell histories.
    certificate = subprocess.run([
        str(java / 'bin/keytool'), '-exportcert', '-alias', environment['ANDROID_RELEASE_KEY_ALIAS'],
        '-keystore', environment['ANDROID_RELEASE_KEYSTORE'],
        '-storepass:env', 'ANDROID_RELEASE_STORE_PASSWORD',
    ], env=environment, capture_output=True)
    if certificate.returncode or not certificate.stdout:
        raise RuntimeError('Não foi possível abrir o keystore/alias com a configuração fornecida.')
    # The stock Android debug certificate carries this literal subject.
    if b'Android Debug' in certificate.stdout:
        raise RuntimeError('A chave Android Debug não pode assinar esta entrega de release.')
    return hashlib.sha256(certificate.stdout).hexdigest()


def verified_wrapper(android, setup):
    wrapper = android / 'gradle/wrapper/gradle-wrapper.properties'
    properties = wrapper.read_text()
    match = re.search(r'^distributionUrl=(.+)$', properties, re.M)
    if not match:
        raise RuntimeError('Gradle distributionUrl ausente.')
    url = match.group(1).replace('\\:', ':')
    if not re.fullmatch(r'https://services\.gradle\.org/distributions/gradle-[0-9.]+-(?:all|bin)\.zip', url):
        raise RuntimeError('Revise a origem inesperada da distribuição Gradle.')
    setup['DOWNLOADS'].mkdir(parents=True, exist_ok=True)
    checksum_file = setup['DOWNLOADS'] / (url.rsplit('/', 1)[-1] + '.sha256')
    setup['download'](url + '.sha256', checksum_file)
    expected = checksum_file.read_text().strip()
    previous = re.search(r'^distributionSha256Sum=(.+)$', properties, re.M)
    if not re.fullmatch(r'[0-9a-f]{64}', expected):
        raise RuntimeError('Checksum oficial Gradle inválido.')
    if previous and previous.group(1) != expected:
        raise RuntimeError('Checksum existente diverge do oficial; nada foi substituído.')
    if not previous:
        wrapper.write_text(properties + '\ndistributionSha256Sum=' + expected + '\n')


def restore_manifest(package_file, original):
    """Undo observed Expo script edits without overwriting concurrent changes."""
    current = package_file.read_bytes()
    if current == original:
        return
    before = json.loads(original)
    after = json.loads(current)
    scripts = after.get('scripts', {})
    for platform in ('android', 'ios'):
        if scripts.get(platform) == 'expo run:' + platform:
            previous = before.get('scripts', {}).get(platform)
            if previous is None:
                scripts.pop(platform, None)
            else:
                scripts[platform] = previous
    if after != before:
        raise RuntimeError('O manifest mudou durante o prebuild; as alterações foram preservadas para revisão.')
    package_file.write_bytes(original)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app', choices=('entregador', 'estabelecimento'))
    parser.add_argument('--check-only', action='store_true', help='Validate configuration/signing only; no network or native build')
    parser.add_argument('--prepare-only', action='store_true', help='Prepare native/signing configuration; no APK or API reachability claim')
    parser.add_argument('--architectures', default='arm64-v8a,armeabi-v7a')
    args = parser.parse_args()
    if args.check_only and args.prepare_only:
        raise RuntimeError('Escolha somente um modo de preparação.')
    if not re.fullmatch(r'(arm64-v8a|armeabi-v7a|x86|x86_64)(,(arm64-v8a|armeabi-v7a|x86|x86_64))*', args.architectures):
        raise RuntimeError('Arquitetura Android não suportada.')
    environment = os.environ.copy()
    api_url = validate_api_url(environment.get('EXPO_PUBLIC_API_URL'))
    version = validate_version(environment.get('LIGEIRINHO_ANDROID_VERSION_CODE'))
    keystore = validate_signing(environment)
    environment['ANDROID_RELEASE_KEYSTORE'] = str(keystore)
    provider = None
    if not args.prepare_only and not args.check_only:
        revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        dirty = subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True)
        if dirty:
            raise RuntimeError('Faça commit do código antes de produzir um APK de release.')
        provider = verify_backend(api_url)
    setup = runpy.run_path(str(ROOT / 'scripts/install-android-sdk.py'))
    java = java_home(setup, allow_download=not args.check_only)
    environment['JAVA_HOME'] = str(java)
    certificate_digest = signer_digest(java, environment)
    if args.check_only:
        print('Configuração de release e certificado de assinatura válidos; nenhum APK/API foi testado.')
        return
    configured_sdk = environment.get('ANDROID_HOME') or environment.get('ANDROID_SDK_ROOT')
    sdk = Path(configured_sdk) if configured_sdk else setup['SDK']
    required = ('platforms/android-36/android.jar', 'build-tools/36.0.0/apksigner',
                'ndk/27.1.12297006/source.properties', 'cmake/3.22.1/bin/cmake')
    if not all((sdk / path).is_file() for path in required):
        if configured_sdk:
            raise RuntimeError('Instale SDK36, build-tools36, NDK27.1.12297006 e CMake3.22.1 no ANDROID_HOME.')
        setup['main']()
    setup['configure_java_trust'](java)
    environment.update(ANDROID_HOME=str(sdk), ANDROID_SDK_ROOT=str(sdk),
                       ANDROID_USER_HOME=str(setup['USER']), GRADLE_USER_HOME=str(setup['GRADLE']),
                       CI='1', NODE_ENV='production', EXPO_NO_TELEMETRY='1',
                       LIGEIRINHO_RELEASE='1', EXPO_PUBLIC_API_URL=api_url,
                       LIGEIRINHO_ANDROID_VERSION_CODE=str(version), CMAKE_BUILD_PARALLEL_LEVEL='2')
    app = ROOT / 'apps' / (args.app + '-android')
    package_file = app / 'package.json'
    original_manifest = package_file.read_bytes()
    prebuild_environment = {name: value for name, value in environment.items() if name not in SIGNING_NAMES}
    try:
        subprocess.run(['corepack', 'pnpm', 'exec', 'expo', 'prebuild', '--platform', 'android',
                        '--no-install', '--skip-dependency-update', 'react-native,react'],
                       cwd=app, env=prebuild_environment, check=True)
    finally:
        restore_manifest(package_file, original_manifest)
    android = app / 'android'
    verified_wrapper(android, setup)
    gradle_file = android / 'app/build.gradle'
    original_gradle = gradle_file.read_bytes()
    try:
        gradle_file.write_bytes(original_gradle + SIGNING_OVERRIDE.encode())
        if args.prepare_only:
            print('Projeto nativo preparado e assinatura configurada sem gravar senhas. Nenhum APK/API foi testado.')
            return
        # A previously bundled build may target another EXPO_PUBLIC_API_URL.
        # Recreate app outputs so the delivered APK contains this release's URL.
        subprocess.run(['./gradlew', ':app:clean', ':app:assembleRelease', '--no-daemon', '--max-workers=2',
                        '-PreactNativeArchitectures=' + args.architectures,
                        '-Dorg.gradle.jvmargs=-Xmx3g -XX:MaxMetaspaceSize=768m'],
                       cwd=android, env=environment, check=True)
        apk = android / 'app/build/outputs/apk/release/app-release.apk'
        if not apk.is_file():
            raise RuntimeError('O build não produziu o APK de release esperado.')
        verification = subprocess.run([str(sdk / 'build-tools/36.0.0/apksigner'), 'verify',
                                       '--verbose', '--print-certs', str(apk)],
                                      env=environment, capture_output=True, text=True)
        actual = re.findall(r'certificate SHA-256 digest:\s*([0-9a-fA-F]{64})', verification.stdout)
        if verification.returncode or len(actual) != 1 or actual[0].lower() != certificate_digest:
            raise RuntimeError('A assinatura do APK não corresponde ao certificado de release configurado.')
        with zipfile.ZipFile(apk) as archive:
            try:
                embedded = archive.getinfo('assets/index.android.bundle').file_size
            except KeyError:
                raise RuntimeError('O APK não inclui o JavaScript necessário para funcionar sem Metro.') from None
            if embedded < 100000:
                raise RuntimeError('O bundle incorporado ao APK parece incompleto.')
        artifacts = ROOT / '.local/artifacts/android'
        artifacts.mkdir(parents=True, exist_ok=True)
        output = artifacts / f'ligeirinho-{args.app}-v{version}.apk'
        shutil.copy2(apk, output)
        with output.open('rb') as source:
            checksum = hashlib.file_digest(source, 'sha256').hexdigest()
        output.with_suffix('.apk.sha256').write_text(checksum + '  ' + output.name + '\n')
        output.with_suffix('.apk.json').write_text(json.dumps({
            'app': args.app, 'versionCode': version, 'sourceRevision': revision,
            'apiUrl': api_url, 'authProvider': provider, 'backendReadinessChecked': True,
            'externalAuthLoginTested': False, 'deviceTested': False,
            'embeddedBundleBytes': embedded, 'signerSha256': certificate_digest,
            'apkSha256': checksum,
        }, indent=2) + '\n')
        print('APK standalone assinado:', output)
        print('SHA256:', checksum)
        print('O build não substitui teste de login/atendimento em aparelho real.')
    finally:
        gradle_file.write_bytes(original_gradle)


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, subprocess.CalledProcessError) as error:
        if isinstance(error, subprocess.CalledProcessError):
            print('O comando de build/verificação falhou; nenhum APK foi publicado.', file=__import__('sys').stderr)
        else:
            print(str(error), file=__import__('sys').stderr)
        raise SystemExit(1)
