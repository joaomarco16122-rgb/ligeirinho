import { access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const server = path.join(project, '.next', 'standalone', 'apps', 'web', 'server.js');
await access(server).catch(() => {
  throw new Error(
    'Build standalone não encontrado. Execute o comando de build do portal antes de iniciar.',
  );
});
const port = process.env.WEB_PORT || '3000';
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error('WEB_PORT deve ser uma porta válida entre 1 e 65535.');
}
const child = spawn(process.execPath, [server], {
  cwd: path.dirname(server),
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_USE_ENV_PROXY: '1',
    PORT: port,
    HOSTNAME: process.env.WEB_HOSTNAME || '0.0.0.0',
  },
});
const handlers = new Map(['SIGINT', 'SIGTERM'].map((signal) => [signal, () => child.kill(signal)]));
for (const [signal, handler] of handlers) process.on(signal, handler);
child.once('error', (error) => {
  console.error('Não foi possível iniciar o portal:', error.message);
  process.exitCode = 1;
});
child.once('exit', (code, signal) => {
  for (const [name, handler] of handlers) process.removeListener(name, handler);
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
