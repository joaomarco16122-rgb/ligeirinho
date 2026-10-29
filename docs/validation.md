# Validação executada

Instância de desenvolvimento, 29/10/2026. Este relatório não representa homologação de produção nem validação de uma nova tarefa restaurada.

## Aprovado nesta instância

- `corepack pnpm install --frozen-lockfile`: instalação reproduzível com pnpm 10.20.0 e lockfile; artefatos npm verificados pelo gerenciador, TLS preservado.
- `corepack pnpm test`: **452 testes aprovados**, **6 de integração Prisma ignorados**; os 2 testes SSR reais são opt-in e foram executados separadamente. API: 82; web: 144; Android: 200; contratos compartilhados: 4; operações e preparação: 22. Há HTTP local real nos testes de proxy/readiness e SQL real separado; mocks de provedor/armazenamento não são integrações externas nem autenticação Prisma comprovada.
- `corepack pnpm lint`: ESLint 10 aprovado em todo o código fonte, testes e scripts JavaScript/TypeScript. Não depende de geração Prisma e não substitui o typecheck.
- `corepack pnpm --filter '!@ligeirinho/api' typecheck`: todos os oito pacotes selecionados aprovados. API excluída explicitamente pelo bloqueio descrito abaixo.
- `corepack pnpm --filter @ligeirinho/web build`: produção Next.js compilada e dez páginas geradas no relatório do runner, incluindo rota interna de erro.
- `CHROMIUM_PATH=/usr/bin/chromium corepack pnpm test:e2e`: **6 testes públicos Chromium aprovados**, desktop e viewport móvel. Em execução separada, `playwright test tests/browser/contracts.spec.ts`: **8 contratos UI aprovados com API explicitamente simulada**, verificando CSV/fórmulas/limite 100, foco/Escape, escrita pendente e conflito 409 com atualização/revisão. Total 14 cenários de navegador distintos. A regressão completa foi repetida após o Auth novo: os 14 passaram no modo legado explícito. Páginas públicas, navegação, campos de login, ausência de overflow horizontal e redirecionamento de painéis sem sessão. Não exercita login válido/atendimento com API.
- Exports Android Hermes de ambos os apps concluídos com SDK Supabase e polyfill, 655 módulos e aproximadamente 2,46 MB cada. Typecheck e 200 testes das duas aplicações aprovados; autenticação, armazenamento, configuração de release, ganhos/histórico/CSV/fusos e diagnóstico sanitizado incluídos. Bundle JS não é APK/AAB nem comprova uso em aparelho.
- PostgreSQL 16 e Redis 7 iniciados via Compose com volumes persistentes e portas somente loopback; healthchecks `healthy`, `pg_isready` aceitando conexões e Redis `PONG`.
- `bash scripts/check-migration.sh`: **41 verificações SQL aprovadas** no PostgreSQL real, aplicando a migração completa em esquema temporário. Índices parciais de ofertas/ocupação, idempotência, escopos, coordenadas, valores e auditoria testados. `ROLLBACK` confirmou remoção do esquema e dados; não substitui integração Prisma/API.
- Auditoria `pnpm audit --prod --audit-level high`: zero alertas moderados, altos ou críticos; um alerta baixo residual em deepmerge 4.3.1, descrito em `dependency-policy.md`.
- SDK Android36, build-tools35/36, NDK27.1, CMake3.22.1, platform-tools e Temurin JDK17 preparados em `.local`, com verificação dos checksums oficiais. Toolchain não implica APK ou teste em aparelho.
- `python3 scripts/install-android-sdk.py`: aprovado duas vezes, incluindo stdin fechado (não interativo). Ambos os helpers de build com `--prepare-only` aprovados; manifests e lockfile permaneceram idênticos por SHA256. Preparar não equivale a compilar APK.
- `corepack pnpm format:check`: estilo do código fonte aprovado pelo Prettier.
- Sintaxe dos scripts de configuração/backup e shell da CI validada; Compose validado sem imprimir credenciais.
- Revisão de código corrigiu dois vazamentos: localização em retorno idempotente de atendimento encerrado e leitura administrativa de chat sem justificativa. A correção da localização tem asserção na suíte de integração ainda não executada.

