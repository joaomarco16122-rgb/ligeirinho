#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  renameSync,
  rmSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn, spawnSync } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { identify, isOwned, stopOwned, waitHealthy } from './local-processes.mjs';
import { assertLocalDevelopment, localAccess } from './local-credentials.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const local = join(root, '.local');
const statePath = join(local, 'processes.json');
const reportPath = join(local, 'assembly-status.json');
const argv = process.argv.slice(2).filter((x) => x !== '--');
const command = argv.shift() || 'doctor';
const onlyPrepare = argv.includes('--prepare-only');
if (argv.some((x) => x !== '--prepare-only')) throw new Error('Opção não reconhecida.');
mkdirSync(local, { recursive: true, mode: 0o700 });
process.chdir(root);
process.env.PATH = join(local, 'bin') + delimiter + process.env.PATH;
process.env.NEXT_TELEMETRY_DISABLED = '1';
process.env.TURBO_TELEMETRY_DISABLED = '1';
if (existsSync(join(root, '.env'))) loadEnvFile(join(root, '.env'));
const events = [];
const dockerEnv = { ...process.env };
for (const key of [
  'DOCKER_HOST',
  'DOCKER_CONTEXT',
  'DOCKER_TLS',
  'DOCKER_TLS_VERIFY',
  'DOCKER_CERT_PATH',
])
  delete dockerEnv[key];
