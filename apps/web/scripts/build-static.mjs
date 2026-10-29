import { access, cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertStaticLegacyAuth } from './static-policy.mjs';

assertStaticLegacyAuth();

const project = fileURLToPath(new URL('../', import.meta.url));
const staging = path.join(project, '.next-export', 'project');
const destination = path.join(project, 'out');
const next = path.join(project, 'node_modules', 'next', 'dist', 'bin', 'next');
const suppliedApi = process.env.NEXT_PUBLIC_API_URL?.trim();
const api = suppliedApi || '/api/v1';
if (api !== '/api/v1') {
  let url;
  try {
    url = new URL(api);
  } catch {
    throw new Error('NEXT_PUBLIC_API_URL deve ser /api/v1 ou uma URL HTTPS da API.');
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(
      'A URL pública da API deve usar HTTPS e não pode incluir credenciais, consulta ou fragmento.',
    );
  }
}
// Next's export-mode distDir names the output destination. Its intermediate .next
// therefore lives inside this isolated staging project, preserving standalone .next.
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
for (const directory of ['app', 'components', 'lib']) {
  await cp(path.join(project, directory), path.join(staging, directory), {
    recursive: true,
    filter: (source) => {
      const auth = path.join(project, 'app', 'auth');
      return source !== auth && !source.startsWith(`${auth}${path.sep}`);
    },
  });
}
for (const file of ['package.json', 'next.config.ts', 'next-env.d.ts']) {
  await cp(path.join(project, file), path.join(staging, file));
}
try {
  await access(path.join(project, 'public'));
  await cp(path.join(project, 'public'), path.join(staging, 'public'), { recursive: true });
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const tsconfig = JSON.parse(await readFile(path.join(project, 'tsconfig.json'), 'utf8'));
tsconfig.extends = './tsconfig.base.json';
await writeFile(path.join(staging, 'tsconfig.json'), `${JSON.stringify(tsconfig, null, 2)}\n`);
await cp(
  path.resolve(project, '../../tsconfig.base.json'),
  path.join(staging, 'tsconfig.base.json'),
);
await symlink(path.join(project, 'node_modules'), path.join(staging, 'node_modules'), 'dir');
const child = spawn(process.execPath, [next, 'build', staging], {
  cwd: staging,
  stdio: 'inherit',
  env: {
    ...process.env,
    LIGEIRINHO_WEB_OUTPUT: 'export',
    AUTH_PROVIDER: 'legacy',
    NEXT_PUBLIC_STATIC_EXPORT: '1',
    NEXT_PUBLIC_API_URL: api.replace(/\/$/, ''),
  },
});
const handlers = new Map(['SIGINT', 'SIGTERM'].map((signal) => [signal, () => child.kill(signal)]));
for (const [signal, handler] of handlers) process.on(signal, handler);
const result = await new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve({ code, signal }));
});
for (const [signal, handler] of handlers) process.removeListener(signal, handler);
if (result.signal) process.kill(process.pid, result.signal);
if (result.code !== 0) process.exit(result.code ?? 1);
const exported = path.join(staging, 'out');
for (const route of [
  '',
  'login',
  'portal',
  'admin',
  'downloads',
  'suporte',
  'termos',
  'privacidade',
]) {
  await access(path.join(exported, route, 'index.html'));
}
await rm(destination, { recursive: true, force: true });
await cp(exported, destination, { recursive: true });
await writeFile(path.join(destination, '.nojekyll'), '');
await writeFile(
  path.join(destination, '_headers'),
  '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  X-Frame-Options: DENY\n  Permissions-Policy: camera=(), microphone=(), geolocation=(self)\n',
);
console.log(
  'Site estático gerado em apps/web/out. O portal requer uma API real; este comando não publica o site.',
);
