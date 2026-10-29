# Implantação gradual

Nenhum serviço público é implantado automaticamente pelo setup. Publicar o snapshot do ambiente de desenvolvimento e publicar a aplicação para usuários são operações diferentes. As etapas abaixo são um procedimento a ser validado na infraestrutura escolhida.

## Preparação

Escolher domínio, provedor, responsáveis, orçamento, política de dados, certificados, monitoramento e estratégia de recuperação. Usar PostgreSQL/Redis privados com autenticação e persistência, segredos exclusivos e serviço de backup criptografado. Concluir as pendências de segurança/produto listadas em `requirements.md` e revisar termos/privacidade. Não expor banco ou Redis diretamente à Internet.

## Build e migração

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm db:generate
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
# Em etapa única controlada, com credencial de migração:
corepack pnpm db:migrate
```

Configure `NODE_ENV=production`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `CORS_ORIGIN` e `PORT`. `NEXT_PUBLIC_API_URL` precisa estar correto no momento do build web e não pode conter segredos. Não copie `.env` de desenvolvimento. Execute a API com `pnpm --filter @ligeirinho/api start` e a web com `pnpm --filter @ligeirinho/web start`, sob supervisor com reinício e encerramento gracioso. Jobs BullMQ fazem parte da API nesta fase: não iniciar workers duplicados sem compreender locks/repetição.

O exemplo `infra/nginx/ligeirinho.conf.example` é um ponto de partida, com domínio reservado e caminhos de certificados que precisam ser substituídos. Não é configuração aplicada. Validar `nginx -t`, TLS, CORS e encaminhamento Socket.IO. A API não deve estar acessível publicamente por uma rota que contorne as proteções do proxy.

## Verificação e retorno

Aprovar saúde do banco/Redis e fluxo funcional completo em staging: cadastro administrativo, troca de senha, cotação, despacho, aceite, conclusão, confirmação e cancelamento bilateral. Testar concorrência, isolamento entre estabelecimentos e recuperação após reinício. Validar apps em dispositivos Android reais, permissões/reconexão e restrições de bateria.

Fazer backup e ensaio de restauração antes de migração relevante. Para rollback de aplicação, manter artefato anterior compatível com a migração aplicada. Migrações destrutivas precisam de plano próprio; não aplicar reset ou reverter dados automaticamente. Iniciar com um grupo pequeno, acompanhar falhas e ampliar somente com evidências.

No exemplo com Nginx no mesmo host, defina `TRUST_LOCAL_PROXY=1` no processo da API e mantenha a entrada direta bloqueada. Não habilite confiança genérica de proxy. O default não confia em `X-Forwarded-For`; sem essa configuração, um proxy local agrega clientes nos limites de requisição. Veja os testes de proxy e a seção de segurança antes de mudar a topologia.

## Imagens de aplicação e Compose opcional

Os arquivos `infra/docker/api.Dockerfile` e `infra/docker/web.Dockerfile` constroem imagens separadas em múltiplas etapas. O runtime usa usuário não root, dependências de produção e processo Node; a web usa o artefato standalone do Next.js. O alvo `migration` da API mantém a CLI Prisma para execução única com identidade de banco separada. `.dockerignore` exclui `.env`, `.local`, credenciais, dados locais, builds anteriores e pastas nativas geradas do contexto.

A imagem web `ligeirinho-web:verified` foi construída nesta instância com esse Dockerfile e validada em contêiner isolado: HTML/CSS por HTTP 200, healthcheck saudável, UID 1000 e filesystem somente leitura. Nenhum arquivo/variável de segredo local ou CA de build estava no runtime verificado. Isso não comprova a topologia inteira nem homologação de produção. As imagens da API/migração e o conjunto `docker-compose.production.yml` ainda não foram executados; a geração Prisma depende da rede aplicada. O Compose de produção não cria PostgreSQL/Redis, DNS, TLS, usuários, regras de firewall ou fornecedores. Use serviços externos/rede privada e endereços alcançáveis de dentro dos contêineres; `127.0.0.1` nesses URLs apontaria para o próprio contêiner.

Copie `infra/docker/production.env.example` para um arquivo privado **fora do checkout**, com permissão `0600`, e preencha no editor/gerenciador seguro. Use senha/identidade diferentes para migração e aplicação. Não execute a configuração de produção usando `.env` local por acidente. As variáveis obrigatórias são validadas pelo Compose, sem valores padrão de credenciais.

Exemplo de comandos, depois de definir `PRODUCTION_ENV_FILE` com o caminho do arquivo protegido (o caminho não é segredo):

```sh
docker compose --env-file "$PRODUCTION_ENV_FILE" -f docker-compose.production.yml config --quiet
docker compose --env-file "$PRODUCTION_ENV_FILE" -f docker-compose.production.yml build api web migrate
# Uma vez, antes de subir nova aplicação, com backup e plano aprovados:
docker compose --env-file "$PRODUCTION_ENV_FILE" -f docker-compose.production.yml run --rm migrate
docker compose --env-file "$PRODUCTION_ENV_FILE" -f docker-compose.production.yml up -d --wait api web
```

Não use `docker compose config` sem `--quiet` para inspeção: a saída pode incluir os segredos interpolados. O profile `tools` mantém o serviço de migração fora do `up` normal; execução explícita do serviço o habilita somente para o comando. O bootstrap inicial de produção continua dependendo de credenciais fornecidas pelo operador, e nunca usa o arquivo local de acesso gerado pelo montador de desenvolvimento.

`PUBLIC_API_URL` é um valor público de build: `/api/v1` assume que o mesmo proxy serve web e API no domínio HTTPS escolhido. Alternativamente configure uma URL HTTPS absoluta sem credenciais. Alterar esse valor exige rebuild da web. O processo da API em produção exige Google Routes configurado e não aceita silenciosamente o cálculo de distância de desenvolvimento. Habilite somente os serviços contratados e teste de verdade; os outros adaptadores ainda não são módulos operacionais completos. Veja [integration-adapters.md](integration-adapters.md).

## Proxy e confiança em contêineres

As portas publicadas pelo Compose opcional ficam somente no loopback do host. O TLS deve ser terminado pelo Nginx controlado no host; a API não deve ter outra entrada pública. A rede bridge própria `application` usa, por padrão, subnet `172.30.237.0/24` e gateway `172.30.237.1`. O Compose define `TRUST_PROXY_ADDRESS` com esse **único endereço de gateway**, mantendo `TRUST_LOCAL_PROXY=0`.

O backend aceita somente um IP exato em `TRUST_PROXY_ADDRESS`, normaliza IPv4-mapeado e rejeita CIDR, wildcard e valores inválidos. Esse endereço explícito tem precedência sobre a opção de loopback. Assim, o salto host→contêiner do Nginx pode encaminhar o IP do cliente sem agrupar todos os usuários no mesmo limite; outros peers não ganham confiança por pertencerem à mesma subnet.

Antes de criar a rede na infraestrutura escolhida, confira os blocos já usados por redes locais, serviços privados e rotas VPN. Se houver sobreposição, ajuste **ambos** `PRODUCTION_DOCKER_SUBNET` e `PRODUCTION_DOCKER_GATEWAY` no arquivo protegido, mantendo o gateway dentro do bloco. O mesmo valor de gateway será usado automaticamente na política de proxy da API. Valide o IP do salto observado na implantação real e repita os testes de cabeçalhos/limites; se a topologia fizer outro salto, configure somente esse proxy controlado, sem ampliar confiança para a rede inteira.

O exemplo Nginx original e `TRUST_LOCAL_PROXY=1` se aplicam a processos no mesmo host com peer de loopback e entrada direta restrita, deixando `TRUST_PROXY_ADDRESS` vazio. O Compose usa o IP exato da bridge em vez dessa opção. Não habilitar confiança genérica em qualquer proxy. O build da API/migração e a implantação dessa topologia ainda precisam de validação real; configuração consistente não é prova de encaminhamento operacional. A verificação isolada da imagem web não inclui esse encaminhamento.

## Proxy/CA durante builds gerenciados

O Compose monta `BUILD_CA_BUNDLE` (por padrão, `/etc/ssl/certs/ca-certificates.crt`) como secret **somente de build**. Cada etapa HTTPS usa essa confiança sem desabilitar verificação. Nenhuma CA da sessão é copiada para as camadas finais. Os passos Node de rede habilitam `NODE_USE_ENV_PROXY=1`, suporte oficial usado pelo Corepack desta imagem, preservando HTTP(S)_PROXY/NO_PROXY. Ferramentas da raiz e fechamento de dependências web/API são selecionados explicitamente; configuração de autenticação `.npmrc` não entra no contexto. O Docker mantém suas configurações de proxy/credenciais herdadas; não usar host networking nem remover proxy para contornar uma política.

Se a aplicação precisar fazer HTTPS por proxy no runtime gerenciado, monte a CA confiável como arquivo somente leitura e configure a ferramenta correspondente (Node: `NODE_EXTRA_CA_CERTS`). A imagem não incorpora credencial de proxy ou confiança específica de uma sessão. Em um ambiente de produção normal com certificados públicos, preserve as raízes normais do sistema.

Antes de release, validar os Dockerfiles na infraestrutura escolhida, executar scans nas imagens e fixar digests aprovados das imagens base. Também testar encerramento gracioso, readiness, permissões de filesystem somente leitura, migração única, rollback compatível e recuperação de banco/filas.

## Publicação isolada do site

Para hospedar apenas os arquivos públicos, use o export isolado e a imagem Nginx descritos em [site-publish.md](site-publish.md). Esse caminho não exige nem inclui credenciais PostgreSQL/Supabase no navegador. O backend operacional continua separado; a configuração estática devolve JSON 503 em `/api/v1` até conectar uma API real, preservando a distinção entre páginas publicadas e operação autenticada.


## Supabase Auth na topologia de produção

A imagem web e o Compose selecionam `AUTH_PROVIDER=supabase` explicitamente. O Compose exige `SUPABASE_URL` HTTPS e `SUPABASE_PUBLISHABLE_KEY`; repassa-os como `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` ao servidor Next e como configuração do provedor à API. O projeto real precisa existir e aceitar esse acesso. `SUPABASE_PROJECT_REF` é opcional no domínio padrão e obrigatório/coerente para domínio personalizado. A API mantém confirmação de e-mail exigida.

Esses dois valores identificam a configuração pública do Auth; não são senha PostgreSQL nem chave service-role. O schema de configuração recusa chaves secretas nesse papel. Senhas, sessões, service-role e credenciais do banco nunca entram em `NEXT_PUBLIC_*`, Docker build args ou no pacote estático. O servidor lê as configurações públicas Supabase no runtime; o endereço `PUBLIC_API_URL` continua sendo um valor de build independente.

Sem URL/chave, o Compose interrompe a montagem antes de iniciar, e as rotas SSR devem responder sem liberar acesso ou cair silenciosamente para autenticação legada. O legado permanece disponível para desenvolvimento e compatibilidade explicitamente planejada; não é o modo selecionado por estes templates de produção. O provisionamento e a vinculação autorizada entre Supabase e usuário/escopo local estão descritos em [supabase-auth.md](supabase-auth.md).

O runtime web habilita `NODE_USE_ENV_PROXY=1` para chamadas SSR do Supabase usando HTTP(S)_PROXY/NO_PROXY herdados. Em hospedagem normal, as raízes públicas do sistema servem para TLS. No ambiente gerenciado que intercepta TLS, monte uma CA confiável no runtime como somente leitura e defina `NODE_EXTRA_CA_CERTS` apontando para esse arquivo; a CA da sessão não é incorporada à imagem. Configuração de rede permite o destino do projeto e autenticação requer credenciais próprias, sem contornar o proxy.

A imagem `ligeirinho-web-auth:verified` foi reconstruída localmente com a integração Supabase e as correções de concorrência de login/logout. Os testes em contêiner verificam páginas públicas, bloqueio com configuração ausente e redirecionamento de visitante sem cookie; não comprovam login válido. A imagem `ligeirinho-web:verified` anterior e o site estático continuam sendo snapshots institucionais anteriores à integração. Ainda são necessários projeto real, migração Prisma e login/logout, renovação e isolamento de perfis em uma implantação HTTPS com evidência. Nenhuma conexão Supabase remota ou publicação externa foi estabelecida por esta documentação.