const dockerArgs = ['--host=unix:///var/run/docker.sock', 'compose', '--project-directory', root];
const registry = () => {
  try {
    const data = JSON.parse(readFileSync(statePath, 'utf8'));
    return data.version === 1 && data.services && typeof data.services === 'object'
      ? data
      : { version: 1, services: {} };
  } catch {
    return { version: 1, services: {} };
  }
};
const saveRegistry = (data) => {
  const contents = JSON.stringify(data, null, 2) + '\n';
  const temporary = statePath + '.' + randomUUID() + '.tmp';
  try {
    writeFileSync(temporary, contents, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, statePath);
  } finally {
    rmSync(temporary, { force: true });
  }
};
function note(step, status, message) {
  events.push({ step, status, message, time: new Date().toISOString() });
  console.log(
    `${status === 'passed' ? 'OK' : status === 'blocked' ? 'BLOQUEADO' : 'INFO'} · ${message}`,
  );
}
function run(name, executable, args, extraEnv = {}, exactEnv = false) {
  console.log(`\n→ ${name}`);
  const result = spawnSync(executable, args, {
    cwd: root,
    env: exactEnv ? extraEnv : { ...process.env, ...extraEnv },
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${name} não concluiu. Consulte o erro acima; nenhuma etapa posterior foi declarada concluída.`,
    );
  note(name, 'passed', `Etapa concluída: ${name}.`);
}
const pnpm = (name, args, env) => run(name, 'corepack', ['pnpm', ...args], env);
function requireLocalDatabase() {
  assertLocalDevelopment(process.env);
}

function hasGeneratedClient() {
  try {
    const api = createRequire(join(root, 'services/api/package.json'));
    const client = createRequire(api.resolve('@prisma/client/package.json'));
    return existsSync(client.resolve('.prisma/client/schema.prisma'));
  } catch {
    return false;
  }
}
async function doctor() {
  const data = registry();
  console.log(`Node: ${process.versions.node}`);
  console.log(`Dependências: ${existsSync(join(root, 'node_modules')) ? 'presentes' : 'ausentes'}`);
  console.log(
    `Configuração local: ${existsSync(join(root, '.env')) ? 'presente (valores omitidos)' : 'ausente'}`,
  );
  console.log(`Cliente Prisma: ${hasGeneratedClient() ? 'gerado' : 'não gerado'}`);
  console.log(`Provedor Auth selecionado: ${process.env.AUTH_PROVIDER || 'legacy'}`);
  if (process.env.AUTH_PROVIDER === 'supabase') {
    const hasUrl = Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
    const hasKey = Boolean(
      process.env.SUPABASE_PUBLISHABLE_KEY ||
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    );
    console.log(
      `Configuração Supabase Auth: URL ${hasUrl ? 'presente' : 'ausente'}, chave publicável ${hasKey ? 'presente' : 'ausente'} (valores omitidos; conexão não validada).`,
    );
  }

  for (const name of ['api', 'web'])
    console.log(
      `${name}: ${isOwned(data.services[name]) ? 'processo gerenciado ativo' : 'sem processo gerenciado ativo'}`,
    );
  const result = spawnSync(
    'docker',
    [...dockerArgs, 'ps', '--format', '{{.Service}}: {{.State}} / {{.Health}}'],
    { cwd: root, env: dockerEnv, encoding: 'utf8' },
  );
  console.log(
    result.status === 0
      ? `Serviços Docker:\n${result.stdout.trim() || 'nenhum iniciado'}`
      : 'Docker: indisponível neste contexto de execução.',
  );
  console.log(
    `SDK Android: ${existsSync(join(local, 'android-sdk/platforms/android-36/android.jar')) ? 'presente' : 'ausente'}`,
  );
  console.log(
    'Destinos exigidos: binaries.prisma.sh e repo.reactnative.dev. Consulte a política aplicada no ambiente; este diagnóstico não altera a rede.',
  );
  return data;
}
async function start() {
  if (!hasGeneratedClient())
    throw new Error(
      'Cliente Prisma ausente: a API não pode ser iniciada. Aplique a liberação binaries.prisma.sh e execute a montagem.',
    );
  if (
    !existsSync(join(root, 'services/api/dist/main.js')) ||
    !existsSync(join(root, 'apps/web/.next/BUILD_ID'))
  )
    throw new Error('Builds ausentes. Execute a montagem antes de iniciar.');
  const data = registry();
  const added = [];
  try {
    for (const [name, filter, url, json] of [
      [
        'api',
        '@ligeirinho/api',
        `http://127.0.0.1:${process.env.PORT || 3001}/api/v1/health`,
        true,
      ],
      ['web', '@ligeirinho/web', 'http://127.0.0.1:3000/', false],
    ]) {
      if (isOwned(data.services[name])) {
        await waitHealthy(url, { json, alive: () => isOwned(data.services[name]) });
        continue;
      }
      // Preserve unknown services: never bind over them or adopt them for stop().
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
        if (response)
          throw new Error(
            `A porta de ${name} já responde fora do controle deste montador. Preserve o processo existente e libere a porta antes de continuar.`,
          );
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('A porta')) throw error;
      }
      const output = openSync(join(local, `${name}.log`), 'a', 0o600);
      const child = spawn('corepack', ['pnpm', '--filter', filter, 'start'], {
        cwd: root,
        env: process.env,
        detached: true,
        stdio: ['ignore', output, output],
      });
      closeSync(output);
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      child.unref();
      const identity = identify(child.pid);
      if (!identity) throw new Error(`Não foi possível registrar o processo ${name}.`);
      data.services[name] = identity;
      added.push(name);
      saveRegistry(data);
      await waitHealthy(url, { json, alive: () => isOwned(identity) });
      note(name, 'passed', `${name} respondeu à verificação funcional; log em .local/${name}.log.`);
    }
    const authResponse = await fetch('http://127.0.0.1:3000/auth/provider', {
      signal: AbortSignal.timeout(3000),
    });
    const authConfiguration = await authResponse.json().catch(() => null);
    if (
      !authResponse.ok ||
      authConfiguration?.configured !== true ||
      authConfiguration?.provider !== (process.env.AUTH_PROVIDER || 'legacy')
    )
      throw new Error(
        'O site iniciou, mas a configuração de autenticação não está válida; nenhuma prontidão completa foi confirmada.',
      );
    note(
      'auth-config',
      'passed',
      'Configuração de autenticação aceita pelo servidor. Login externo não foi confirmado por esse check.',
    );
    saveRegistry(data);
  } catch (error) {
    for (const name of added.reverse()) {
      await stopOwned(data.services[name]);
      delete data.services[name];
    }
    saveRegistry(data);
    throw error;
  }
}
async function stop() {
  const data = registry();
  for (const name of ['web', 'api']) {
    const stopped = await stopOwned(data.services[name]);
    if (data.services[name]) delete data.services[name];
    note(
      name,
      'passed',
      stopped
        ? `${name}: processo desta montagem encerrado.`
        : `${name}: nenhum processo pertencente a esta montagem foi encerrado.`,
    );
  }
  saveRegistry(data);
  console.log('Volumes e serviços Docker foram preservados.');
}
function bootstrapLocal() {
  const access = localAccess(process.env, join(local, 'acesso-local.json'));
  pnpm('Bootstrap seguro local', ['bootstrap'], {
    BOOTSTRAP_ADMIN_EMAIL: access.email,
    BOOTSTRAP_ADMIN_PASSWORD: access.password,
  });
  console.log(
    'Bootstrap executado sem exibir credenciais. Se geradas, estão em .local/acesso-local.json; conta existente foi preservada pelo bootstrap.',
  );
}

