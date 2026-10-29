# Operação

Consulte [operator-first-run.md](operator-first-run.md) para a sequência do operador: montagem, criação segura do Super Admin, cadastros e primeiro atendimento.

## Comandos gerenciados

`corepack pnpm montar` executa a montagem completa local; `--prepare-only` prepara apenas pré-requisitos e informa que a API/APKs não foram executados. Nenhum modo faz publicação. O relatório `.local/assembly-status.json` distingue etapas concluídas de bloqueadas; confira também o código de saída. Uma montagem com etapa obrigatória falha não é sucesso.

`corepack pnpm iniciar` usa builds existentes e verifica saúde HTTP; `corepack pnpm parar` verifica a identidade Linux dos processos registrados e para somente esses grupos. Processos desconhecidos e dados Docker são preservados. `corepack pnpm diagnostico` mostra presença/status sem valores de credenciais. Logs locais ficam em `.local/api.log`/`.local/web.log`, registro de processos em `.local/processes.json`; trate os arquivos como dados operacionais privados.

O acesso administrativo gerado, quando necessário, fica em `.local/acesso-local.json`, modo `0600`, somente para banco local e ambiente de desenvolvimento. Ele não substitui credenciais de um Super Admin existente. Para produção, usar o bootstrap manual por variáveis seguras. Leia o roteiro do operador antes de compartilhar qualquer acesso.

## Iniciar e verificar

Na raiz, use `node scripts/setup-local.mjs`, carregue o `.env` e inicie `docker compose up -d --wait`. A API/web são processos separados via pnpm, descritos no README. O estado em disco pode sobreviver à restauração do ambiente; processos, sessões de rede e autenticação precisam ser verificados novamente. Cada tarefa em nuvem já é isolada: use o checkout existente e não crie worktree sem pedido explícito.

`GET /api/v1/health` precisa responder com banco e Redis prontos. Porta aberta ou PID não bastam. Para ver falhas de infraestrutura use `docker compose ps` e `docker compose logs --tail 100 postgres redis`; não publique logs que contenham credenciais/dados pessoais. Verifique também que o processo da API iniciou o worker de filas.

Os temporizadores de oferta são do servidor, não do telefone. Uma retomada do aplicativo consulta o estado atual antes de permitir ações. Se Redis cair, investigar jobs, estado pendente e recuperação; não limpar a fila nem liberar entregadores manualmente por SQL. Para divergências, usar cancelamento/intervenção autorizados e preservar trilha.

## Testes com banco real

O teste de integração deve usar uma base dedicada. Nunca apontar `DATABASE_URL` para banco de produção ou para o banco local que contém dados úteis. A suíte atual cria um schema PostgreSQL aleatório e uma fila Redis exclusiva e remove somente esses recursos ao finalizar; precisa de permissão CREATE/DROP SCHEMA, adequada apenas em base de teste/desenvolvimento. Revise o arquivo de teste para saber quais dados ele cria/remove; `RUN_INTEGRATION=1` habilita uma execução real e não deve ser definido por padrão no ambiente de desenvolvimento.

Exemplo com a infraestrutura local e uma base separada (depois de carregar `.env`):

```sh
docker compose exec -T postgres createdb -U ligeirinho ligeirinho_test
# Use URL com a mesma credencial local, preservando o segredo em memória.
TEST_DATABASE_URL="${DATABASE_URL/\/ligeirinho?/\/ligeirinho_test?}"
DATABASE_URL="$TEST_DATABASE_URL" corepack pnpm db:migrate
DATABASE_URL="$TEST_DATABASE_URL" RUN_INTEGRATION=1 corepack pnpm --filter @ligeirinho/api test:integration
unset TEST_DATABASE_URL
```

Se a base já existir, não a remova automaticamente; confira que ela é descartável e reutilize com cuidado. A substituição Bash acima pressupõe o nome/caminho padrão gerado pelo setup local. Usar uma URL explicitamente configurada para teste é preferível em outras instalações. O processo de validação não deve imprimir essa URL.

## Backups e restauração

Antes de produção, definir RPO/RTO e retenção, separar acesso a backups e criptografar em trânsito/repouso. Uma rotina de exemplo de exportação criptografada está em `infra/docker/backup-postgres.sh`; depende de `age` e de destinatário configurado e precisa de validação na infraestrutura escolhida. Ela não foi agendada automaticamente.

Para testar restauração: criar banco isolado vazio, descriptografar backup com identidade protegida e passar ao `pg_restore --exit-on-error`; conferir contagens/invariantes e executar testes funcionais de leitura. Registrar data, versão PostgreSQL, tamanho, checksum do arquivo criptografado, duração e resultado. Não considerar backup válido só porque existe um arquivo e nunca restaurar sobre a base ativa para um ensaio.

Redis usa AOF local. O banco continua sendo a fonte de verdade; restauração precisa reconciliar ofertas/jobs e condições de despacho. Volumes Docker locais não são backup. `docker compose down -v` apaga volumes e não deve ser usado como reinício.

## Incidentes e manutenção

Investigar disponibilidade, fila, entregas aguardando e confirmações pendentes com responsável humano. Não desbloquear silenciosamente por tempo decorrido. O painel de manutenção global/cidade, backup agendado e alertas automáticos da especificação completa ainda não são funcionalidades operacionais entregues. Registrar procedimento temporário de contenção no proxy e responsáveis antes de expor a plataforma.

## Verificações independentes de Prisma

`corepack pnpm test:sql` aplica a migração SQL em schema temporário no PostgreSQL real e verifica constraints, escopos, índices parciais e auditoria, revertendo tudo ao final. Nesta instância, 30 verificações SQL passaram. Os quatro testes HTTP de confiança de proxy exercitam Nest/supertest de verdade, sem banco. Ambos são evidências úteis, mas não substituem os seis testes integrados Prisma/API ainda bloqueados. O resultado atual é mantido em `validation.md`.
