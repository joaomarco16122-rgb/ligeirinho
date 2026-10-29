# Política de dependências

O monorepo fixa pnpm 10.20.0 em `packageManager` e versiona `pnpm-lock.yaml`. Instalação reproduzível usa `pnpm install --frozen-lockfile`. Não editar lockfile manualmente, ignorar assinaturas/checksums ou desabilitar TLS para fazer uma instalação passar.

## Correções iniciais

A auditoria identificou vulnerabilidades transitivas na árvore Next.js/NestJS/Expo. Foram adicionados overrides explícitos na raiz, com versões corrigidas publicadas, para impedir que dependências intermediárias continuassem selecionando versões vulneráveis:

| Pacote transitivo | Intervalo mínimo exigido pelo override |
| --- | --- |
| `postcss` | `^8.5.23` |
| `image-size` | `^2.0.3` |
| `multer` | `^2.5.0` |
| `deepmerge-ts` | `^8.0.0` |
| `js-yaml` | `^5.4.1` |

O lockfile registra as versões exatas efetivamente resolvidas. Overrides podem atravessar uma versão principal e precisam de evidência de compatibilidade; a instalação bem-sucedida sozinha não basta. Após essas mudanças foram novamente exercitados o build web e a exportação Hermes de ambos os apps Android, além dos checks registrados em `validation.md`. Isso verifica os caminhos exercitados, sem provar toda combinação ou dispositivo nativo.

Na auditoria de produção mais recente desta preparação, não restaram achados críticos, altos ou moderados. Permaneceu um achado baixo na dependência transitiva `deepmerge@4.3.1` (`GHSA-gcqx-w48m-w2h4`, caminho Expo → `@expo/config` → `deepmerge`), sem versão corrigida disponibilizada na fonte de auditoria naquele momento. Essa observação não é uma garantia permanente: o registro pode mudar e a árvore deve ser reavaliada em cada atualização. Não aplicar um override arbitrário ou trocar o pacote apenas para ocultar o aviso.

## Atualizações e integração contínua

A CI instala com lockfile congelado, gera o cliente Prisma, aplica migrações em PostgreSQL descartável, roda checks/testes, build e testes Playwright desktop/mobile. A auditoria de produção em job separado falha quando existem achados altos ou críticos (`pnpm audit --prod --audit-level high`). Achados inferiores também precisam de triagem periódica; passar esse limiar não significa auditoria sem avisos.

Antes de atualizar dependências: ler changelog/advisory, confirmar integridade e compatibilidade Node/Expo, atualizar lockfile por pnpm, executar os testes relevantes e registrar impacto. Para alterações de Expo/React Native, validar exportação Hermes e repetir builds/instalação em dispositivo antes de distribuir. Remover overrides somente quando a árvore normal selecionar versões seguras e a validação continuar passando.

A auditoria depende da base de avisos do registry e pode falhar por rede. Falha de consulta não equivale a resultado limpo. Não confundir auditoria de dependências com revisão de autorização, testes de concorrência, análise de segredos ou avaliação de segurança de produção.