async function assemble() {
  run('Configuração local', process.execPath, ['scripts/setup-local.mjs']);
  loadEnvFile(join(root, '.env'));
  requireLocalDatabase();
  mkdirSync(join(local, 'bin'), { recursive: true });
  run('Ativação do pnpm', 'corepack', ['enable', '--install-directory', join(local, 'bin')]);
  pnpm('Instalação reproduzível', ['install', '--frozen-lockfile']);
  const preparedDockerEnv = { ...process.env };
  for (const key of [
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_TLS',
    'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH',
  ])
    delete preparedDockerEnv[key];
  run(
    'PostgreSQL e Redis',
    'docker',
    [...dockerArgs, 'up', '-d', '--wait', 'postgres', 'redis'],
    preparedDockerEnv,
    true,
  );
  run('Ferramentas Android verificadas', 'python3', ['scripts/install-android-sdk.py']);
  if (onlyPrepare) {
    note(
      'prepare',
      'passed',
      'Preparação concluída. API, integrações, bootstrap e APKs não foram executados neste modo.',
    );
    await doctor();
    return;
  }
  pnpm('Cliente Prisma', ['db:generate']);
  pnpm('Migrações', ['db:migrate']);
  bootstrapLocal();
  pnpm('Análise estática', ['lint']);
  pnpm('Tipos', ['typecheck']);
  pnpm('Testes', ['test']);
  pnpm('Integração PostgreSQL/Redis', ['--filter', '@ligeirinho/api', 'test:integration'], {
    RUN_INTEGRATION: '1',
  });
  pnpm('Restrições SQL', ['test:sql']);
  // Prevent stale Next chunks by stopping only processes previously registered here.
  await stop();
  pnpm('Builds', ['build']);
  await start();
  for (const app of ['entregador', 'estabelecimento'])
    run(`APK debug: ${app}`, 'python3', ['scripts/build-android-debug.py', app]);
  note(
    'assembly',
    'passed',
    'Montagem local concluída. Debug não é publicação nem homologação de produção.',
  );
}
try {
  if (command === 'doctor') await doctor();
  else if (command === 'assemble') await assemble();
  else if (command === 'start') await start();
  else if (command === 'stop') await stop();
  else throw new Error('Comando inválido. Use assemble, start, stop ou doctor.');
} catch (error) {
  const message = error instanceof Error ? error.message : 'Falha de montagem.';
  note(command, 'blocked', message);
  process.exitCode = 1;
} finally {
  if (command === 'assemble')
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          version: 1,
          preparedOnly: onlyPrepare,
          complete: process.exitCode !== 1 && !onlyPrepare,
          events,
        },
        null,
        2,
      ) + '\n',
      { mode: 0o600 },
    );
}
