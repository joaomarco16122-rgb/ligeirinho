# Início de uma tarefa de nuvem — Ligeirinho

Use `/workspace/ligeirinho`, o checkout já isolado desta tarefa. Não crie worktree nem substitua arquivos, configurações ou segredos existentes. Leia AGENTS.md, docs/validation.md e docs/requirements.md. Arquivos/builds não comprovam que todos os serviços estão operacionais.

## Montagem e início

- `corepack pnpm montar` é a montagem local completa: preserva `.env`, ativa pnpm fixado, instala pelo lockfile, prepara PostgreSQL/Redis/SDK, gera Prisma, migra banco local, executa bootstrap local seguro, testes/builds, inicia API/web e tenta APKs de debug. Para na primeira falha e registra `.local/assembly-status.json`; nunca tratar `complete:false` como pronto.
- `corepack pnpm montar --prepare-only` foi executado com sucesso nesta instância e prepara apenas as etapas independentes. Não gera Prisma, conta administrativa, API nem APK.
- `corepack pnpm diagnostico` mostra presença/estado sem imprimir valores secretos. `corepack pnpm iniciar` exige cliente gerado e builds e verifica saúde funcional antes de registrar sucesso. `corepack pnpm parar` encerra apenas grupos pertencentes ao próprio registro, conferindo PID, início e boot da máquina; não remove volumes e não encerra servidores desconhecidos.
- Na nuvem, exporte `PATH="$PWD/.local/bin:$PATH"` antes de tarefas Turbo para evitar o pnpm fallback11. Use `corepack pnpm` 10.20.0. Após mudanças de manifests, execute instalação congelada explícita; `.npmrc` impede instalações automáticas paralelas durante scripts.

## Pré-requisitos de rede e Docker

A política aplicada deve permitir `binaries.prisma.sh` (Prisma/checksums), `repo.reactnative.dev` (AAR oficial) e `api.github.com` para as operações GitHub de CI/publicação. As inclusões estão salvas no rascunho, mas a instância observada ainda não as aplica. O agente pode salvar o rascunho; isso não altera a rede nem publica. Nunca contornar o proxy, desativar TLS/checksums ou reutilizar artefatos não verificados. Git HTTPS e a API GitHub são acessos distintos: o teste de escrita Git em simulação passou, enquanto `gh api` recebeu Forbidden.

Use o Docker local explicitamente: `env -u DOCKER_HOST -u DOCKER_CONTEXT -u DOCKER_TLS -u DOCKER_TLS_VERIFY -u DOCKER_CERT_PATH docker --host=unix:///var/run/docker.sock info`. O montador faz essa seleção e inicia `postgres`/`redis` com healthchecks e portas loopback. Se o sandbox impedir sockets com EPERM, solicite execução apropriada pela ferramenta; não altere rotas/proxy.

## Credenciais e segurança

`montar` aceita somente banco loopback e ambiente de desenvolvimento. Se BOOTSTRAP_ADMIN_EMAIL/PASSWORD já estiverem no processo, preserva os dois; configuração parcial é erro. Caso contrário, gera uma senha aleatória local e grava `.local/acesso-local.json` com modo 0600, sem exibi-la. Bootstrap preserva Super Admin já existente e força troca inicial. Esse arquivo não corresponde necessariamente a uma conta preexistente; não inventar senha de produção nem usar segredo-proxy como senha local/HMAC. O arquivo real ainda não foi gerado nesta instância, pois Prisma permanece bloqueado.

Para produção, use docs/deployment.md e credenciais próprias por canal seguro. Não executar o montador de desenvolvimento contra um banco remoto. Cadastro de usuários continua exclusivo da administração. Confirme a situação do código com Git; um push não comprova site implantado, API operacional, APK ou publicação do ambiente.

## Desenvolvimento e validação

