import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
function evaluate(source, input) {
  const result = spawnSync(
    'python3',
    [
      '-c',
      `import json,runpy,sys\nrelease=runpy.run_path('scripts/build-android-release.py')\ndata=json.load(sys.stdin)\n${source}`,
    ],
    { cwd: root, input: JSON.stringify(input), encoding: 'utf8', timeout: 20000 },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('release CLI accepts a public HTTPS API and refuses local/reserved/parser-ambiguous endpoints offline', () => {
  const good = 'https://api.ligeirinho.com.br/api/v1';
  const values = [
    good,
    good + '/',
    'https://api.ligeirinho.com.br:443/api/v1',
    '',
    'http://api.ligeirinho.com.br/api/v1',
    'https://api.ligeirinho.com.br',
    'https://api.ligeirinho.com.br/api/v1/other',
    good + '?',
    good + '#',
    good + '?key=synthetic',
    good + '#synthetic',
    'https://user:synthetic@api.ligeirinho.com.br/api/v1',
    'https://api.ligeirinho.com.br:444/api/v1',
    'https://localhost/api/v1',
    'https://127.0.0.1/api/v1',
    'https://127.1/api/v1',
    'https://0x7f.1/api/v1',
    'https://10.0.0.1/api/v1',
    'https://[::1]/api/v1',
    'https://api.internal/api/v1',
    'https://api.example.test/api/v1',
    'https://api.example.com/api/v1',
    'https://api.home.arpa/api/v1',
    'https://api.ligeirinho.com.br\\other/api/v1',
    'https://api.ligeirinho.com.br/\napi/v1',
  ];
  const accepted = evaluate(
    "result=[]\nfor value in data:\n try: result.append(release['validate_api_url'](value))\n except RuntimeError: result.append(None)\nprint(json.dumps(result))",
    values,
  );
  assert.deepEqual(accepted.slice(0, 3), [good, good, good]);
  assert.ok(accepted.slice(3).every((value) => value === null));
});

test('release CLI requires a canonical positive Android version code within the platform limit', () => {
  const values = ['1', '42', '2100000000', '', '0', '-1', '01', '1.2', '1e3', ' 2', '2100000001'];
  const accepted = evaluate(
    "result=[]\nfor value in data:\n try: result.append(release['validate_version'](value))\n except RuntimeError: result.append(None)\nprint(json.dumps(result))",
    values,
  );
  assert.deepEqual(accepted.slice(0, 3), [1, 42, 2100000000]);
  assert.ok(accepted.slice(3).every((value) => value === null));
});

test('release signing requires complete configuration and a private regular file; never follows a keystore symlink', () => {
  const directory = mkdtempSync(join(tmpdir(), 'ligeirinho-signing-test-'));
  const keystore = join(directory, 'synthetic-keystore');
  const link = join(directory, 'synthetic-link');
  writeFileSync(keystore, 'synthetic bytes only; not an actual signing key', { mode: 0o600 });
  symlinkSync(keystore, link);
  const environment = {
    ANDROID_RELEASE_KEYSTORE: keystore,
    ANDROID_RELEASE_STORE_PASSWORD: 'synthetic-test-only',
    ANDROID_RELEASE_KEY_ALIAS: 'synthetic-alias',
    ANDROID_RELEASE_KEY_PASSWORD: 'synthetic-test-only',
  };
  const validate = (value) =>
    evaluate(
      "try:\n release['validate_signing'](data)\n print(json.dumps(True))\nexcept RuntimeError:\n print(json.dumps(False))",
      value,
    );
  try {
    assert.equal(validate(environment), true);
    assert.equal(validate({ ...environment, ANDROID_RELEASE_STORE_PASSWORD: '' }), false);
    assert.equal(validate({ ...environment, ANDROID_RELEASE_KEYSTORE: link }), false);
    chmodSync(keystore, 0o644);
    assert.equal(validate(environment), false);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test('missing release destination fails before tool downloads, prebuild or signing', () => {
  const env = { ...process.env };
  delete env.EXPO_PUBLIC_API_URL;
  const result = spawnSync(
    'python3',
    ['scripts/build-android-release.py', 'entregador', '--check-only'],
    {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 20000,
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /API HTTPS pública/);
  assert.doesNotMatch(result.stderr, /Traceback|download|storePassword|synthetic-test-only/);
});

test('prebuild restores only its known script edits and preserves a concurrent dependency change', () => {
  const result = evaluate(
    "import pathlib,tempfile\nwith tempfile.TemporaryDirectory() as directory:\n path=pathlib.Path(directory)/'package.json'\n original=b'{\"scripts\":{\"android\":\"expo run:android\"},\"dependencies\":{\"react\":\"19.1.0\"}}\\n'\n modified=json.loads(original); modified['scripts']['ios']='expo run:ios'\n path.write_text(json.dumps(modified))\n release['restore_manifest'](path,original)\n exact=path.read_bytes()==original\n modified['dependencies']['new-safe-dependency']='1.0.0'\n concurrent=json.dumps(modified).encode();path.write_bytes(concurrent)\n refused=False\n try: release['restore_manifest'](path,original)\n except RuntimeError: refused=True\n print(json.dumps({'exactRoundtrip':exact,'concurrentChangeRefused':refused,'concurrentChangePreserved':path.read_bytes()==concurrent}))",
    {},
  );
  assert.deepEqual(result, {
    exactRoundtrip: true,
    concurrentChangeRefused: true,
    concurrentChangePreserved: true,
  });
});
