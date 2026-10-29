#!/usr/bin/env python3
"""Prebuild and assemble a debug APK with official Gradle checksum verification."""
import argparse
import hashlib
import os
from pathlib import Path
import re
import runpy
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('app', choices=('entregador', 'estabelecimento'))
    parser.add_argument('--prepare-only', action='store_true', help='Prepare SDK and native project without attempting an APK build')
    parser.add_argument('--architectures', default='arm64-v8a', help='Comma-separated React Native ABIs; default arm64-v8a')
    args = parser.parse_args()
    if not re.fullmatch(r'(arm64-v8a|armeabi-v7a|x86|x86_64)(,(arm64-v8a|armeabi-v7a|x86|x86_64))*', args.architectures):
        raise RuntimeError('Unsupported Android architecture.')
    setup = runpy.run_path(str(ROOT / 'scripts/install-android-sdk.py'))
    sdk = setup['SDK']
    required = ('platforms/android-36/android.jar', 'build-tools/36.0.0/apksigner', 'ndk/27.1.12297006/source.properties', 'cmake/3.22.1/bin/cmake')
    if not all((sdk / path).exists() for path in required):
        setup['main']()
    else:
        java = setup['ensure_java17']()
        setup['configure_java_trust'](java)
    app = ROOT / 'apps' / (args.app + '-android')
    environment = os.environ.copy()
    java = setup['ensure_java17']()
    environment.update(JAVA_HOME=str(java), ANDROID_HOME=str(sdk), ANDROID_SDK_ROOT=str(sdk), ANDROID_USER_HOME=str(setup['USER']), GRADLE_USER_HOME=str(setup['GRADLE']), CI='1', NODE_ENV='development', EXPO_NO_TELEMETRY='1', CMAKE_BUILD_PARALLEL_LEVEL='3')
    package_file = app / 'package.json'
    original_manifest = package_file.read_bytes()
    try:
        subprocess.run(['corepack', 'pnpm', 'exec', 'expo', 'prebuild', '--platform', 'android', '--no-install', '--skip-dependency-update', 'react-native,react'], cwd=app, env=environment, check=True)
    finally:
        # Expo adds an iOS script even for Android prebuild. Preserve the exact
        # repository manifest, including pre-existing scripts and formatting.
        if package_file.read_bytes() != original_manifest:
            package_file.write_bytes(original_manifest)
    android = app / 'android'
    wrapper = android / 'gradle/wrapper/gradle-wrapper.properties'
    properties = wrapper.read_text()
    match = re.search(r'^distributionUrl=(.+)$', properties, re.M)
    if not match:
        raise RuntimeError('Gradle distribution URL not found.')
    url = match.group(1).replace('\\:', ':')
    if not url.startswith('https://services.gradle.org/distributions/'):
        raise RuntimeError('Review the unexpected Gradle distribution source before building.')
    checksum_file = setup['DOWNLOADS'] / (url.rsplit('/', 1)[-1] + '.sha256')
    setup['download'](url + '.sha256', checksum_file)
    expected = checksum_file.read_text().strip()
    if not re.fullmatch('[0-9a-f]{64}', expected):
        raise RuntimeError('Invalid official Gradle checksum.')
    previous = re.search(r'^distributionSha256Sum=(.+)$', properties, re.M)
    if previous and previous.group(1) != expected:
        raise RuntimeError('Existing Gradle checksum differs from the official checksum; refusing to replace it.')
    if not previous:
        wrapper.write_text(properties + '\ndistributionSha256Sum=' + expected + '\n')
    if args.prepare_only:
        print('Native Android project prepared. No APK build was attempted.')
        return
    subprocess.run(['./gradlew', ':app:assembleDebug', '--no-daemon', '--max-workers=3', '-PreactNativeArchitectures=' + args.architectures, '-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1g'], cwd=android, env=environment, check=True)
    apk = android / 'app/build/outputs/apk/debug/app-debug.apk'
    if not apk.is_file():
        raise RuntimeError('The selected build did not produce the expected APK.')
    subprocess.run([str(sdk / 'build-tools/36.0.0/apksigner'), 'verify', '--verbose', str(apk)], env=environment, check=True)
    artifacts = ROOT / '.local/artifacts'
    artifacts.mkdir(exist_ok=True)
    output = artifacts / (args.app + '-debug.apk')
    shutil.copy2(apk, output)
    with output.open('rb') as source:
        checksum = hashlib.file_digest(source, 'sha256').hexdigest()
    print('Debug APK:', output)
    print('SHA256:', checksum)
    print('This debug development client requires Metro; it is not a production release or device test.')

if __name__ == '__main__':
    main()
