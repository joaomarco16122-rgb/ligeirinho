# Arquitetura

## Organização

A plataforma usa um monólito modular NestJS. A API REST versionada controla autenticação, administração, cotações, entregas e despacho; clientes web/Android nunca decidem sozinhos se um aceite ou liberação foi efetivado. PostgreSQL/Prisma mantém o estado autoritativo. Redis/BullMQ transporta trabalho de expiração e retentativa; perder uma notificação não pode autorizar uma transição indevida.

Next.js fornece site, login, portal de estabelecimento e administração. Os dois apps Expo têm perfis separados. Bibliotecas em `packages` concentram contratos e utilitários; o backend mantém autorização e validação próprias. A árvore inicial foi planejada em [implementation-plan.md](implementation-plan.md).

## Despacho e consistência

Uma solicitação inclui um ou vários destinos do mesmo estabelecimento. O servidor calcula a cotação em centavos inteiros, congela o preço no atendimento e registra cada destino. A distância de desenvolvimento é uma aproximação geográfica explicitamente identificada; não equivale à distância por vias públicas.

O despacho seleciona entregadores online, ativos, livres, com localização recente e da cidade correspondente. Preferências e bloqueios entre estabelecimento/entregador afetam a seleção. Ofertas têm prazo do servidor (10 segundos por padrão). Aceite, rejeição, expiração e atribuição usam transações/bloqueios no PostgreSQL. Jobs podem ser executados novamente; decisões precisam reconsultar o estado autoritativo.

Um entregador permanece ocupado após indicar conclusão. Somente confirmação do estabelecimento, cancelamento bilateral aprovado ou intervenção autorizada liberam sua atribuição. Não existe liberação silenciosa por falta de confirmação. Cancelamento depois do aceite preserva a entrega ocupada até acordo.

## Segurança e limites

JWT de curta duração autentica chamadas; refresh tokens rotativos são persistidos como hash e sessões podem ser revogadas. Usuários pertencem a perfis e escopos. Cada leitura/mutação precisa conferir estabelecimento, cidade ou entregador correspondente. A sala de eventos em tempo real deve usar as mesmas restrições da REST; IDs não são autorização.

A aplicação inicial não substitui os serviços de infraestrutura: TLS é terminado no proxy, PostgreSQL/Redis de produção exigem redes privadas e backup, e mapas/push/pagamentos dependem de contratos próprios. A matriz de escopo lista o que ainda está pendente, inclusive controles administrativos e integrações não implementados.
