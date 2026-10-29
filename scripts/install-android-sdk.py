#!/usr/bin/env python3
"""Install official Android tooling, verifying the published artifact digest and size.

Uses inherited HTTPS proxy and TLS trust. No credentials or system HOME changes.
"""
import hashlib
import os
import re
from pathlib import Path, PurePosixPath
import shutil
import stat
import tarfile
import subprocess
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / '.local'
SDK = LOCAL / 'android-sdk'
USER = LOCAL / 'android-user'
DOWNLOADS = LOCAL / 'android-downloads'
GRADLE = LOCAL / 'gradle-home'
CATALOG = 'https://dl.google.com/android/repository/repository2-3.xml'
PACKAGES = ('platforms/android-36', 'build-tools/36.0.0', 'build-tools/35.0.0', 'platform-tools', 'ndk/27.1.12297006', 'cmake/3.22.1')

def download(url, path):
    if not url.startswith('https://'):
        raise RuntimeError('Only verified HTTPS sources are supported.')
    subprocess.run(['curl', '--fail', '--location', '--silent', '--show-error', url, '--output', str(path)], check=True)

def ensure_java17():
    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    target = LOCAL / 'java17'
    installed = sorted(target.glob('*/bin/java'))
    if installed:
        return installed[-1].parent.parent
    target.mkdir(parents=True, exist_ok=True)
    latest = DOWNLOADS / 'temurin17-latest.html'
    result = subprocess.run(['curl', '--fail', '--location', '--silent', '--show-error', 'https://github.com/adoptium/temurin17-binaries/releases/latest', '--output', str(latest), '--write-out', '%{url_effective}'], check=True, capture_output=True, text=True)
    url = urllib.parse.urlsplit(result.stdout)
    prefix = '/adoptium/temurin17-binaries/releases/tag/'
    if url.hostname != 'github.com' or not url.path.startswith(prefix):
        raise RuntimeError('Unexpected official Temurin release source.')
    tag = urllib.parse.unquote(url.path[len(prefix):])
    if not re.fullmatch(r'jdk-17[.0-9+_-]+', tag):
        raise RuntimeError('The official release is not a Java 17 release.')
    assets = DOWNLOADS / 'temurin17-assets.html'
    download('https://github.com/adoptium/temurin17-binaries/releases/expanded_assets/' + urllib.parse.quote(tag, safe=''), assets)
    links = re.findall(r'href="([^"]+)"', assets.read_text())
    link = next(link for link in links if link.startswith('/adoptium/temurin17-binaries/releases/download/') and 'OpenJDK17U-jdk_x64_linux_hotspot_' in link and link.endswith('.tar.gz'))
    if link + '.sha256.txt' not in links:
        raise RuntimeError('Official Temurin release checksum not found.')
    artifact = DOWNLOADS / Path(link).name
    checksum = DOWNLOADS / (artifact.name + '.sha256.txt')
    download('https://github.com' + link + '.sha256.txt', checksum)
    download('https://github.com' + link, artifact)
    expected = checksum.read_text().split()[0]
    with artifact.open('rb') as source:
        actual = hashlib.file_digest(source, 'sha256').hexdigest()
    if not re.fullmatch('[0-9a-f]{64}', expected) or actual != expected:
        raise RuntimeError('Official Temurin SHA256 verification failed. Artifact will not be used.')
    with tarfile.open(artifact) as source:
        source.extractall(target, filter='data')
    installed = sorted(target.glob('*/bin/java'))
    if len(installed) != 1:
        raise RuntimeError('Unexpected Java installation layout.')
    print('Official Temurin17 SHA256 verified:', actual)
    return installed[0].parent.parent

def configure_gradle_proxy():
    GRADLE.mkdir(parents=True, exist_ok=True)
    target = GRADLE / 'gradle.properties'
    lines = target.read_text().splitlines() if target.exists() else []
    replacements = {'org.gradle.java.installations.auto-download': 'false', 'org.gradle.workers.max': '3'}
    for protocol in ('http', 'https'):
        value = os.environ.get(protocol.upper() + '_PROXY') or os.environ.get(protocol + '_proxy')
        if value:
            proxy = urllib.parse.urlsplit(value)
            if not proxy.hostname:
                raise RuntimeError('The inherited proxy has no hostname.')
            replacements[f'systemProp.{protocol}.proxyHost'] = proxy.hostname
            replacements[f'systemProp.{protocol}.proxyPort'] = str(proxy.port or (443 if proxy.scheme == 'https' else 80))
    lines = [line for line in lines if line.partition('=')[0].strip() not in replacements]
    lines.extend(f'{key}={value}' for key, value in replacements.items())
    target.write_text('\n'.join(lines) + '\n')

