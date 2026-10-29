# Plano de implementação — Ligeirinho

## Arquitetura
Monorepo pnpm/Turborepo, Next.js no site/portal/admin, NestJS na API modular, PostgreSQL/Prisma como fonte de verdade, Redis/BullMQ para expiração e retentativas, Socket.IO autenticado para atualização. Dois aplicativos Expo/React Native Android consomem a mesma API. Não haverá portal web de entregador nem iOS.

Valores monetários são inteiros em centavos; horários UTC; autorização verificada no servidor. Confirmação bilateral mantém o entregador ocupado até confirmação do estabelecimento. Transações e bloqueios no banco serializam atribuições e transições. Integrações externas ficam desativadas sem configuração explícita.

## Árvore planejada
```
apps/web/{app,components,lib}
apps/{entregador-android,estabelecimento-android}/{App.tsx,src,app.config.ts}
services/api/{src/{auth,dispatch,deliveries,admin,realtime,common},prisma/{schema.prisma,migrations},test}
packages/{types,validation,sdk,ui,config}/src
infra/{docker,nginx,monitoring}
scripts/
tests/
docs/{architecture,requirements,api,database,security,deployment,android-builds,external-services,operations,decisions}.md
```

## Esquema inicial
User/Role/Session com escopo e revogação; City/Establishment/Courier com disponibilidade; DeliveryRequest/DeliveryStop/DispatchOffer/DispatchAttempt/DeliveryEvent com transações; PriceQuote/Tariff com snapshot financeiro; CancellationRequest/Confirmation/AuditLog com histórico. Os módulos complementares serão identificados na documentação conforme forem implementados e testados, sem declarar funcionalidades futuras como concluídas.

## Fases e evidências
1. Ambiente, contratos, persistência, migrações, bootstrap administrativo seguro, autenticação e RBAC.
2. Cotação, solicitações, ofertas com prazo do servidor, expiração e concorrência; confirmação e cancelamento bilateral.
3. Portal/admin e dois clientes Android com estados de erro e sincronização.
4. Testes unitários e de integração reais, build web, typecheck, CI, documentação operacional e configuração reutilizável do ambiente.
5. Validar integrações externas e builds Android assinados somente quando credenciais, logo, infraestrutura e ferramentas nativas estiverem disponíveis. Registrar pendências e limites com precisão.

Nenhuma fase será considerada validada apenas pela existência de arquivos. Segredos e assinatura de produção nunca entram no Git. Implantação pública e publicação do ambiente são passos separados.
