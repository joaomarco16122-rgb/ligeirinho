import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import {
  startTicksFromStat,
  identify,
  isOwned,
  stopOwned,
  waitHealthy,
} from '../scripts/local-processes.mjs';

test('identidade do processo aceita espaços/parênteses no nome e rejeita entrada incompleta', () => {
  const fields = ['S', ...Array(18).fill('0'), '987654', ...Array(5).fill('0')];
  assert.equal(startTicksFromStat('42 (nome com ) espaço) ' + fields.join(' ')), '987654');
  assert.throws(() => startTicksFromStat('42 (incompleto) S'));
  assert.equal(identify(-1), null);
});
test('PID antigo não pertence ao montador e não recebe sinal', async () => {
  const current = identify(process.pid);
  assert.ok(current);
  assert.equal(isOwned({ ...current, startTicks: current.startTicks + '0' }), false);
  assert.equal(await stopOwned({ ...current, startTicks: current.startTicks + '0' }, 10), false);
  assert.equal(isOwned({ ...current, bootId: 'other-machine-boot' }), false);
  assert.equal(isOwned(current), true);
});
test('encerra somente grupo de processo explicitamente registrado', async () => {
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  await once(child, 'spawn');
  const record = identify(child.pid);
  assert.ok(record);
  assert.equal(isOwned(record), true);
  const exit = once(child, 'exit');
  assert.equal(await stopOwned(record, 1000), true);
  await exit;
  assert.equal(isOwned(record), false);
});
test('readiness rejeita HTTP200 com banco/fila indisponíveis', async () => {
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', database: 'error', redis: 'ready' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await assert.rejects(
      waitHealthy(`http://127.0.0.1:${server.address().port}`, { json: true, timeoutMs: 100 }),
      /não respondeu/,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
test('readiness confirma banco/fila do contrato real e falha se o processo morreu', async () => {
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', database: 'ready', redis: 'ready' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    assert.equal(await waitHealthy(url, { json: true }), true);
    await assert.rejects(waitHealthy(url, { alive: () => false }), /encerrou/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

// Local bootstrap has no default production password and never overwrites access.
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  chmodSync,
  symlinkSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertLocalDevelopment, localAccess } from '../scripts/local-credentials.mjs';
const localEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://example:unused@127.0.0.1:5432/local_test',
};
test('bootstrap automático recusa produção e banco remoto', () => {
  assert.throws(
    () => assertLocalDevelopment({ ...localEnv, NODE_ENV: 'production' }),
    /desenvolvimento/,
  );
  assert.throws(
    () =>
      assertLocalDevelopment({
        ...localEnv,
        DATABASE_URL: 'postgresql://remote.example.test/database',
      }),
    /desenvolvimento/,
  );
});
test('acesso local aleatório é privado e preservado na segunda execução', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ligeirinho-access-test-'));
  const file = join(dir, 'access.json');
  try {
    const first = localAccess(localEnv, file);
    const contents = readFileSync(file, 'utf8');
    assert.equal(first.source, 'generated');
    assert.ok(first.password.length >= 24);
    assert.equal(statSync(file).mode & 0o077, 0);
    const second = localAccess(localEnv, file);
    assert.equal(second.source, 'saved');
    assert.ok(second.password === first.password);
    assert.ok(readFileSync(file, 'utf8') === contents);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('bootstrap parcial não cria arquivo nem inventa a parte ausente', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ligeirinho-access-test-'));
  const file = join(dir, 'access.json');
  try {
    assert.throws(
      () => localAccess({ ...localEnv, BOOTSTRAP_ADMIN_EMAIL: 'owner@example.test' }, file),
      /duas variáveis/,
    );
    assert.equal(existsSync(file), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test('arquivo permissivo ou link simbólico é rejeitado sem sobrescrever dados', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ligeirinho-access-test-'));
  const file = join(dir, 'access.json');
  const link = join(dir, 'access-link.json');
  try {
    localAccess(localEnv, file);
    const before = readFileSync(file, 'utf8');
    chmodSync(file, 0o644);
    assert.throws(() => localAccess(localEnv, file), /0600/);
    chmodSync(file, 0o600);
    symlinkSync(file, link);
    assert.throws(() => localAccess(localEnv, link), /0600/);
    assert.ok(readFileSync(file, 'utf8') === before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
