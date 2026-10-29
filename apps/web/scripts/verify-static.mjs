import assert from 'node:assert/strict';
import { createReadStream, existsSync } from 'node:fs';
import { access, mkdir, readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const project = fileURLToPath(new URL('../', import.meta.url));
const root = path.join(project, 'out');
const captures = path.join(project, '.next-export', 'validation');
await access(path.join(root, 'index.html'));
await mkdir(captures, { recursive: true });
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};
let apiRequests = 0;
const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method || '')) {
    if (request.url?.includes('/api/v1/')) apiRequests++;
    response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', Allow: 'GET, HEAD' });
    response.end('Este servidor serve somente os arquivos estáticos; nenhuma API foi conectada.');
    return;
  }
  let file;
  try {
    const url = new URL(request.url || '/', 'http://localhost');
    file = path.resolve(root, `.${decodeURIComponent(url.pathname)}`);
    if (file !== root && !file.startsWith(`${root}${path.sep}`))
      throw new Error('Caminho inválido.');
    const metadata = await stat(file);
    if (metadata.isDirectory()) {
      if (!url.pathname.endsWith('/')) {
        response.writeHead(301, { Location: `${url.pathname}/${url.search}` });
        response.end();
        return;
      }
      file = path.join(file, 'index.html');
    }
    await access(file);
    response.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).pipe(response);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    response.end(
      await readFile(path.join(root, '404.html'), 'utf8').catch(() => 'Página não encontrada.'),
    );
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const base = `http://127.0.0.1:${address.port}`;
const executable =
  process.env.CHROMIUM_PATH || (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    ...(executable ? { executablePath: executable } : {}),
  });
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const missingAssets = [];
    page.on('response', (response) => {
      if (response.url().includes('/_next/') && response.status() >= 400)
        missingAssets.push(`${response.status()} ${new URL(response.url()).pathname}`);
    });
    assert.equal((await page.goto(base))?.status(), 200);
    await page
      .getByRole('heading', { level: 1 })
      .filter({ hasText: 'Sua próxima entrega.' })
      .waitFor();
    assert.equal(
      await page.locator('.public-header').evaluate((node) => getComputedStyle(node).display),
      'flex',
      'O CSS exportado precisa carregar.',
    );
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      'A página inicial deve caber na tela.',
    );
    await page.screenshot({
      path: path.join(captures, `${viewport.name}-home.png`),
      fullPage: true,
    });
    await page.getByRole('link', { name: 'Entrar no meu estabelecimento', exact: true }).click();
    await page.waitForURL('**/login/');
    await page.getByRole('heading', { name: 'Acesse sua conta', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Senha', { exact: true }).getAttribute('type'), 'password');
    for (const route of ['portal', 'admin']) {
      assert.equal((await page.goto(`${base}/${route}/`))?.status(), 200);
      await page.waitForURL('**/login/');
      await page.getByRole('heading', { name: 'Acesse sua conta', exact: true }).waitFor();
    }
    await page.getByLabel('E-mail', { exact: true }).fill('validacao-estatica@example.test');
    await page.getByLabel('Senha', { exact: true }).fill('sem-api-na-validacao');
    await page.getByRole('button', { name: 'Entrar', exact: true }).click();
    await page.getByRole('alert').waitFor();
    assert.match(
      new URL(page.url()).pathname,
      /^\/login\/$/,
      'Sem API real, não deve haver login confirmado.',
    );
    for (const route of ['downloads', 'suporte', 'termos', 'privacidade']) {
      assert.equal((await page.goto(`${base}/${route}/`))?.status(), 200);
      await page.getByRole('heading', { level: 1 }).waitFor();
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
        `A rota ${route} deve caber na tela.`,
      );
    }
    await page.goto(`${base}/downloads/`);
    assert.equal(await page.locator('a[href$=".apk"]').count(), 0, 'Não deve haver APK fictício.');
    assert.deepEqual(errors, [], 'Não deve haver erro JavaScript nas páginas exportadas.');
    assert.deepEqual(missingAssets, [], 'Todos os assets Next devem ser servidos pelo artefato.');
    await context.close();
    console.log(
      `${viewport.name}: CSS real, navegação, páginas públicas, redirecionamento privado e falha honesta sem API verificados.`,
    );
  }
  assert.equal(
    apiRequests,
    2,
    'A validação deve ter tentado autenticação real contra o servidor estático, sem simular sucesso.',
  );
  console.log(
    'Site exportado validado no Chromium. Nenhum backend, Supabase ou login real foi declarado conectado.',
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
