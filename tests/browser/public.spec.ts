import { test,expect } from '@playwright/test';
test('página institucional acessível, responsiva e sem erros de execução', async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const response=await page.goto('/');expect(response?.status()).toBe(200);
 await expect(page.getByRole('heading',{level:1})).toContainText('Sua próxima entrega.');
 await page.getByRole('link',{name:'Entrar no meu estabelecimento'}).click();
 await expect(page.getByRole('heading',{name:'Acesse sua conta'})).toBeVisible();
 await expect(page.getByLabel('E-mail',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Senha',{exact:true})).toHaveAttribute('type','password');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 expect(errors).toEqual([]);
});
test('painéis privados exigem sessão e não exibem dados sem autenticação',async({page})=>{
 for(const path of ['/portal','/admin']){
  await page.goto(path);await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('heading',{name:'Acesse sua conta'})).toBeVisible();
 }
});
test('páginas operacionais públicas não prometem APK nem integração ativada',async({page})=>{
 for(const path of ['/downloads','/termos','/privacidade','/suporte']){
  const response=await page.goto(path);expect(response?.status()).toBe(200);
  await expect(page.getByRole('heading',{level:1})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 }
 await page.goto('/downloads');expect(await page.locator('a[href$=".apk"]').count()).toBe(0);
});
