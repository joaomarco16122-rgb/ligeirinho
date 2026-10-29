import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  validateSupabaseConfiguration,
  buildSupabaseSecuritySql,
} from '../../scripts/supabase-prepare.mjs';
// All values are local test fixtures, never credentials for an existing project.
const reference = 'abcdefghijklmnopqrst';
const password = 'synthetic-password-test-only';
const connection = (
  host = `db.${reference}.supabase.co`,
  user = 'postgres',
  port = '5432',
  query = 'schema=ligeirinho&sslmode=require&sslaccept=strict',
) => `postgresql://${user}:${password}@${host}:${port}/postgres?${query}`;
const fixture = () => ({
  SUPABASE_URL: `https://${reference}.supabase.co`,
  DATABASE_URL: connection(),
});
const error = (env, code) =>
  assert.throws(
    () => validateSupabaseConfiguration(env),
    (e) => e.code === code && !e.message.includes(password) && !e.message.includes('postgresql://'),
  );
test('direct connection matches actual project syntax and keeps private schema/TLS', () => {
  const result = validateSupabaseConfiguration(fixture());
  assert.equal(result.runtime.mode, 'direct');
  assert.equal(result.runtime.schema, 'ligeirinho');
  assert.equal(result.remoteConnectionTested, false);
  assert.ok(!JSON.stringify(result).includes(password));
  assert.ok(!JSON.stringify(result).includes(reference));
});
test('transaction pooler requires project username, pgBouncer and separate session migration URL', () => {
  const env = {
    ...fixture(),
    DATABASE_URL: connection(
      'aws-0-sa-east-1.pooler.supabase.com',
      `postgres.${reference}`,
      '6543',
      'schema=ligeirinho&sslmode=require&sslaccept=strict&pgbouncer=true',
    ),
    MIGRATION_DATABASE_URL: connection(
      'aws-0-sa-east-1.pooler.supabase.com',
      `postgres.${reference}`,
    ),
  };
  const result = validateSupabaseConfiguration(env);
  assert.equal(result.runtime.mode, 'transaction-pooler');
  assert.equal(result.migration.mode, 'session-pooler');
  error({ ...env, MIGRATION_DATABASE_URL: undefined }, 'MIGRATION_URL_REQUIRED');
  error(
    { ...env, MIGRATION_DATABASE_URL: env.DATABASE_URL },
    'MIGRATION_REQUIRES_SESSION_CONNECTION',
  );
  error(
    { ...env, DATABASE_URL: env.DATABASE_URL.replace('&pgbouncer=true', '') },
    'TRANSACTION_POOLER_REQUIRES_PGBOUNCER',
  );
});
test('rejects wrong project direct hostname or pooler username', () => {
  error(
    { ...fixture(), DATABASE_URL: connection('db.zzzzzzzzzzzzzzzzzzzz.supabase.co') },
    'DATABASE_PROJECT_MISMATCH',
  );
  error(
    {
      ...fixture(),
      DATABASE_URL: connection(
        'aws-0-sa-east-1.pooler.supabase.com',
        'postgres.zzzzzzzzzzzzzzzzzzzz',
      ),
    },
    'POOLER_PROJECT_MISMATCH',
  );
});
test('rejects public schema, TLS bypass and ambiguous duplicated parameters', () => {
  error(
    {
      ...fixture(),
      DATABASE_URL: connection(
        undefined,
        undefined,
        undefined,
        'schema=public&sslmode=require&sslaccept=strict',
      ),
    },
    'PRIVATE_SCHEMA_REQUIRED',
  );
  error(
    {
      ...fixture(),
      DATABASE_URL: connection(
        undefined,
        undefined,
        undefined,
        'schema=ligeirinho&sslmode=disable&sslaccept=accept_invalid_certs',
      ),
    },
    'TLS_STRICT_REQUIRED',
  );
  error(
    {
      ...fixture(),
      DATABASE_URL: connection(
        undefined,
        undefined,
        undefined,
        'schema=ligeirinho&sslmode=require&sslaccept=strict&sslmode=disable',
      ),
    },
    'DUPLICATE_PARAMETER',
  );
  error(
    { ...fixture(), DATABASE_URL: connection() + '&options=search_path%3Dpublic' },
    'SEARCH_PATH_OVERRIDE',
  );
});
test('custom public project URL requires explicit matching reference metadata', () => {
  error(
    { ...fixture(), SUPABASE_URL: 'https://api.example.test' },
    'CUSTOM_DOMAIN_NEEDS_PROJECT_REF',
  );
  assert.equal(
    validateSupabaseConfiguration({
      ...fixture(),
      SUPABASE_URL: 'https://api.example.test',
      SUPABASE_PROJECT_REF: reference,
    }).remoteConnectionTested,
    false,
  );
  error({ ...fixture(), SUPABASE_PROJECT_REF: 'zzzzzzzzzzzzzzzzzzzz' }, 'PROJECT_REF_MISMATCH');
  error({ ...fixture(), SUPABASE_URL: 'http://localhost' }, 'PROJECT_URL_INVALID');
});
test('requires credentials without guessing password content; explicit proxy source is rejected', () => {
  error(
    { ...fixture(), DATABASE_URL: connection().replace(password, '') },
    'DATABASE_CREDENTIAL_MISSING',
  );
  error({ ...fixture(), DATABASE_PASSWORD_SOURCE: 'proxy' }, 'DATABASE_PROXY_CREDENTIAL');
  assert.equal(
    validateSupabaseConfiguration({
      ...fixture(),
      DATABASE_URL: connection().replace(password, 'placeholder-is-a-valid-synthetic-password'),
    }).runtime.mode,
    'direct',
  );
});
test('missing configuration fails offline CLI without values or raw connection strings', () => {
  const result = spawnSync(process.execPath, ['scripts/supabase-prepare.mjs', '--check'], {
    cwd: new URL('../..', import.meta.url),
    env: { ...process.env, SUPABASE_URL: '', DATABASE_URL: connection() },
    encoding: 'utf8',
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SUPABASE_URL_MISSING/);
  assert.ok(!result.stderr.includes(password));
  assert.ok(!result.stderr.includes(reference));
});
test('security SQL revokes Data API roles/current and future object privileges without copying migrations or credentials', () => {
  const sql = buildSupabaseSecuritySql();
  for (const role of ['anon', 'authenticated', 'service_role'])
    assert.ok(sql.includes(`'${role}'`));
  assert.match(sql, /REVOKE ALL ON SCHEMA "ligeirinho" FROM PUBLIC/);
  assert.match(sql, /ALTER DEFAULT PRIVILEGES/);
  assert.match(sql, /ALL FUNCTIONS/);
  assert.match(sql, /has_schema_privilege/);
  assert.ok(!sql.includes(password));
  assert.ok(!sql.includes('CREATE TABLE'));
  assert.ok(!sql.includes('_prisma_migrations'));
  assert.throws(() => buildSupabaseSecuritySql('public'));
  assert.throws(() => buildSupabaseSecuritySql('x"; DROP SCHEMA public'));
});
