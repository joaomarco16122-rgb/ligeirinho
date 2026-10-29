#!/usr/bin/env node
// Safe offline preparation for using Supabase only as managed PostgreSQL.
// No network connections, credentials output or automatic connection-string rewrites.
import { isIP } from 'node:net';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export class SupabaseConfigurationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'SupabaseConfigurationError';
    this.code = code;
  }
}
function fail(code, message) {
  throw new SupabaseConfigurationError(code, message);
}
function decode(value, variable) {
  try {
    return decodeURIComponent(value);
  } catch {
    fail('INVALID_ENCODING', `${variable}: codificação da credencial inválida.`);
  }
}
function projectReference(env) {
  if (!env.SUPABASE_URL)
    fail('SUPABASE_URL_MISSING', 'Configure SUPABASE_URL com a URL pública real do projeto.');
  let url;
  try {
    url = new URL(env.SUPABASE_URL);
  } catch {
    fail('PROJECT_URL_INVALID', 'SUPABASE_URL deve ser uma URL HTTPS pública de projeto.');
  }
  const publicDns =
    url.hostname.split('.').length > 1 &&
    url.hostname.split('.').every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if (
    !publicDns ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname !== '/' ||
    isIP(url.hostname) ||
    !url.hostname.includes('.') ||
    /(^|\.)(localhost|local|internal)$/.test(url.hostname)
  )
    fail(
      'PROJECT_URL_INVALID',
      'SUPABASE_URL deve ser HTTPS, sem credenciais, porta, caminho ou parâmetros.',
    );
  const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
  const explicit = env.SUPABASE_PROJECT_REF;
  if (explicit && !/^[a-z0-9]{20}$/.test(explicit))
    fail(
      'PROJECT_REF_INVALID',
      'SUPABASE_PROJECT_REF deve ser a referência real de 20 caracteres do projeto.',
    );
  if (match && explicit && match[1] !== explicit)
    fail(
      'PROJECT_REF_MISMATCH',
      'A referência configurada não corresponde à URL pública do projeto.',
    );
  if (!match && !explicit)
    fail(
      'CUSTOM_DOMAIN_NEEDS_PROJECT_REF',
      'Domínio personalizado exige SUPABASE_PROJECT_REF para verificar o vínculo da conexão PostgreSQL.',
    );
  return match?.[1] ?? explicit;
}
function databaseConnection(raw, variable, reference, migration, passwordSource) {
  if (!raw)
    fail(
      'DATABASE_URL_MISSING',
      `Configure ${variable} com a conexão PostgreSQL real, por entrada segura.`,
    );
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail('DATABASE_URL_INVALID', `${variable}: URL PostgreSQL inválida.`);
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    url.hash ||
    !url.hostname ||
    !url.pathname ||
    url.pathname === '/'
  )
    fail(
      'DATABASE_URL_INVALID',
      `${variable}: URL PostgreSQL deve informar host e banco, sem fragmento.`,
    );
  const username = decode(url.username, variable),
    password = decode(url.password, variable);
  // eslint-disable-next-line no-control-regex -- Reject control bytes in credentials without logging their contents.
  if (!username || !password || /[\u0000-\u001f\u007f]/.test(username + password))
    fail(
      'DATABASE_CREDENTIAL_MISSING',
      `${variable}: usuário e senha reais são obrigatórios, sem caracteres de controle.`,
    );
  // Only explicit source metadata is conclusive; never guess from password contents.
  if (passwordSource === 'proxy')
    fail(
      'DATABASE_PROXY_CREDENTIAL',
      `${variable}: senha substituída apenas por proxy HTTPS não autentica conexão PostgreSQL. Use credencial PostgreSQL por entrada segura.`,
    );
  const keys = [...url.searchParams.keys()];
  if (new Set(keys).size !== keys.length)
    fail(
      'DUPLICATE_PARAMETER',
      `${variable}: parâmetros repetidos são ambíguos e devem ser removidos.`,
    );
  if (url.searchParams.get('schema') !== 'ligeirinho')
    fail(
      'PRIVATE_SCHEMA_REQUIRED',
      `${variable}: use explicitamente schema=ligeirinho; o validador não altera sua URL.`,
    );
  if (url.searchParams.has('options') || url.searchParams.has('search_path'))
    fail(
      'SEARCH_PATH_OVERRIDE',
      `${variable}: não sobrescreva search_path/options; preserve o schema privado configurado.`,
    );
  if (
    url.searchParams.get('sslmode') !== 'require' ||
    url.searchParams.get('sslaccept') !== 'strict'
  )
    fail(
      'TLS_STRICT_REQUIRED',
      `${variable}: para Prisma configure sslmode=require e sslaccept=strict; não desative verificação TLS.`,
    );
  const port = url.port || '5432';
  const direct = url.hostname === `db.${reference}.supabase.co`;
  const pooler = /^[a-z0-9-]+\.pooler\.supabase\.com$/.test(url.hostname);
  if (!direct && !pooler)
    fail(
      'DATABASE_PROJECT_MISMATCH',
      `${variable}: host não corresponde ao projeto Supabase nem a um pooler oficial reconhecido.`,
    );
  if (direct && (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(username) || port !== '5432'))
    fail(
      'DIRECT_CONNECTION_INVALID',
      `${variable}: conexão direta usa usuário PostgreSQL e porta 5432.`,
    );
  if (pooler) {
    const suffix = `.${reference}`;
    if (
      !username.endsWith(suffix) ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(username.slice(0, -suffix.length))
    )
      fail(
        'POOLER_PROJECT_MISMATCH',
        `${variable}: o usuário do pooler deve conter a referência correta do projeto.`,
      );
    if (!['5432', '6543'].includes(port))
      fail(
        'POOLER_PORT_INVALID',
        `${variable}: use porta oficial 5432 (sessão) ou 6543 (transação).`,
      );
  }
  const pgbouncer = url.searchParams.get('pgbouncer');
  if (pgbouncer !== null && !['true', 'false'].includes(pgbouncer))
    fail('PGBOUNCER_INVALID', `${variable}: pgbouncer aceita somente true ou false.`);
  if (port === '6543' && pgbouncer !== 'true')
    fail(
      'TRANSACTION_POOLER_REQUIRES_PGBOUNCER',
      `${variable}: pooler de transação requer pgbouncer=true para Prisma.`,
    );
  if (migration && (port !== '5432' || pgbouncer === 'true'))
    fail(
      'MIGRATION_REQUIRES_SESSION_CONNECTION',
      `${variable}: migrações exigem conexão direta/sessão na porta 5432, sem pgbouncer=true.`,
    );
  return {
    mode: direct ? 'direct' : port === '6543' ? 'transaction-pooler' : 'session-pooler',
    schema: 'ligeirinho',
    tls: 'require-with-strict-verification',
  };
}
export function validateSupabaseConfiguration(env) {
  const reference = projectReference(env);
  const runtime = databaseConnection(
    env.DATABASE_URL,
    'DATABASE_URL',
    reference,
    false,
    env.DATABASE_PASSWORD_SOURCE,
  );
  const migrationVariable = env.MIGRATION_DATABASE_URL ? 'MIGRATION_DATABASE_URL' : 'DATABASE_URL';
  if (!env.MIGRATION_DATABASE_URL && runtime.mode === 'transaction-pooler')
    fail(
      'MIGRATION_URL_REQUIRED',
      'Configure MIGRATION_DATABASE_URL com conexão direta ou pooler de sessão 5432 para migrar; não use o pooler de transação.',
    );
  const migration = databaseConnection(
    env[migrationVariable],
    migrationVariable,
    reference,
    true,
    migrationVariable === 'MIGRATION_DATABASE_URL'
      ? env.MIGRATION_DATABASE_PASSWORD_SOURCE
      : env.DATABASE_PASSWORD_SOURCE,
  );
  return {
    project: 'URL and connection references match syntactically',
    runtime,
    migration: { ...migration, source: migrationVariable },
    remoteConnectionTested: false,
  };
}
function safeSchema(schema) {
  if (
    !/^[a-z][a-z0-9_]{0,62}$/.test(schema) ||
    ['public', 'auth', 'storage', 'extensions', 'realtime', 'information_schema'].includes(
      schema,
    ) ||
    schema.startsWith('pg_')
  )
    throw new Error('Schema privado inválido.');
  return schema;
}
export function buildSupabaseSecuritySql(schema = 'ligeirinho', { transaction = true } = {}) {
  schema = safeSchema(schema);
  return `-- Review and execute as the SAME trusted owner that runs Prisma migrations.
-- No application migrations/history or remote credentials are included here.
${transaction ? 'BEGIN;' : ''}
DO $guard$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = '${schema}') THEN
    RAISE EXCEPTION 'Private application schema missing; migrate with Prisma first.';
  END IF;
END $guard$;
REVOKE ALL ON SCHEMA "${schema}" FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA "${schema}" FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "${schema}" FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA "${schema}" FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" REVOKE ALL ON SEQUENCES FROM PUBLIC;
-- Scoped defaults remove scoped additions, not PostgreSQL's global PUBLIC EXECUTE
-- default. Revoked schema USAGE is the boundary; rerun this SQL after migrations.
-- Shared owners' global defaults are deliberately left unchanged.
ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}" REVOKE ALL ON FUNCTIONS FROM PUBLIC;
DO $roles$
DECLARE target name;
BEGIN
  FOR target IN SELECT rolname FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') LOOP
    EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %I', '${schema}', target);
    EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %I', '${schema}', target);
    EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %I', '${schema}', target);
    EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM %I', '${schema}', target);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON TABLES FROM %I', '${schema}', target);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON SEQUENCES FROM %I', '${schema}', target);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I REVOKE ALL ON FUNCTIONS FROM %I', '${schema}', target);
    IF has_schema_privilege(target, '${schema}', 'USAGE') OR has_schema_privilege(target, '${schema}', 'CREATE') THEN
      RAISE EXCEPTION 'API role still has inherited schema access; review role membership before exposing services.';
    END IF;
  END LOOP;
END $roles$;
${transaction ? 'COMMIT;' : ''}
`;
}
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(
      'Usage: node scripts/supabase-prepare.mjs --check | --security-sql | --write-security <new-file>',
    );
    console.log(
      'Checks are offline. SUPABASE_URL, DATABASE_URL and, for transaction poolers, MIGRATION_DATABASE_URL must be supplied securely.',
    );
    return;
  }
  if (args.length === 1 && args[0] === '--security-sql') {
    process.stdout.write(buildSupabaseSecuritySql());
    return;
  }
  if (args.length === 2 && args[0] === '--write-security') {
    await writeFile(resolve(args[1]), buildSupabaseSecuritySql(), { flag: 'wx', mode: 0o600 });
    console.log(
      'SQL de segurança gravado para revisão. Nenhuma conexão ou migração foi executada.',
    );
    return;
  }
  if (args.length && !(args.length === 1 && args[0] === '--check'))
    fail('ARGUMENT_INVALID', 'Argumentos inválidos. Consulte --help.');
  const result = validateSupabaseConfiguration(process.env);
  console.log(JSON.stringify(result, null, 2));
  console.log(
    'Validação offline concluída. Credenciais, DNS, conexão, privilégios e migrações remotos ainda não foram testados.',
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    if (error instanceof SupabaseConfigurationError)
      console.error(JSON.stringify({ code: error.code, message: error.message }));
    else
      console.error(
        JSON.stringify({
          code: 'PREPARATION_FAILED',
          message: 'Falha na preparação. Nenhuma credencial ou URL foi registrada.',
        }),
      );
    process.exitCode = 1;
  });
}
