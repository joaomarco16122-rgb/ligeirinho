# Ligeirinho

Plataforma em português para estabelecimentos solicitarem entregadores. Monorepo com API NestJS, portal/site/admin Next.js e dois clientes Android Expo. O pagamento da entrega ocorre diretamente entre as partes; valores de entregas registrados não comprovam recebimento.

O projeto está em desenvolvimento incremental. Consulte [escopo e pendências](docs/requirements.md): a presença de uma tela, adaptador ou instrução de build não comprova integração externa, APK gerado ou prontidão de produção. A especificação original está em [docs/product-specification.md](docs/product-specification.md).

## Montagem e primeiro acesso

O [roteiro de primeira operação](docs/operator-first-run.md) reúne montagem, credenciais seguras, cadastros iniciais e atendimento de homologação. O comando principal prepara o desenvolvimento, valida, inicia API/web e tenta os APKs de debug, interrompendo na primeira etapa obrigatória que falhar:

```sh
cd /workspace/ligeirinho
corepack pnpm montar
```

Para preparar somente ferramentas/dependências/infraestrutura, use `corepack pnpm montar --prepare-only`. Esse modo não executa Prisma, bootstrap, API ou APKs e não declara o sistema pronto. `corepack pnpm diagnostico` mostra status sem segredos; `corepack pnpm iniciar` verifica e inicia builds existentes; `corepack pnpm parar` encerra somente processos gerenciados por esse montador, preservando volumes e processos de outras tarefas. Os comandos não publicam aplicação/ambiente.

Na montagem completa de desenvolvimento com banco local, uma credencial administrativa aleatória pode ser gerada em `.local/acesso-local.json`, com permissão `0600`; a senha nunca é impressa. Consulte o arquivo apenas no editor privado, sem copiar para chat/Git. Uma conta já existente mantém suas credenciais anteriores. Produção usa exclusivamente credenciais fornecidas pelo operador e não o acesso gerado para desenvolvimento.

## Desenvolvimento local

Requisitos: Node.js 22 ou 24, Corepack/pnpm 10.20.0, Docker com Compose v2. Use o checkout existente; cada tarefa em nuvem já é isolada e não precisa criar worktree.

```sh
cd /workspace/ligeirinho
corepack pnpm --version
node scripts/setup-local.mjs
# Carrega somente o arquivo local gerado, protegido por .gitignore.
set -a
. ./.env
set +a
docker compose up -d --wait
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate
corepack pnpm db:migrate
```

`setup-local.mjs` preserva um `.env` existente e cria senhas locais aleatórias sem imprimi-las. Não copie `.env` para o Git. Se já houver configuração local, confira nomes e presença das variáveis sem expor valores.

O primeiro administrador não tem senha padrão. Em um terminal interativo, forneça as credenciais apenas ao bootstrap:

```sh
read -r -p 'E-mail administrativo: ' BOOTSTRAP_ADMIN_EMAIL
read -r -s -p 'Senha administrativa forte: ' BOOTSTRAP_ADMIN_PASSWORD
printf '\n'
export BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
corepack pnpm bootstrap
unset BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
```

Não use uma senha de produção em testes nem salve credenciais no histórico do shell. O bootstrap não deve ser usado para redefinir uma conta existente.

Inicie API e web em terminais com o `.env` carregado:

```sh
corepack pnpm --filter @ligeirinho/api dev
# outro terminal, mesma raiz e ambiente
corepack pnpm --filter @ligeirinho/web dev
```

Valide internamente a disponibilidade:

```sh
curl --fail http://127.0.0.1:3001/api/v1/health
```

A API REST usa `/api/v1`, a documentação OpenAPI fica em `/api/docs`; a web usa a porta 3000 e a API 3001. Para conhecer as operações, veja [docs/api.md](docs/api.md). O cadastro de estabelecimentos e entregadores é administrativo; não existe cadastro público nem portal web de entregador.

## Validação

