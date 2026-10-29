# Publicar o site e conectar a operação

Há dois modos distintos de entrega: **site estático público** e **Next.js com servidor e Supabase Auth**. Rotas protegidas no servidor exigem o segundo modo. O site estático é uma entrega separada do sistema operacional. HTML/CSS/JavaScript exportados podem ser hospedados como arquivos; login, despacho, localização, chat e administração continuam dependendo da API real. Supabase PostgreSQL pode fornecer persistência privada para essa API, mas não transforma automaticamente as rotas NestJS, o worker Redis ou os aplicativos em serviços publicados.

## Artefato do site

O exportador recusa `AUTH_PROVIDER=supabase`, seleção pública Supabase, flags conflitantes ou provedor inválido. Não transforma autenticação de servidor em JavaScript público nem publica silenciosamente um artefato antigo. A exportação isolada do modo legado fica em `apps/web/out`, gerada por `corepack pnpm --filter @ligeirinho/web build:static` e conferida por `corepack pnpm --filter @ligeirinho/web verify:static`. Ela precisa ser gerada antes de empacotar/publicar; não copie `.env`, `.local`, `node_modules`, contas administrativas ou credenciais do Supabase. Valores `NEXT_PUBLIC_*` são públicos e não podem conter senha do banco, service-role key ou token secreto.

A imagem `infra/docker/site.Dockerfile` copia somente o conteúdo exportado e a configuração Nginx estática. Usa o Nginx oficial Alpine versionado e fixado pelo digest verificado, usuário não root, porta 8080 e diretórios temporários em `/tmp`, compatíveis com filesystem somente leitura. A imagem não contém API, banco ou acesso administrativo. O healthcheck acessa somente o próprio loopback, explicitamente sem encaminhá-lo ao proxy herdado do Docker; isso não altera o acesso externo. O arquivo de ignore específico do Dockerfile permite somente o export e a configuração estática, mesmo quando o ignore geral exclui pastas `out`.

```sh
docker build -f infra/docker/site.Dockerfile -t ligeirinho-site:local .
docker run --rm --read-only --tmpfs /tmp:mode=1777 \
  --cap-drop ALL --security-opt no-new-privileges:true \
  -p 127.0.0.1:13001:8080 ligeirinho-site:local
```

Os endereços locais servem para validação interna. Publicação pública exige hospedagem escolhida, domínio e HTTPS. Esses comandos não configuram DNS/certificado nem enviam a imagem/arquivos a um serviço externo. A saída de build não é confirmação de publicação.

A configuração serve rotas como `/login`, `/termos` e `/privacidade` a partir dos HTML correspondentes e devolve 404 para caminhos desconhecidos. Assets de build usam nomes versionados. Não há fallback universal para `index.html`, que poderia mascarar erros de rota.

## Supabase Auth exige servidor Next.js

O modo `AUTH_PROVIDER=supabase` usa cookies/SSR, valida o usuário no provedor e aplica proteção antes de servir `/portal` e `/admin`. Ele precisa de processo Next.js, URL HTTPS do projeto e chave **publicável** configurados; não pode ser hospedado como apenas HTML no Nginx estático. A imagem `web.Dockerfile`/Compose de produção seleciona esse modo explicitamente. O Nginx estático não executa cookies/SSR nem pode ser anunciado como proteção dessas rotas.

Sem configuração Supabase válida, o caminho de autenticação deve falhar sem cair para login legado. URL/chave ausentes não autorizam usar service-role, inventar um projeto ou confirmar sessão localmente. O backend também valida a identidade do provedor antes de trocar por sessão da API e mantém os próprios vínculos, perfis e escopos. Consulte [supabase-auth.md](supabase-auth.md) e [deployment.md](deployment.md).

O export e a imagem estática anteriormente validados foram produzidos antes da nova integração SSR. Continuam sendo uma entrega de páginas públicas, não uma evidência da versão autenticada atual ou de conexão real Supabase.

## API explicitamente indisponível

Sem backend conectado, `/api/v1` e `/api/v1/*` devolvem HTTP **503** com JSON `API_INDISPONIVEL` e cache desabilitado. Uma tentativa de login não recebe HTML nem sucesso fictício. Isso é um limite deliberado do site estático; não é autenticação funcionando.

Para habilitar operação: implantar a API NestJS e o worker com PostgreSQL/Redis reais, concluir migrações/integração, configurar segredos no servidor e expor a API por HTTPS. Depois, conectar `/api/v1` ao backend autorizado no proxy/hospedagem ou exportar novamente com a origem pública correta. Rever CORS, confiança de proxy e testes de isolamento; não colocar credenciais privadas no navegador para acessar o banco diretamente.

## Supabase

Configure a conexão PostgreSQL do projeto Supabase **somente no ambiente privado da API**, com identidade e permissões adequadas, TLS e URL suportada pelo Prisma. Uma URL do projeto ou chave pública não substitui essa conexão nem comprova migrações. Credencial de migração e credencial de runtime devem ter funções separadas quando a infraestrutura permitir.

O projeto Supabase precisa existir e estar acessível com credenciais fornecidas de maneira segura. Preparar arquivos não cria remotamente um projeto, aplica SQL, publica o site ou testa um banco externo. Não imprimir URLs com senha e não incluir credenciais de banco ou service-role no pacote do site. Os resultados efetivamente comprovados estão em [validation.md](validation.md); o escopo completo continua em [requirements.md](requirements.md).

## Verificação nesta instância

A imagem local `ligeirinho-site:verified` foi construída com digest oficial fixado (63.363.342 bytes) e executada com UID 101, filesystem somente leitura, tmpfs e capabilities removidas. Requisições reais verificaram HTML, CSS e navegação com HTTP 200; caminho inexistente e arquivo oculto retornaram 404. `/api/v1`, sua variante com barra e POST de login retornaram 503 JSON com `no-store`. O healthcheck ficou saudável após ajustar o wget para consultar diretamente o próprio loopback.

Os nomes privados de ambiente e arquivos locais de sessão verificados estavam ausentes. O contêiner de teste foi removido e a imagem permanece somente na máquina; nenhum site foi publicado externamente, nem conexão remota Supabase foi comprovada por essa verificação. Esses resultados validam a entrega estática local, não o backend operacional.
