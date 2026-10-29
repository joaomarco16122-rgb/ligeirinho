import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { identify, isOwned, stopOwned, waitHealthy } from '../../scripts/local-processes.mjs';
const enabled = process.env.RUN_WEB_AUTH_TEST === '1';
const root = fileURLToPath(new URL('../..', import.meta.url));
async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function withWeb(configuration, run) {
  const port = await freePort();
  const env = { ...process.env };
  for (const name of Object.keys(env))
    if (
      name.startsWith('SUPABASE_') ||
      name.startsWith('NEXT_PUBLIC_SUPABASE_') ||
      name === 'NEXT_PUBLIC_AUTH_PROVIDER'
    )
      delete env[name];
  Object.assign(
    env,
    {
      AUTH_PROVIDER: 'supabase',
      WEB_PORT: String(port),
      WEB_HOSTNAME: '127.0.0.1',
      NEXT_TELEMETRY_DISABLED: '1',
    },
    configuration,
  );
  const child = spawn(process.execPath, ['apps/web/scripts/start-standalone.mjs'], {
    cwd: root,
    env,
    detached: true,
    stdio: 'ignore',
  });
  await once(child, 'spawn');
  const record = identify(child.pid);
  assert.ok(record);
  const origin = `http://127.0.0.1:${port}`;
  try {
    await waitHealthy(origin, { alive: () => isOwned(record) });
    await run(origin);
  } finally {
    await stopOwned(record);
  }
}
test(
  'Supabase SSR real: missing configuration blocks private routes and exposes no key/token',
  { skip: !enabled },
  async () => {
    await withWeb({}, async (origin) => {
      for (const path of ['/admin', '/portal', '/auth/provider', '/auth/session']) {
        const response = await fetch(origin + path, { redirect: 'manual' });
        assert.equal(response.status, 503);
        const body = await response.json();
        assert.equal('accessToken' in body, false);
        assert.equal('publishableKey' in body, false);
        assert.match(response.headers.get('cache-control') || '', /no-store/);
      }
      const cross = await fetch(origin + '/auth/logout', {
        method: 'POST',
        headers: { Origin: 'https://foreign.example.test' },
      });
      assert.equal(cross.status, 403);
    });
  },
);
test(
  'Supabase SSR real: configured fixture without a cookie redirects before private rendering',
  { skip: !enabled },
  async () => {
    // Reserved test endpoint and synthetic public key: no real project or successful authentication.
    await withWeb(
      {
        SUPABASE_URL: 'https://auth-fixture.example.test',
        SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture_for_tests_only',
      },
      async (origin) => {
        for (const path of ['/admin', '/portal']) {
          const response = await fetch(origin + path, { redirect: 'manual' });
          assert.ok([302, 303, 307, 308].includes(response.status));
          const destination = new URL(response.headers.get('location'), origin);
          assert.equal(destination.origin, origin);
          assert.equal(destination.pathname, '/login');
          assert.equal(destination.searchParams.get('next'), path);
        }
        const session = await fetch(origin + '/auth/session');
        assert.equal(session.status, 401);
        const provider = await fetch(origin + '/auth/provider');
        assert.equal(provider.status, 200);
        const data = await provider.json();
        assert.equal(data.provider, 'supabase');
        assert.equal(data.configured, true);
        assert.equal('serviceRoleKey' in data, false);
        assert.equal('accessToken' in data, false);
        const logout = await fetch(origin + '/auth/logout', {
          method: 'POST',
          headers: { Origin: origin },
        });
        assert.equal(logout.status, 200);
        assert.match(logout.headers.get('cache-control') || '', /no-store/);
      },
    );
  },
);
