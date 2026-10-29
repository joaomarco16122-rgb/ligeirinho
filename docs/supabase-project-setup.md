# Projeto Supabase exclusivo — Ligeirinho

> Registro verificado em 2026-10-29. Este documento não comprova implantação pública.

## Projeto remoto

- Nome: `ligeirinho-delivery`
- Project ref: `rolqnjetxrrotvdifwzk`
- Região: `sa-east-1` (São Paulo)
- URL pública de Auth: `https://rolqnjetxrrotvdifwzk.supabase.co`
- Status observado: `ACTIVE_HEALTHY`
- Chave **publishable** moderna ativa: disponível no painel Supabase > Project Settings > API Keys. Não copie chaves secretas/service-role para o repositório.
- Segurança: verificação remota do Supabase sem alertas na data acima.
- Banco `public`: sem tabelas de aplicação na data acima.

## Separação de responsabilidades

O projeto Supabase fornece **Auth**. A API NestJS/Prisma mantém a autoridade sobre usuários vinculados, perfis, permissões, pedidos, estabelecimentos e entregadores, conforme `docs/supabase-auth.md`. **Não** recrie tabelas operacionais do Nest diretamente no schema `public` do Supabase sem uma migração de arquitetura aprovada.

O projeto de chamados de TI é independente e não deve ser alterado, migrado ou reutilizado.

## Configuração segura para homologação

No ambiente **privado** da API e da web, configure:

```dotenv
AUTH_PROVIDER=supabase
SUPABASE_URL=https://rolqnjetxrrotvdifwzk.supabase.co
SUPABASE_PROJECT_REF=rolqnjetxrrotvdifwzk
SUPABASE_PUBLISHABLE_KEY=<obter chave publica ativa no painel Supabase>
```

A chave publishable é pública, mas não é necessário registrá-la neste documento. Nunca use a chave service-role/secret no lugar dela. A web e os aplicativos devem consumir a configuração pública pelos caminhos já previstos no código. Não inserir tokens de sessão, senhas, `DATABASE_URL`, `JWT_SECRET` ou chaves privadas em `NEXT_PUBLIC_*`, `EXPO_PUBLIC_*` ou no Git.

A conta Supabase precisa ser criada/confirmada e **vinculada explicitamente** ao usuário operacional Nest; login Supabase isolado não concede papel de Super Admin. Planeje o primeiro acesso administrativo antes de forçar `AUTH_PROVIDER=supabase` em produção.

## Pendências para publicação real

1. Hospedar PostgreSQL operacional compatível com Prisma e Redis privados, com backup e política de acesso. A criação deste projeto Supabase não executou migrações Prisma nem migrou dados.
2. Configurar API NestJS e Next.js em hospedagem com domínio, HTTPS, DNS, proxy e segredos protegidos.
3. Aplicar migrações da API com credencial de migração distinta da conta de execução; realizar bootstrap e vínculo de contas com segurança.
4. Configurar serviço de rotas externo exigido pela API de produção e testar seu uso.
5. Executar lint, typecheck, testes unitários, integração real PostgreSQL/Redis, E2E autenticado e fluxo ponta a ponta.
6. Validar APKs assinados em aparelhos Android reais antes de distribuir.

**Não concluído:** publicação de site/API, migrações Prisma, criação de usuários operacionais, login remoto ponta a ponta, APKs e homologação.

Referências: `docs/deployment.md`, `docs/supabase-auth.md`, `docs/validation.md`.
