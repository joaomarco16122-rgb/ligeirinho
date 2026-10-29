import { access, cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const target = path.join(project, '.next', 'standalone', 'apps', 'web');
await access(path.join(target, 'server.js'));
await mkdir(path.join(target, '.next'), { recursive: true });
await cp(path.join(project, '.next', 'static'), path.join(target, '.next', 'static'), {
  recursive: true,
  force: true,
});
try {
  await access(path.join(project, 'public'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.log('Build standalone preparado; o projeto não possui diretório público adicional.');
  process.exit(0);
}
await cp(path.join(project, 'public'), path.join(target, 'public'), {
  recursive: true,
  force: true,
});
console.log('Build standalone e arquivos públicos preparados.');