Durante os testes de navegador uma recompilação substituiu os bundles de um servidor já iniciado e causou dois redirecionamentos falharem. O processo iniciado por esta tarefa foi reiniciado com o build final e os seis testes passaram. Reiniciar o servidor após recompilar em produção faz parte das instruções de startup.

- Imagem web `ligeirinho-web:verified` construída e testada em contêiner descartável: HTML/CSS 200, healthcheck saudável, UID 1000, somente leitura e sem .env/CA de build no runtime. Contêiner de teste removido; imagem retida localmente. API/migração não construídas; topologia de produção não homologada.
- `corepack pnpm montar --prepare-only` aprovado: configuração preservada, instalação congelada, Docker saudável e SDK preparado; relatório `.local/assembly-status.json` marca expressamente `complete:false`. `diagnostico` aprovado e `iniciar` recusou cliente ausente sem iniciar serviços incompletos. `parar` preservou o servidor que não pertencia ao seu registro.

## Bloqueado / não aprovado

- `prisma generate` falhou: HTTP **403** ao buscar checksum oficial em `binaries.prisma.sh`. O domínio foi adicionado ao rascunho, mas a política efetivamente aplicada ainda não o inclui. Nenhum checksum/TLS foi ignorado. Tentativa com a opção oficial de cliente sem Rust continuou exigindo esse domínio e foi revertida.
- Build APK de debug tentou compilar o entregador: 137 tarefas nativas executadas, mas o download oficial de `react-android:0.81.5` redirecionou para `repo.reactnative.dev` e recebeu HTTP403. Domínio adicionado ao rascunho; **nenhum APK/AAB foi produzido**. Não há aparelho conectado nem `/dev/kvm` para homologação nesta máquina.
- Typecheck/build completos da API não aprovados: cliente Prisma ainda não gerado, enum/modelos ausentes causam erros. Os checks direcionados de adaptadores/proxy foram aprovados; não substituem o typecheck de todo o backend nem a integração das novas tabelas pelo Prisma.
- `prisma migrate deploy`, bootstrap de Super Admin, startup HTTP da API e **6 testes de integração real Prisma + PostgreSQL + Redis não executados**. Regras de concorrência e autorização exigem essa execução antes de liberar a operação.
- CI remota, restore em outra tarefa, publicação do ambiente, integração com fornecedores externos, teste/restauração de backup, testes em aparelhos, builds release e publicação de aplicativos não comprovados.
- O produto completo ainda tem módulos pendentes além da configuração de fornecedores: consulte `requirements.md`. O bloqueio de rede não é a única diferença entre esta primeira implementação e a especificação completa.

## Retomada necessária

1. Nas configurações do ambiente, aplicar as adições de `binaries.prisma.sh` e `repo.reactnative.dev` já salvas no rascunho. Salvar o rascunho pelo agente não aplica a rede atual.
2. Executar `bash scripts/cloud-install.sh`; observar o resultado real de geração e migração.
3. Executar `corepack pnpm typecheck`, `corepack pnpm build` e, com `.env` exportado, `RUN_INTEGRATION=1 corepack pnpm --filter @ligeirinho/api test:integration`.
4. Criar Super Admin via CLI/variáveis `BOOTSTRAP_ADMIN_EMAIL` e `BOOTSTRAP_ADMIN_PASSWORD` fornecidas de forma segura, testar troca inicial, escopos e uma jornada HTTP real antes de operar.
5. Atualizar este relatório com resultados reais. Publicar o ambiente somente após revisar/salvar a configuração e resolver os passos obrigatórios; publicação é uma operação do produto, não executada nesta tarefa.

## Ampliação desta continuação

