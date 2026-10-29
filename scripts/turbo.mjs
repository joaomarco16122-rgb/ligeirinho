// Keep Turborepo's nested package-manager invocations on the project's Corepack pin.
import { mkdirSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('..', import.meta.url));
const bin = join(root, '.local/bin');
mkdirSync(bin, { recursive: true });
const setup = spawnSync('corepack', ['enable', '--install-directory', bin], {
  cwd: root,
  stdio: 'inherit',
});
if (setup.error || setup.status !== 0)
  throw new Error('Não foi possível ativar o gerenciador fixado pelo projeto.');
const require = createRequire(import.meta.url);
const turbo = join(require.resolve('turbo/package.json'), '../bin/turbo');
const result = spawnSync(process.execPath, [turbo, ...process.argv.slice(2)], {
  cwd: root,
  env: { ...process.env, PATH: bin + delimiter + process.env.PATH },
  stdio: 'inherit',
});
if (result.error) throw new Error('Não foi possível iniciar o executor de tarefas do projeto.');
if (result.signal) process.kill(process.pid, result.signal);
else process.exitCode = result.status ?? 1;
