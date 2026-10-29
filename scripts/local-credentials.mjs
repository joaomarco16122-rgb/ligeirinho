import { existsSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
export function assertLocalDevelopment(env) {
  let url;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new Error('Configure DATABASE_URL no .env local antes da montagem.');
  }
  if (
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    env.NODE_ENV === 'production'
  ) {
    throw new Error(
      'A montagem automática é para desenvolvimento com banco local. Use o roteiro de implantação para ambientes de produção.',
    );
  }
}
function validAccess(value) {
  return (
    value &&
    typeof value.email === 'string' &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) &&
    typeof value.password === 'string' &&
    value.password.length >= 12 &&
    value.password.length <= 128
  );
}
export function localAccess(env, path) {
  assertLocalDevelopment(env);
  const email = env.BOOTSTRAP_ADMIN_EMAIL,
    password = env.BOOTSTRAP_ADMIN_PASSWORD;
  if ((email && !password) || (!email && password))
    throw new Error(
      'Forneça as duas variáveis BOOTSTRAP_ADMIN_EMAIL e BOOTSTRAP_ADMIN_PASSWORD de forma segura.',
    );
  if (email) {
    if (!validAccess({ email, password }))
      throw new Error('Credenciais de bootstrap inválidas; nenhum valor foi exibido.');
    return { email, password, source: 'runtime' };
  }
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077)
      throw new Error('O arquivo local de acesso precisa ser regular e ter permissões0600.');
    let value;
    try {
      value = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      throw new Error('Arquivo de acesso local inválido; foi preservado.');
    }
    if (!validAccess(value) || value.environment !== 'LOCAL_DEVELOPMENT_ONLY')
      throw new Error('Arquivo de acesso local inválido; foi preservado.');
    return { email: value.email, password: value.password, source: 'saved' };
  }
  const value = {
    email: 'admin@ligeirinho.local',
    password: randomBytes(24).toString('base64url'),
    environment: 'LOCAL_DEVELOPMENT_ONLY',
  };
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  return { email: value.email, password: value.password, source: 'generated' };
}