Foram incluídos relatórios/filtros/CSV protegido e impressão pelo navegador, modais acessíveis, gestão de preferências/bloqueios/auditoria/reset, painel de configurações com versão/histórico/rollback, adaptadores Google Routes/FCM/S3/cobranças e montagem em um comando. Configurações têm testes de domínio e 11 verificações SQL adicionais; execução autenticada real dessas rotas permanece dependente do Prisma.

Uma falha de cache do pnpm apareceu ao consultar o estado do workspace em comandos paralelos enquanto manifests mudavam. A instalação congelada foi executada de forma serial e `.npmrc` passou a exigir erro, em vez de instalação automática durante scripts. A suíte completa passou em seguida. Isso não desabilita integridade de pacotes nem TLS.

Os testes de UI com fixtures não substituem os 6 testes Prisma/PostgreSQL/Redis não executados. Adaptadores de pagamentos/push/uploads ainda exigem persistência/controladores/inspeção e credenciais reais; não há ativação desses módulos apenas por sua presença no código.

## Supabase Auth e rotas protegidas — continuação atual

A fonte agora usa SDK oficial `@supabase/ssr`/`@supabase/supabase-js`, modo explícito Supabase, sessão verificada no servidor, callback PKCE, rotas `/portal`/`/admin` protegidas por perfil e tokens trocados apenas para usuários previamente vinculados por UID. Metadados editáveis pelo usuário nunca autorizam uma conta. O cadastro público não foi exposto pelo aplicativo; a configuração de signup no projeto remoto ainda não foi alterada.

- `corepack pnpm --filter @ligeirinho/web build`: aprovado com as quatro rotas dinâmicas `/auth/*` e o proxy Next. O provider/runtime é lido no servidor; configuração ausente ou contraditória falha fechada.
- `corepack pnpm test:web:auth`: **2 cenários de servidor Next real aprovados** em processos isolados. Sem configuração, rotas privadas 503; com endpoint reservado `.test` e chave sintética, visitantes sem cookie redirecionam, sessão 401, configuração pública válida e logout de mesma origem 200; outra origem 403. Isso não inclui login em Supabase real.
- Corrigido um defeito descoberto nesse teste real: Next normaliza `request.url`, e o logout recusava 127.0.0.1 legítimo. A validação agora ancora autoridade no Host real, preserva protocolo/porta e rejeita origem externa/cabeçalhos ambíguos. O mesmo cenário passou em contêiner.
- Backend Supabase: 28 testes de identidade/sessão/senha e 1 teste de custo Argon real para conta vinculada/desconhecida. São contratos com transporte/banco controlados, não conexão externa.
- `corepack pnpm test:supabase:security`: **30 verificações SQL de isolamento** e **18 das migrações Auth** aprovadas no PostgreSQL local, cada suíte em transação/schema temporário com rollback. User.supabaseUserId é único; sessões locais são preservadas, famílias Supabase são UUID únicas e registros revogados impedem recriação. O helper suporta o contêiner de serviço da CI sem expor credenciais em argumentos.
- `corepack pnpm test:sql`: os 41 checks existentes passaram aplicando todas as migrações, inclusive 005.
- Imagem Auth `ligeirinho-web-auth:verified` reconstruída após as correções de sessão: UID 1000, filesystem somente leitura, HTML/CSS públicos 200 e healthcheck. Modos sem configuração e fixture anônima foram verificados em 2 contêineres, incluindo redirects e CSRF; ambos removidos. Não houve push ou publicação.
- A imagem/site estático institucional foi validada antes da alteração Auth, mas não oferece SSR. `build:static` agora recusa flags Supabase; não se deve usá-lo como implantação de rotas autenticadas.
- O wrapper de Turbo passa a ativar o Corepack fixado antes de tarefas aninhadas; removeu o fallback global que ignorava overrides. A suíte 272 passou sem esse fallback.

Não foi criado ou ativado projeto, usuário, configuração Auth ou conexão remota Supabase: nenhum comando do plugin Supabase foi exposto nesta sessão e não havia URL/chave real em bindings/processo. Foram salvos no rascunho os nomes AUTH_PROVIDER, SUPABASE_URL e SUPABASE_PUBLISHABLE_KEY; isso não preenche valores, conecta uma conta nem aplica a rede. O host real precisará constar na política aplicada quando conhecido. O fluxo completo ainda depende também de geração Prisma e validação do backend, conforme os bloqueios anteriores. Nenhuma senha/chave real foi solicitada no chat.