```sh
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
RUN_INTEGRATION=1 corepack pnpm --filter @ligeirinho/api test:integration
corepack pnpm build
corepack pnpm audit --prod --audit-level high
```

Os testes de integração usam PostgreSQL/Redis reais e dados de teste; use uma base descartável separada em `DATABASE_URL`. Veja os pré-requisitos e a proteção contra uso acidental de base real em [docs/operations.md](docs/operations.md). Resultados efetivamente executados devem ser registrados em [docs/validation.md](docs/validation.md), distinguindo testes pulados de testes aprovados.

Os testes de navegador exigem a web iniciada após o build. Em um terminal, execute `corepack pnpm --filter @ligeirinho/web start`; em outro, `corepack pnpm exec playwright install chromium` e `corepack pnpm test:e2e`. A CI instala também as bibliotecas de sistema do Chromium. A suíte atual verifica páginas públicas, responsividade e redirecionamento de páginas privadas sem sessão em desktop/mobile; não substitui um E2E autenticado contra a API real.

## Android

```sh
corepack pnpm --filter @ligeirinho/entregador-android dev
corepack pnpm --filter @ligeirinho/estabelecimento-android dev
```

Emulador e dispositivo precisam alcançar a API. `EXPO_PUBLIC_API_URL` é público, não pode conter segredos, e deve apontar para uma URL HTTPS acessível em produção. Não existe APK publicado por estes comandos; [docs/android-builds.md](docs/android-builds.md) descreve os passos nativos e as dependências pendentes.

## Documentação

- [Arquitetura](docs/architecture.md), [dados](docs/database.md) e [API](docs/api.md).
- [Segurança e privacidade](docs/security.md), [política de dependências](docs/dependency-policy.md), [serviços externos](docs/external-services.md), [adaptadores](docs/integration-adapters.md) e [decisões](docs/decisions.md).
- [Operação](docs/operations.md), [implantação](docs/deployment.md) e [Android](docs/android-builds.md).

O logotipo original ainda precisa ser fornecido pelo proprietário. Não foi criada uma marca gráfica substituta. Termos, política de privacidade, retenção e contatos do operador precisam de revisão antes da operação pública.

## Resultado desta preparação

Consulte [docs/validation.md](docs/validation.md) para comandos e resultados reais. Foram 452 testes aprovados, 14 cenários de navegador (8 com API simulada) e 41 verificações SQL; 6 testes de integração Prisma ainda não executados. A primeira implementação e o ambiente ainda não estão prontos para produção. As liberações de rede pendentes estão salvas no rascunho, sem aplicação automática. O destino do código é a branch `ligeirinhodelivery` do repositório `joaomarco16122-rgb/ligeirinho`; código enviado não representa site implantado nem APK distribuído.

## Supabase Auth

A versão servidor inclui Supabase Auth e proteção SSR de `/portal` e `/admin`, além da ponte de identidade com o backend. Configuração ausente bloqueia acesso; um vínculo por e-mail ou metadado do navegador não autoriza contas. Veja [docs/supabase-auth.md](docs/supabase-auth.md) para ambiente e limites. A exportação estática é apenas uma entrega institucional e recusa o modo Supabase.

Foram testados 452 casos da suíte, 14 cenários de navegador e 2 cenários adicionais de servidor SSR; 30+18 verificações SQL específicas Supabase também passaram localmente. Os dois aplicativos incluem login/renovação Supabase pelo SDK oficial e tokens criptografados no SecureStore. Logout e renovação compartilham uma sessão por dispositivo, e respostas atrasadas não recriam sessões após sair. Credenciais/projeto remotos não ficaram acessíveis nesta sessão, portanto essa implementação não é uma alegação de Supabase real ativado ou site publicado.

Para APK independente, use o helper de release e o workflow manual documentados em [docs/android-builds.md](docs/android-builds.md). Eles exigem API pública, versão crescente e assinatura persistente; o helper de debug continua sendo um cliente com Metro. Os exports Hermes verificados não são APKs instaláveis.
