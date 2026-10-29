# Infraestrutura local

`docker-compose.yml` na raiz inicia apenas PostgreSQL e Redis; API/web são executadas por pnpm na máquina. Dados ficam em volumes nomeados. As portas são limitadas a loopback. Redis sem senha é aceitável apenas neste desenvolvimento local isolado; produção exige autenticação, TLS e rede privada.

Não executar `docker compose down -v` para reiniciar: essa opção apaga os dados. Use `docker compose stop` e `docker compose up -d --wait`.

Em ambientes gerenciados, manter proxy HTTPS e CA de confiança ao baixar imagens; não desabilitar TLS. O Compose não configura VPN, DNS público, certificados ou publicação.

## Imagens opcionais

`api.Dockerfile` e `web.Dockerfile` são multi-stage, rodam sem root e usam builds com lockfile congelado. `docker-compose.production.yml` na raiz consome banco/Redis externos e não fornece TLS. Siga `docs/deployment.md`; sintaxe/configuração não equivalem a image build concluído. O runtime da API não usa dados locais nem `.env` do contexto. O alvo de migração recebe uma identidade exclusiva somente na execução.

Validação desta instância: `web.Dockerfile` gerou `ligeirinho-web:verified` (288.428.785 bytes). Contêiner de teste somente leitura, UID1000, capdrop e sem segredos/CA de build no runtime serviu HTML e CSS com HTTP200 e ficou healthy; foi removido ao concluir. Não houve push nem implantação pública. API/migração e topologia Compose de produção continuam sem build/execução aprovados.

## Site estático separado

`site.Dockerfile` usa somente `apps/web/out` e `infra/nginx/site.conf`, com contexto allowlist próprio, Nginx oficial Alpine fixado por digest e runtime sem root na porta 8080. Ele não carrega a API. Rotas inexistentes devolvem 404; `/api/v1` devolve 503 JSON sem autenticação fictícia. Consulte `docs/site-publish.md`.