## Correções de encerramento de sessão

A revisão seguinte identificou e corrigiu três falhas concretas: respostas atrasadas do SDK/SSR podiam recriar cookies depois do logout; novas trocas Supabase criavam sessões Nest independentes que sobreviviam ao logout; um login local em andamento podia aceitar a senha anterior após um reset concorrente.

As operações que escrevem cookies agora são serializadas com o logout, preservando uma nova entrada legítima. A API reutiliza uma sessão por `session_id` verificado e preserva sua revogação; a migração005 exige nova entrada somente das sessões Supabase antigas sem família. A senha local verificada é reconferida sob bloqueio antes da emissão. Cinco regressões web e seis de backend foram acrescentadas; a suíte passou com 283 testes. Os 2 cenários SSR reais e o build Next também passaram novamente. A geração Prisma e o login contra um projeto Supabase real continuam não comprovados.

O primeiro rebuild Docker desta revisão esgotou o disco pelo acúmulo de snapshots do driver VFS. A limpeza do cache de build descartável liberou espaço sem remover imagens finais nem volumes; a reconstrução seguinte e os dois contêineres de validação passaram. A imagem final tem SHA256 `7ac405543e1ec698f6b8f144f8d008d7e27e50bb72bce6d8bd49ec82c42255d5`, 290.661.989 bytes. Os testes de navegador interrompidos por falta de espaço foram retomados após a limpeza.

## Preparação de entrega pública e APKs

O pedido seguinte exige site público e APKs funcionais. Foram acrescentados Auth Supabase nativo nos dois apps, descoberta pública da API e um pipeline de release independente do Metro. A validação final do checkout passou com 452 testes; lint, formatação e os oito typechecks sem API também passaram. A instalação final `--offline --frozen-lockfile --ignore-scripts` foi reproduzida com sucesso. O typecheck completo do backend ainda depende do cliente Prisma.

Os 200 testes Android incluem SDK controlado, SecureStore em fragmentos, refresh rotacionado preservado, restaurações concorrentes, logout com respostas tardias, perfil correto e URL/versão de release. Dois smokes usam o SDK real com HTTP controlado e a implementação oficial de URL em Node. Isso não executa Hermes em aparelho nem autentica um projeto real. A revisão corrigiu a dependência de `atob` inexistente no runtime nativo e a reutilização de refresh em restaurações concorrentes.

O helper de release e workflow manual foram verificados com cinco testes de guardas, sintaxe YAML/shell/Python e uma assinatura sintética descartável. `--check-only` e `--prepare-only` dos dois apps passaram; manifests e lockfile permaneceram idênticos. O certificado padrão Android Debug foi recusado. Todas as chaves de teste foram removidas. **Nenhum APK foi produzido**, nenhuma API pública foi acessada e não houve teste em dispositivo.

Git HTTPS retornou o repositório remoto sem refs, e o teste de push em simulação passou. A chamada autenticada normal `gh api` recebeu Forbidden em `api.github.com`; esse domínio foi acrescentado ao rascunho com os dois anteriores, preservando a política restrita. A configuração observada permanece na revisão1, sem conexões Supabase/hospedagem ou variáveis de produção prontas. O rascunho registra também EXPO_PUBLIC_API_URL sem valor. Nenhuma alteração de rascunho aplica a rede ou cria hospedagem.

O destino do código é `joaomarco16122-rgb/ligeirinho`, branch `ligeirinhodelivery`. Enviar código e workflows ao repositório não comprova uma execução de CI nem publica a aplicação. Para a entrega funcional ainda faltam hospedagem conectada, projeto Supabase acessível, API HTTPS configurada, assinatura persistente, rede aplicada, compilação real e homologação em aparelho. Não existem links de site operacional ou APK validado nesta instância.
