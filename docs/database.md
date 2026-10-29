# Banco de dados

## Fonte e migrações

O esquema autoritativo é `services/api/prisma/schema.prisma`; migrações SQL versionadas ficam em `services/api/prisma/migrations`. PostgreSQL 16 é a referência de desenvolvimento. Datas são persistidas em UTC; apresentação usa o fuso escolhido pelo operador. Dinheiro é representado em centavos inteiros, nunca ponto flutuante.

```sh
corepack pnpm db:generate
corepack pnpm db:migrate
```

Em desenvolvimento de novas alterações, gerar uma migração com `prisma migrate dev` em uma base descartável, revisar SQL e versionar. Em implantação usar exclusivamente `migrate deploy`. Não executar `db push`, resets ou edição de migrações já aplicadas em produção.

## Núcleo implementado

- `User`, `Session`: identidade, hash de senha, perfil, escopo e sessão revogável.
- `City`, `Establishment`, `Courier`: cadastros administrativos, disponibilidade e última posição.
- `CourierPreference`, `CourierBlock`: prioridades e exclusões.
- `Tariff`, `PriceQuote`: tarifa por cidade, cotação expirada e snapshot de preço.
- `DeliveryRequest`, `DeliveryStop`: atendimento, destinos e preços individualizados.
- `DispatchOffer`, `DispatchAttempt`, `DeliveryEvent`: oferta, tentativa e histórico.
- `CancellationRequest`, `Confirmation`: acordo bilateral e confirmação.
- `AuditLog`, `ChatMessage`: ações administrativas e mensagens por atendimento.

Consulte constraints/índices adicionais nas migrações. Localização usa coordenadas numéricas e cálculo geográfico; não há promessa de índice PostGIS ou geofencing nesta fase. Várias entidades da especificação completa, como planos, cobranças, anexos, custódia, permissões customizadas e backups agendados, ainda dependem de implementação própria.

## Integridade e retenção

A cotação consumida e a chave idempotente do estabelecimento devem ser únicas. Transações devem revalidar estado e prazo antes de aceitar uma oferta. Exclusões em cascata declaradas pelo esquema não definem uma política LGPD completa: o operador precisa estabelecer retenção e preservar obrigações legais/auditoria sem expor dados desnecessários.

Não editar registros financeiros ou históricos para corrigir uma divergência. Modelar ajuste explícito com motivo e trilha. A imutabilidade auditável de produção também requer permissões SQL restritas e envio independente de logs; uma tabela no mesmo banco não constitui armazenamento inviolável.
