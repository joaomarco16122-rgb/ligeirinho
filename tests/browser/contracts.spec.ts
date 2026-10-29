import { expect, test, type Page, type Route } from '@playwright/test';
import { readFile } from 'node:fs/promises';

// These are browser UI contract tests against synthetic HTTP fixtures. They do
// not validate live API authentication, authorization, persistence or dispatch.
const fixtureCity = '00000000-0000-4000-8000-000000000001';
const fixtureUser = '00000000-0000-4000-8000-000000000002';
const fixtureHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type',
};
async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, json: body, headers: fixtureHeaders });
}
type Handler = (route: Route, path: string) => Promise<boolean>;
async function mockApi(
  page: Page,
  options: {
    role?: 'ESTABLISHMENT' | 'SUPER_ADMIN';
    deliveries?: unknown[];
    handle?: Handler;
  } = {},
) {
  const role = options.role ?? 'ESTABLISHMENT';
  const unexpected: string[] = [];
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^\/api\/v1/, '');
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: fixtureHeaders });
      return;
    }
    if (path === '/auth/login' && request.method() === 'POST') {
      expect(request.postDataJSON()).toEqual({
        email: 'fixture@example.test',
        password: 'senha-sintetica-ui',
      });
      await json(route, {
        accessToken: 'synthetic-browser-access',
        refreshToken: 'synthetic-browser-refresh',
        user: {
          id: fixtureUser,
          name: 'Conta sintética',
          email: 'fixture@example.test',
          role,
          cityId: role === 'SUPER_ADMIN' ? null : fixtureCity,
          mustChangePassword: false,
        },
      });
      return;
    }
    expect(request.headers().authorization).toBe('Bearer synthetic-browser-access');
    if (await options.handle?.(route, path)) return;
    if (path === '/deliveries' && request.method() === 'GET') {
      await json(route, options.deliveries ?? []);
      return;
    }
    if (path === '/admin/cities' && request.method() === 'GET') {
      await json(route, [{ id: fixtureCity, name: 'Cidade de teste', state: 'SP' }]);
      return;
    }
    unexpected.push(`${request.method()} ${path}`);
    await json(route, { message: 'Endpoint ausente na fixture de contrato UI.' }, 404);
  });
  return unexpected;
}
async function login(page: Page, destination = '/portal') {
  await page.goto('/login');
  await page.getByLabel('E-mail', { exact: true }).fill('fixture@example.test');
  await page.getByLabel('Senha', { exact: true }).fill('senha-sintetica-ui');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${destination}$`));
  await expect(
    page.getByRole('heading', {
      name: destination === '/admin' ? 'Visão geral da operação' : 'Seus atendimentos',
      exact: true,
    }),
  ).toBeVisible();
}
async function navigate(page: Page, name: string) {
  const mobileMenu = page.getByRole('button', { name: 'Abrir menu', exact: true });
  if (await mobileMenu.isVisible()) await mobileMenu.click();
  await page.getByRole('button', { name, exact: true }).click();
}

test.describe('Contrato UI com API simulada — não é integração com servidor real', () => {
  test('estabelecimento entra e baixa CSV limitado a 100 registros com fórmulas neutralizadas', async ({
    page,
  }) => {
    const deliveries = Array.from({ length: 101 }, (_, index) => ({
      id: `registro-${String(index).padStart(3, '0')}`,
      createdAt: '2026-10-28T15:00:00.000Z',
      status: 'FINALIZADO',
      totalCents: 1500,
      establishment: { name: index === 0 ? '=1+1' : 'Cozinha sintética' },
      courier: { name: 'Entregador sintético' },
      stops: [{ address: index === 0 ? '@SUM(1+1)' : `Rua de teste, ${index}` }],
    }));
    const unexpected = await mockApi(page, { deliveries });
    await login(page);
    await navigate(page, 'Relatórios');
    await expect(
      page.getByRole('heading', { name: 'Relatório dos atendimentos carregados' }),
    ).toBeVisible();
    await expect(
      page.getByText('Até 100 registros mais recentes permitidos para sua conta.', {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.locator('.reports-stats .stat-card').first().locator('strong')).toHaveText(
      '100',
    );
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Baixar CSV', exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe('ligeirinho-atendimentos-inicio-fim.csv');
    const downloadedPath = await download.path();
    expect(downloadedPath).not.toBeNull();
    const csv = await readFile(downloadedPath!, 'utf8');
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('não comprovam pagamento ou recebimento');
    expect(csv).toContain('"\'=1+1"');
    expect(csv).toContain('"\'@SUM(1+1)"');
    expect(csv.match(/registro-\d{3}/g)).toHaveLength(100);
    expect(csv).not.toContain('registro-100');
    expect(unexpected).toEqual([]);
  });

  test('modal contém foco, fecha com Escape e restaura o foco no botão de origem', async ({
    page,
  }) => {
    const unexpected = await mockApi(page);
    await login(page);
    const opener = page.getByRole('button', { name: 'Solicitar entregador', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Para onde vamos?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeFocused();
    const first = dialog.getByRole('button', { name: 'Fechar formulário', exact: true });
    const last = dialog.getByRole('button', { name: 'Calcular cotação', exact: true });
    await page.keyboard.press('Tab');
    await expect(first).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(last).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(first).toBeFocused();
    await opener.focus();
    await expect(dialog).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
    expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
    expect(unexpected).toEqual([]);
  });

  test('cotação pendente mantém modal aberto e não permite fechamento por Escape', async ({
    page,
  }) => {
    let releaseQuote!: () => void;
    const quoteGate = new Promise<void>((resolve) => {
      releaseQuote = resolve;
    });
    let quoteRequests = 0;
    const unexpected = await mockApi(page, {
      handle: async (route, path) => {
        if (path !== '/deliveries/quote') return false;
        quoteRequests++;
        expect(route.request().postDataJSON()).toEqual({
          stops: [{ address: 'Rua sintética, 15', latitude: -23.55, longitude: -46.63 }],
        });
        await quoteGate;
        await json(route, {
          id: '00000000-0000-4000-8000-000000000010',
          totalCents: 1500,
          distanceKm: 2.4,
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        });
        return true;
      },
    });
    try {
      await login(page);
      await page.getByRole('button', { name: 'Solicitar entregador', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Para onde vamos?' });
      await dialog.getByLabel('Endereço completo').fill('Rua sintética, 15');
      await dialog.getByLabel('Latitude', { exact: true }).fill('-23.55');
      await dialog.getByLabel('Longitude', { exact: true }).fill('-46.63');
      await dialog.getByRole('button', { name: 'Calcular cotação', exact: true }).click();
      await expect.poll(() => quoteRequests).toBe(1);
      await expect(dialog.getByRole('button', { name: 'Aguarde…', exact: true })).toBeDisabled();
      await expect(
        dialog.getByRole('button', { name: 'Fechar formulário', exact: true }),
      ).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeVisible();
      releaseQuote();
      await expect(
        dialog.getByRole('button', { name: 'Confirmar e solicitar entregador', exact: true }),
      ).toBeEnabled();
      await expect(
        dialog.getByRole('button', { name: 'Fechar formulário', exact: true }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      expect(unexpected).toEqual([]);
    } finally {
      releaseQuote();
    }
  });

  test('conflito 409 nas configurações exige atualizar e revisar, sem reenvio automático', async ({
    page,
  }) => {
    const key = 'dispatch.offerTimeoutSeconds';
    const label = 'Prazo da oferta em segundos';
    let version = 2;
    let value = 10;
    const writes: unknown[] = [];
    const unexpected = await mockApi(page, {
      role: 'SUPER_ADMIN',
      handle: async (route, path) => {
        if (path === '/admin/settings/catalog') {
          await json(route, [
            {
              key,
              label,
              defaultValue: 10,
              scopes: ['GLOBAL', 'CITY', 'ESTABLISHMENT'],
              effect: 'Novas ofertas preservam o prazo registrado.',
            },
          ]);
          return true;
        }
        if (path === '/admin/settings') {
          await json(route, [{ key, value, version, scope: 'GLOBAL', scopeId: 'global' }]);
          return true;
        }
        if (path === '/admin/settings/effective') {
          await json(route, {
            [key]: { value, version, source: { scope: 'GLOBAL', scopeId: 'global' } },
          });
          return true;
        }
        if (path === `/admin/settings/${key}` && route.request().method() === 'PUT') {
          writes.push(route.request().postDataJSON());
          version = 3;
          value = 20;
          await json(
            route,
            { message: 'A configuração foi alterada. Atualize antes de salvar.' },
            409,
          );
          return true;
        }
        return false;
      },
    });
    await login(page, '/admin');
    await navigate(page, 'Configurações');
    const card = page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: label, exact: true }) });
    await expect(card.getByText('VERSÃO 2 NESTE ESCOPO')).toBeVisible();
    await card.getByRole('button', { name: 'Alterar valor', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Alterar: ${label}` });
    await dialog.getByLabel('Novo valor').fill('15');
    await dialog.getByLabel('Motivo da alteração').fill('Revisão sintética do prazo de ofertas');
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Salvar nova versão', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Nenhum valor foi sobrescrito');
    await expect(dialog.getByLabel('Novo valor')).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: 'Salvar nova versão', exact: true }),
    ).toHaveCount(0);
    expect(writes).toEqual([
      {
        scope: 'GLOBAL',
        value: 15,
        expectedVersion: 2,
        reason: 'Revisão sintética do prazo de ofertas',
        confirm: true,
      },
    ]);
    await dialog
      .getByRole('button', { name: 'Fechar e atualizar valores para revisão', exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(card.getByText('VERSÃO 3 NESTE ESCOPO')).toBeVisible();
    await expect(card.locator('.setting-value strong')).toHaveText('20');
    await card.getByRole('button', { name: 'Alterar valor', exact: true }).click();
    await expect(dialog.getByLabel('Novo valor')).toHaveValue('20');
    await expect(dialog).toContainText('versão consultada: 3');
    await page.keyboard.press('Escape');
    expect(writes).toHaveLength(1);
    expect(unexpected).toEqual([]);
  });
});
