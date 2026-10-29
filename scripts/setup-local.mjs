import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const path = fileURLToPath(new URL('../.env', import.meta.url));
if (existsSync(path)) {
  console.log('.env existente preservado.');
} else {
  const password = randomBytes(24).toString('hex');
  const jwt = randomBytes(48).toString('hex');
  const content = `NODE_ENV=development\nPOSTGRES_USER=ligeirinho\nPOSTGRES_DB=ligeirinho\nPOSTGRES_PASSWORD=${password}\nDATABASE_URL=postgresql://ligeirinho:${password}@127.0.0.1:5432/ligeirinho?schema=public\nREDIS_URL=redis://127.0.0.1:6379\nJWT_SECRET=${jwt}\nCORS_ORIGIN=http://localhost:3000\nPORT=3001\nNEXT_PUBLIC_API_URL=http://localhost:3001/api/v1\n`;
  writeFileSync(path, content, { mode: 0o600, flag: 'wx' });
  console.log(
    '.env local criado com segredos aleatórios, sem exibi-los. Configure BOOTSTRAP_ADMIN_EMAIL e BOOTSTRAP_ADMIN_PASSWORD no processo de bootstrap.',
  );
}