def configure_java_trust(java):
    configure_gradle_proxy()
    trust = GRADLE / 'cacerts'
    if not trust.exists():
        source = Path('/etc/ssl/certs/java/cacerts')
        if not source.exists():
            source = java / 'lib/security/cacerts'
        shutil.copy2(source, trust)
    certificate = os.environ.get('CODEX_PROXY_CERT')
    if certificate and Path(certificate).is_file():
        keytool = str(java / 'bin/keytool')
        alias = 'codex-session-proxy'
        common = ['-keystore', str(trust), '-storepass', 'changeit']
        exists = subprocess.run([keytool, '-list', '-alias', alias, *common], capture_output=True).returncode == 0
        if exists:
            subprocess.run([keytool, '-delete', '-alias', alias, *common], check=True, capture_output=True)
        subprocess.run([keytool, '-importcert', '-alias', alias, '-file', certificate, '-noprompt', *common], check=True, capture_output=True)
    target = GRADLE / 'gradle.properties'
    replacements = {'systemProp.javax.net.ssl.trustStore': str(trust), 'org.gradle.java.installations.paths': str(java)}
    lines = [line for line in target.read_text().splitlines() if line.partition('=')[0].strip() not in replacements]
    lines.extend(f'{key}={value}' for key, value in replacements.items())
    target.write_text('\n'.join(lines) + '\n')

def main():
    for directory in (SDK, USER, DOWNLOADS):
        directory.mkdir(parents=True, exist_ok=True)
    tool = SDK / 'cmdline-tools/latest/bin/android'
    if not tool.exists():
        catalog = DOWNLOADS / 'repository2-3.xml'
        download(CATALOG, catalog)
        entries = ET.parse(catalog).getroot().findall('remotePackage')
        package = next(entry for entry in entries if entry.get('path') == 'cmdline-tools;latest')
        archive = next(entry.find('complete') for entry in package.findall('archives/archive') if entry.findtext('host-os') == 'linux')
        filename = archive.findtext('url')
        if not filename or '/' in filename or not filename.endswith('.zip'):
            raise RuntimeError('Unexpected official archive name.')
        artifact = DOWNLOADS / filename
        download('https://dl.google.com/android/repository/' + filename, artifact)
        expected = archive.find('checksum')
        with artifact.open('rb') as source:
            actual = hashlib.file_digest(source, expected.attrib['type']).hexdigest()
        if actual != expected.text or artifact.stat().st_size != int(archive.findtext('size')):
            raise RuntimeError('Android SDK checksum or size verification failed. Artifact will not be used.')
        target = SDK / 'cmdline-tools/latest'
        with zipfile.ZipFile(artifact) as source:
            for entry in source.infolist():
                relative = PurePosixPath(entry.filename)
                if not relative.parts or relative.parts[0] != 'cmdline-tools' or '..' in relative.parts or stat.S_ISLNK(entry.external_attr >> 16):
                    raise RuntimeError('Unsafe archive member.')
                destination = target.joinpath(*relative.parts[1:])
                if entry.is_dir():
                    destination.mkdir(parents=True, exist_ok=True)
                else:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes(source.read(entry))
                    destination.chmod((entry.external_attr >> 16) & 0o777 or 0o644)
        print('Official Android command-line archive verified:', filename, actual)
    environment = os.environ.copy()
    environment.update(ANDROID_USER_HOME=str(USER), ANDROID_HOME=str(SDK), ANDROID_SDK_ROOT=str(SDK))
    java = ensure_java17()
    configure_java_trust(java)
    environment['JAVA_HOME'] = str(java)
    for package in PACKAGES:
        subprocess.run([str(tool), '--no-metrics', '--sdk=' + str(SDK), 'sdk', 'install', package], env=environment, check=True, stdin=subprocess.DEVNULL)
    print('Android SDK prepared under .local/android-sdk; live processes are not required.')

if __name__ == '__main__':
    main()
