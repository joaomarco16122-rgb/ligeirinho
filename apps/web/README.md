# Site Ligeirinho

O projeto oferece dois modos de entrega. O modo padrão gera o servidor Next.js standalone. O modo estático produz arquivos que podem ser hospedados em um serviço de sites estáticos.

## Gerar o site estático

Na raiz do monorepo, após instalar as dependências:

```sh
corepack pnpm --filter @ligeirinho/web build:static
```

O resultado publicável fica em `apps/web/out`. Envie **o conteúdo dessa pasta** para a raiz da hospedagem. Ela contém HTML, CSS, JavaScript e os assets locais; não requer um servidor Node para servir o site.

O build usa uma cópia temporária autorizada dos fontes em `.next-export/project`; não copia `.env`, credenciais ou o conteúdo recursivo de `node_modules`. Os intermediários e os arquivos publicáveis são ignorados pelo Git. O build standalone em `.next` é preservado. Não execute o build estático manualmente com `next build` na pasta original: a versão instalada do Next usa `.next` como diretório intermediário mesmo com outro `distDir` no modo export. Use o script suportado acima.

## API e Supabase

O site institucional funciona sem API. Login, portal e administração são interfaces clientes que exigem uma API real do Ligeirinho, com banco de dados e demais serviços configurados. A exportação não conecta uma conta Supabase, não cria usuários de produção e não substitui o backend.

Sem configuração explícita, a API pública do export é `/api/v1`, no mesmo domínio do site. A hospedagem precisará encaminhar esse caminho para a API real. Para hospedar a API em outro domínio, informe sua URL HTTPS **antes do build**:

```sh
NEXT_PUBLIC_API_URL=https://api.seudominio.com.br/api/v1 corepack pnpm --filter @ligeirinho/web build:static
```

Essa variável é pública e fica incluída no JavaScript. Nunca coloque senha, chave privada Supabase, token `service_role` ou string de conexão nela. O script rejeita URLs com credenciais, consulta, fragmento e destinos sem HTTPS. URLs públicas com chave não são necessárias para esta arquitetura.

Os painéis redirecionam para o login quando não há sessão. A ausência de uma API funcional é exibida como erro; a interface não inventa autenticação ou dados. Para um site publicado, confirme HTTPS, CORS do domínio real e os fluxos autenticados contra a API antes de abrir a operação.

## Hospedagem

As rotas são pastas com `index.html`, por exemplo `/login/` e `/suporte/`. Preserve essa estrutura e a pasta `_next`; não publique apenas os arquivos HTML. Configure a página 404 da hospedagem para `404.html`. Hospedagem em subpasta exige configuração específica de `basePath` e um novo build; o artefato padrão destina-se à raiz do domínio.

O arquivo `_headers` fornece cabeçalhos de segurança para hosts compatíveis com esse formato. Em outros provedores, configure os mesmos cabeçalhos no serviço de hospedagem; arquivos estáticos não executam os `headers()` do Next. `.nojekyll` preserva assets iniciados por `_` em hospedagens com Jekyll.

Links de aplicativos Android ainda não são publicados; termos, privacidade e canais de suporte precisam da identificação jurídica e dos contatos do operador. O logotipo oficial ainda precisa ser fornecido; a interface utiliza o nome em texto.

## Validar o artefato

Com Chromium instalado no sistema ou nos browsers do Playwright:

```sh
corepack pnpm --filter @ligeirinho/web verify:static
```

O verificador inicia um servidor estático local temporário e usa Chromium em telas desktop e celular. Confere CSS real, navegação, páginas públicas, redirecionamento dos painéis sem sessão e a resposta de erro ao tentar login sem backend. Não simula autenticação aprovada. Capturas ficam em `.next-export/validation`, fora da pasta publicável. Defina `CHROMIUM_PATH` se o browser estiver em outro local. O servidor é encerrado ao terminar.

## Servidor Next.js padrão

```sh
corepack pnpm --filter @ligeirinho/web build
corepack pnpm --filter @ligeirinho/web start
```

Esse modo inclui os assets do servidor standalone e usa a porta `WEB_PORT` (padrão `3000`) e o endereço `WEB_HOSTNAME` (padrão `0.0.0.0`). A API permanece um serviço separado.

## Supabase Auth com rotas protegidas no servidor

A autenticação Supabase requer o **modo standalone**, com `AUTH_PROVIDER=supabase` configurado no servidor. Nesse modo, `/portal` e `/admin` passam por um proxy Next que verifica a identidade com `getUser()` antes de liberar a rota. As sessões usam cookies e o perfil aceito pela interface vem de `app_metadata.role`, definido por uma administração confiável. `user_metadata.role` não concede acesso.

O navegador obtém somente a URL e uma chave pública validada em `/auth/provider`, no runtime. A chave privada `service_role` ou `sb_secret_` não pode ser usada nessa configuração. O provedor precisa estar corretamente configurado; falta de valores ou flags contraditórias não ativam login legado como alternativa.

Após entrar no Supabase, a identidade é verificada novamente em `/auth/session` e o token de acesso é trocado na API Nest por uma sessão da plataforma. O usuário precisa ter um vínculo explícito com o UID Supabase no banco local; não há cadastro público nem vínculo automático por e-mail. A API continua responsável pelas permissões, cidade e estabelecimento de cada operação. Os refresh tokens do Supabase ficam no seu próprio SDK/cookies e não são enviados ao Nest.

O callback `/auth/callback` suporta troca PKCE e destinos relativos validados. O logout encerra a sessão Nest atual, para a renovação automática do navegador e solicita a limpeza dos cookies Supabase do projeto. Falhas de revogação remota não são apresentadas como revogação confirmada. A troca obrigatória de senha continua usando o provedor registrado na sessão pelo backend.

`AUTH_PROVIDER=legacy` é o padrão de compatibilidade quando não existem flags contraditórias. Nessa configuração, a sessão da interface continua em memória e os dados são protegidos pela API. Isso não deve ser confundido com proteção SSR Supabase.

O comando `build:static` **recusa** configurações que selecionem Supabase, incluindo `AUTH_PROVIDER=supabase`, `SUPABASE_AUTH_ENABLED=1` e o sinal de frontend correspondente. Ele não remove silenciosamente as proteções SSR de um projeto Supabase. O site institucional exportado anteriormente é um artefato separado e não comprova autenticação Supabase ativa.

Os testes unitários de autenticação utilizam SDK e respostas HTTP simulados, com identificação explícita nos testes. Configuração local e testes aprovados não comprovam acesso a um projeto Supabase real; essa validação depende das credenciais públicas corretas, do projeto autorizado e dos usuários provisionados.
