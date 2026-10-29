# Trabalhando no Ligeirinho

Use o checkout existente; cada tarefa de nuvem já é isolada. Não crie worktrees sem solicitação explícita. A especificação de produto está em docs/product-specification.md; o escopo realmente implementado e suas lacunas estão em docs/requirements.md. Mantenha docs/validation.md fiel aos resultados executados.

Use `corepack pnpm` (pnpm10.20.0 fixado), Node22–24. No ambiente de nuvem, scripts/cloud-install.sh cria um shim local para evitar o pnpm fallback11; exporte PATH="$PWD/.local/bin:$PATH" antes dos comandos Turbo. Não substitua lockfiles ou desative verificação TLS/checksums.

API: NestJS compilado com tsc para preservar metadados de injeção; PostgreSQL/Prisma + Redis/BullMQ. Web: Next.js. Android: Expo54/RN0.81, somente Android. Nunca criar portal web para entregadores. Nunca inventar integrações ativadas ou logotipo do proprietário.

Invariantes: valor em centavos calculado no servidor; ofertas individuais com prazo do servidor; nenhuma atribuição concorrente; conclusão do entregador não libera até confirmação do estabelecimento; cancelamento pós-aceite bilateral ou intervenção Super Admin auditada; isolamento de escopos no backend; localização não deve vazar após atendimento.

Validação: `corepack pnpm typecheck`, `corepack pnpm test`, `corepack pnpm build`; integração explícita com `RUN_INTEGRATION=1 corepack pnpm --filter @ligeirinho/api test:integration` e banco/Redis. Testes ignorados não contam como aprovação. Playwright precisa de build e servidor web consistente (reinicie após recompilar). Pode usar `CHROMIUM_PATH=/usr/bin/chromium corepack pnpm test:e2e` nesta máquina.

Não imprimir credenciais nem commitar .env, SDKs, outputs de builds ou chaves Android. Configuração local pode ser gerada por scripts/setup-local.mjs e deve ser preservada se existente. Produção requer fornecedores reais, domínio/TLS, homologação e tratamento das lacunas; a primeira implementação não é uma alegação de sistema completo ou sem bugs.

A montagem local está em `corepack pnpm montar`; `--prepare-only` não executa Prisma/bootstrap/API/APKs e não representa prontidão completa. `iniciar`, `parar`, `diagnostico` controlam apenas processos registrados na instância (PID/starttime/boot). `.npmrc` exige instalação explícita congelada após mudanças de dependências, evitando mutações automáticas paralelas. Relatórios/CSV são limitados aos dados carregados; nunca afirmar totais completos de toda a operação nem pagamento recebido.

Entrega APK: debug usa Metro. Para APK independente, use `scripts/build-android-release.py` e o workflow manual Android, com API HTTPS real, versão crescente e assinatura persistente protegida. `--check-only`/`--prepare-only`, exports Hermes e artifacts de código não são APKs funcionais. Os apps descobrem Auth em `/auth/provider`, usam o SDK oficial e SecureStore; provas de refresh rotacionadas precisam ser preservadas antes da troca com a API. Não remover o polyfill de URL da primeira importação dos entrypoints nativos sem validar o runtime.
