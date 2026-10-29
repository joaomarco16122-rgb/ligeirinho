import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export function runLocalSql(sql) {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const env = { ...process.env };
  for (const key of [
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_TLS',
    'DOCKER_TLS_VERIFY',
    'DOCKER_CERT_PATH',
  ])
    delete env[key];
  const container = env.POSTGRES_TEST_CONTAINER_ID;
  if (container && !/^[a-f0-9]{12,64}$/.test(container))
    throw new Error('Identificador de contêiner de teste inválido.');
  const database = env.POSTGRES_TEST_DATABASE || 'ligeirinho';
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(database))
    throw new Error('Nome de banco de teste inválido.');
  const target = container
    ? ['exec', '-i', container]
    : [
        'compose',
        '--project-directory',
        root,
        '-f',
        'docker-compose.yml',
        'exec',
        '-T',
        'postgres',
      ];
  return spawnSync(
    'docker',
    [
      '--host=unix:///var/run/docker.sock',
      ...target,
      'psql',
      '-U',
      'ligeirinho',
      '-d',
      database,
      '-X',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    { env, cwd: root, input: sql, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 },
  );
}