- `corepack pnpm dev` inicia API/web; `dev:entregador` e `dev:estabelecimento` iniciam Metro em 8081/8082 sem tentar abrir aparelho automaticamente. APIs nativas exigem URL alcançável pelo aparelho.
- `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm build`; com `.env` exportado, `RUN_INTEGRATION=1 corepack pnpm --filter @ligeirinho/api test:integration`. Os seis testes Prisma continuam não executados. `test:sql` aplica todas as migrações em esquema temporário e verifica rollback.
- O web de produção usa `next build` e preparação standalone; `corepack pnpm --filter @ligeirinho/web start` usa porta 3000 explicitamente, sem herdar a porta 3001 da API. Reinicie apenas o servidor da tarefa após recompilar para evitar chunks antigos.
- Com web rodando, `CHROMIUM_PATH=/usr/bin/chromium corepack pnpm test:e2e` usa Chromium do sistema se presente. São seis testes públicos e oito contratos UI com API simulada; não representam atendimento autenticado real.
- SDK/JDK17/Gradle ficam em `.local` e são preparados por `python3 scripts/install-android-sdk.py`. `python3 scripts/build-android-debug.py entregador` e equivalente estabelecimento preservam manifests, validam digests e só anunciam APK após sucesso. `--prepare-only` não compila; debug exige Metro, release exige HTTPS/assinatura do operador e teste em aparelho. Nenhum APK foi produzido nesta instância.

## Retenção e publicação

Dependências/arquivos podem estar retidos no snapshot; processos/API/web/Docker/Metro precisam de verificação ou reinício. A imagem web foi validada localmente, mas a API, APKs e integrações externas seguem com limitações em validation.md. Não afirmar restauração em outra tarefa sem evidência. Após aplicar rede, concluir validações e revisar/salvar a configuração, o usuário pode publicar o ambiente pelo produto; salvar instruções não executa/publica nada.

## Supabase Auth do site e dos aplicativos

O site de servidor aceita `AUTH_PROVIDER=supabase` com SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY (ou aliases públicos completos e coerentes). As três exigências foram salvas no rascunho sem inventar valores. O plugin marcado não ofereceu comandos de conta/projeto nesta sessão; não afirmar projeto conectado. Nunca usar service_role/secretkey no navegador, nunca conceder perfil por user_metadata ou por coincidência de e-mail. O backend exige User.supabaseUserId previamente vinculado e ativo, limita sessões à prova e usa SDK/proxy para renovar.

Os dois apps usam o SDK oficial com configuração pública obtida em `GET /api/v1/auth/provider`, failclosed sem fallback implícito. Tokens ficam em blocos criptografados do SecureStore. Testes com respostas controladas e exports Metro não comprovam login real nem instalação em aparelho.

Consulte docs/supabase-auth.md e docs/supabase.md. AUTH_PROVIDER=legacy é apenas compatibilidade explícita; configuração Supabase incompleta não pode cair silenciosamente para legacy. Produção Docker seleciona Supabase e o servidor responde 503 às rotas privadas enquanto faltarem os campos. `corepack pnpm test:web:auth` executa 2 cenários reais de servidor com fixtures sem login externo; `test:supabase:security` executa os testes locais isolados SQL. Não executá-los contra banco remoto.

Para Supabase PostgreSQL, use schema privado/túnel e requisitos TCP permitidos pelo ambiente, preservando TLS; o validador offline não conecta. Não aplicar SQL ou alterar Auth remoto sem identificar o projeto e acessar as credenciais pelo canal seguro. Nenhum projeto, usuário ou host foi inventado. O host HTTPS real deverá ser adicionado à rede quando uma conexão efetiva for disponibilizada. A ativação remota, os 6 testes Prisma e a publicação permanecem sem comprovação.

## Entrega pública e APK standalone

O pedido de entrega inclui site público e APKs instaláveis. A sessão observada ainda não tinha projeto Supabase, hospedagem, API HTTPS ou assinatura persistente disponíveis. Não inventar links nem tratar o arquivo de código como APK. Publicar a configuração do ambiente de desenvolvimento não hospeda o site para clientes.

`python3 scripts/build-android-release.py <app> --check-only` verifica API URL/versão/assinatura sem rede; `--prepare-only` prepara sem compilar. Ambos foram verificados com assinatura sintética descartável. O build real exige `EXPO_PUBLIC_API_URL` HTTPS pública com `/api/v1`, `LIGEIRINHO_ANDROID_VERSION_CODE` e as quatro variáveis `ANDROID_RELEASE_*` documentadas em docs/android-builds.md. O helper usa release com JavaScript incorporado, assinatura persistente e readiness da API; anuncia arquivos somente após sucesso real.

O workflow `.github/workflows/android-release.yml` é manual e pode publicar os dois APKs verificados em GitHub Release quando seus requisitos estiverem disponíveis. Não disparar uma release sem API/assinatura nem dizer que o workflow executou apenas porque seu código foi enviado. Teste login e um atendimento em aparelho antes de afirmar operação funcional.
