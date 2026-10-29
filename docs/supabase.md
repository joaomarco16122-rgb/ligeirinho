# Supabase como PostgreSQL gerenciado

O Ligeirinho mantém o backend **NestJS + Prisma** e Redis. Supabase pode fornecer PostgreSQL gerenciado e, no modo explicitamente habilitado, Auth com rotas protegidas descrito em [supabase-auth.md](supabase-auth.md). Não foi criado um segundo backend e não existe conexão remota comprovada apenas porque o plugin foi mencionado. Chaves secretas/service-role nunca pertencem ao navegador; uma chave publicável Auth não concede acesso às tabelas privadas.

## Configuração necessária por entrada segura

Use as configurações seguras do ambiente para valores reais. Não cole senhas ou connection strings no chat, Git, screenshots ou argumentos registrados. O validador lê os nomes abaixo e nunca imprime valores de conexão, senha, hostname ou referência do projeto:

| Variável                 | Finalidade                                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_URL`           | URL pública HTTPS real do projeto, sem chave, caminho ou parâmetros. Não é credencial PostgreSQL.                   |
| `DATABASE_URL`           | Conexão PostgreSQL do runtime Nest/Prisma.                                                                          |
| `MIGRATION_DATABASE_URL` | Conexão direta ou pooler de **sessão**, porta 5432. Obrigatória quando o runtime usa o pooler de transação 6543.    |
| `SUPABASE_PROJECT_REF`   | Somente para domínio público personalizado: referência real de 20 caracteres, para conferir o vínculo das conexões. |

Use as strings fornecidas pelo painel **Connect** do projeto real. Não invente host, região, referência, senha nem usuário. O validador confirma sintaticamente a referência do hostname direto ou do sufixo do usuário no pooler compartilhado; isso não comprova DNS, existência do projeto, autenticação ou autorização.

No pooler oficial compartilhado, o usuário contém `<papel-postgresql>.<referência-do-projeto>`. O host regional sozinho não identifica o projeto. A conexão direta usa o host exato `db.<referência-do-projeto>.supabase.co`. Domínios personalizados da URL pública exigem a referência explícita acima; o hostname PostgreSQL continua sendo conferido contra essa referência.

Não é necessária nem apropriada uma chave pública de API Supabase para autenticar o Prisma. Uma senha que o proxy substitui somente em requisições HTTPS não é uma senha PostgreSQL utilizável por conexão TCP. O script não tenta adivinhar isso pelo conteúdo da senha. Se a origem for explicitamente conhecida como proxy, a indicação opcional `DATABASE_PASSWORD_SOURCE=proxy` ou `MIGRATION_DATABASE_PASSWORD_SOURCE=proxy` faz o validador recusar essa configuração.

## Schema privado e TLS

As duas URLs precisam declarar **`schema=ligeirinho`**, **`sslmode=require`** e **`sslaccept=strict`**. Essa combinação exige TLS com verificação para o conector Prisma. O validador recusa `public`, opções conflitantes/repetidas, overrides de `search_path`, verificação desativada ou URL sem credenciais. Ele **não altera URLs existentes** nem substitui banco ou proprietário silenciosamente.

Para runtime na porta **6543**, acrescente `pgbouncer=true`; migrações não podem usar essa conexão de transação. A conexão de migração deve ser direta ou de sessão na porta **5432**, sem `pgbouncer=true`. Se o runtime já usa sessão/direta e a configuração é adequada, a mesma URL pode ser usada para migrar, sem criar variável adicional obrigatória.

Se a validação de certificado falhar, configure a CA oficial apropriada e repita o teste. Não use `sslaccept=accept_invalid_certs`, `sslmode=disable` ou desativação de TLS como correção.

No ambiente gerenciado, o acesso PostgreSQL depende de rota/permissão **TCP** para o host e porta escolhidos. Liberação de domínio na política HTTPS ou conexão de plugin não comprova acesso TCP. Não remova os proxies ou altere rotas para contornar uma negativa de rede.

## Validação offline e migração

Com as variáveis reais já injetadas de forma segura:

```sh
node scripts/supabase-prepare.mjs --check
```

Para um `.env` local ignorado pelo Git, Node pode carregá-lo como dados, sem executá-lo como shell:

```sh
node --env-file=.env scripts/supabase-prepare.mjs --check
```

A saída contém somente o modo de conexão, schema, política TLS e os nomes das fontes; declara `remoteConnectionTested: false`. Falta de configuração retorna erro sem revelar valores. Não se deve apresentar esse check como conexão Supabase funcionando.

Depois da validação e da disponibilidade dos binários oficiais Prisma, execute no ambiente com as variáveis injetadas:

```sh
corepack pnpm --filter @ligeirinho/api db:generate
DATABASE_URL="${MIGRATION_DATABASE_URL:-$DATABASE_URL}" corepack pnpm --filter @ligeirinho/api db:migrate
```

O override acima é explícito e restrito ao processo de migração; não grava ou muda a URL do runtime. A migração usa o histórico oficial `_prisma_migrations` do Prisma. **Não** copie os arquivos de migração para um wrapper e rode novamente pelo SQL Editor: isso criaria divergência/duplicação de histórico.

A geração oficial Prisma continua sendo um requisito independente. Este preparo Supabase não substitui binários não baixados, não ignora checksum e não estabelece que o Nest inicializou.

## Bloquear o acesso pela Data API

`User`, `Session`, `Courier` e dados operacionais ficam no schema privado `ligeirinho`, que **não deve** ser adicionado à lista de schemas expostos da Data API/PostgREST. O navegador e os aplicativos acessam o Nest, que aplica RBAC e isolamento. Não conceda acesso direto às tabelas usando chaves públicas ou uma chave `service_role` no cliente.

Gere o SQL de segurança revisável, sem credenciais:

```sh
mkdir -p .local
node scripts/supabase-prepare.mjs --write-security .local/supabase-security.sql
```

O comando recusa sobrescrever um arquivo existente. A geração não se conecta a serviços nem aplica alterações. Após as migrações, revise e execute o SQL como **o mesmo proprietário confiável que cria os objetos**, por exemplo no SQL Editor seguro do projeto. Não passe a URL Prisma diretamente para `psql`: parâmetros como `schema`/`sslaccept`/`pgbouncer` pertencem ao conector Prisma e não são opções libpq equivalentes.

O SQL revoga privilégios de `PUBLIC` e, quando existem, dos papéis `anon`, `authenticated` e `service_role` sobre o schema e seus objetos existentes. Revoga adições de default privileges por schema para tabelas, sequências e funções. Se um papel ainda tiver acesso ao schema por herança, o script falha e reverte, exigindo análise da associação de papéis.

**Detalhe do PostgreSQL:** o `EXECUTE` global padrão de funções para `PUBLIC` não pode ser removido apenas com uma revogação por schema. O script preserva os defaults globais do proprietário compartilhado, evitando mudar outros schemas. A revogação de `USAGE` no schema privado impede chamadas inclusive a funções novas com esse default. Reaplique o SQL depois de cada migração para revogar privilégios dos novos objetos. Não acrescente o schema à Data API nem restabeleça `USAGE` público. Um proprietário de migrações dedicado pode ter defaults globais mais restritos em uma configuração separada e revisada.

O script não cria políticas permissivas de RLS, não declara conformidade LGPD e não altera `auth`, `storage` ou outros schemas Supabase. Se houver necessidade futura de Data API, ela requer desenho de tabelas/políticas RLS específico antes de exposição; revogar RLS ou liberar todas as linhas não é solução para autorização.

## Testes disponíveis e limites

```sh
node --test tests/scripts/supabase-prepare.test.mjs
RUN_POSTGRES_SECURITY_TEST=1 node --test tests/sql/supabase-security.test.mjs
```

O primeiro verifica sintaxe, associação entre projeto/conexões, pooler, TLS, isolamento e ausência de credenciais na saída. O segundo usa o PostgreSQL **local** do Compose, aplica a migração inicial em schema temporário, simula permissões indevidas, verifica **30 invariantes de acesso**, inclusive chamadas reais sob papéis restritos, e executa rollback de schema, fixtures e papéis criados no teste. Não acessa Supabase remoto.

Persistem como verificações externas: credenciais reais, DNS/rota TCP, TLS do endpoint, privilégios do proprietário, migrações pelo Prisma, backend iniciado, testes funcionais e associação correta do frontend ao endpoint Nest publicado. Não há alegação de que essas verificações foram concluídas nesta preparação.
