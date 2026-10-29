# PROMPT MASTER — LIGEIRINHO

Você é uma equipe sênior de engenharia de software, arquitetura, segurança, produto, UX e DevOps. Desenvolva um sistema REAL, seguro, testável e pronto para implantação gradual chamado **Ligeirinho**, inteiramente em português brasileiro. Não entregue apenas mockups. Implemente código, migrações, testes, documentação, configuração e exemplos executáveis. Não afirme que integrações externas funcionam sem credenciais ou testes reais.

## 1. Objetivo
Plataforma para estabelecimentos e deliveries solicitarem entregadores. Um entregador online e elegível recebe uma oferta por vez, inicialmente por proximidade, com 10 segundos para aceitar. Se recusar ou expirar, oferecer ao próximo. O estabelecimento acompanha em tempo real. Pagamento da entrega ocorre diretamente entre estabelecimento e entregador; cobranças da plataforma são separadas.

## 2. Produtos e perfis
- Site responsivo: página institucional, portal de estabelecimentos, suporte, login, downloads Android, termos e privacidade.
- Aplicativo Android de estabelecimentos: solicitação, acompanhamento, chat, confirmação, relatórios e suporte.
- Aplicativo Android de entregadores: ONLINE/OFFLINE, ofertas, navegação, chat, histórico, ganhos, suporte.
- Painel web administrativo: Super Admin e papéis delegados, administração de toda a plataforma.
- Não criar portal web de entregador. Não criar iOS nesta fase.
- Usar logotipo Ligeirinho fornecido pelo proprietário como referência visual; solicitar inclusão do arquivo real no repositório, sem inventar uma marca substituta.

## 3. Stack e arquitetura
Monorepo pnpm + Turborepo; Next.js/TypeScript para web; React Native/Expo (com builds nativos quando exigidos por background location e notificações) para dois apps Android; NestJS/TypeScript API; PostgreSQL/Prisma; Redis + BullMQ para jobs, timeout e distribuição; Socket.IO para eventos; Firebase Cloud Messaging para push; provedor configurável Google Maps Platform (Maps, Places, Geocoding, Routes) para mapas/endereços/rotas; armazenamento compatível S3 para mídia; provedor de pagamentos via adaptadores e webhooks; Docker Compose para desenvolvimento; OpenAPI; testes Jest/Vitest, integração e E2E. Utilizar monólito modular inicialmente, com fronteiras claras, sem microserviços desnecessários.

## 4. Árvore inicial obrigatória (expandir com os arquivos reais necessários)
```text
ligeirinho/
├── apps/
│   ├── web/                      # site, portal estabelecimento e painel administrativo
│   ├── entregador-android/       # React Native / Expo
│   └── estabelecimento-android/  # React Native / Expo
├── services/
│   └── api/                      # NestJS: REST, WebSocket, jobs
├── packages/
│   ├── ui/                       # componentes compartilhados
│   ├── types/                    # tipos, enums e contratos
│   ├── validation/               # schemas Zod/validação
│   ├── config/                   # configurações comuns
│   └── sdk/                      # cliente tipado para API
├── infra/
│   ├── docker/
│   ├── nginx/
│   └── monitoring/
├── docs/
│   ├── architecture.md
│   ├── requirements.md
│   ├── api.md
│   ├── database.md
│   ├── security.md
│   ├── deployment.md
│   ├── android-builds.md
│   ├── external-services.md
│   └── operations.md
├── scripts/
├── tests/
├── .env.example
├── docker-compose.yml
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```
Criar a árvore de arquivos interna por domínio, incluindo controllers, services, DTOs, guards, jobs, gateways, migrations, screens, hooks, components e testes.

## 5. Regras centrais de despacho
- Entregador tem status OFFLINE, DISPONÍVEL, OFERTA_PENDENTE, OCUPADO e INDISPONÍVEL_CONEXÃO. Online só significa elegível quando não ocupado, dentro de horário e área permitidos e com localização válida e recente.
- Seleção automática por proximidade geográfica/rota e elegibilidade. Alternativas configuráveis: distribuição equilibrada, prioridade manual, lista preferencial por estabelecimento e cidade. Permitir que administrador proíba um entregador de receber ofertas de um estabelecimento. Preferencial recebe primeiro; se ocupado/offline/recusar/expirar, outro elegível recebe. Se regra explicitamente exclusiva for configurada no futuro, expor comportamento com clareza.
- Oferta individual de 10 segundos por padrão, configurável; contagem validada no servidor, nunca apenas no celular. Lock/transação atômica evita dois aceites para a mesma solicitação, múltiplas ofertas conflitantes ou entregador aceitar duas entregas simultâneas. Expiração processada por job confiável e reexecutável; rejeição ou timeout encaminha ao próximo candidato. Registrar eventos e tentativas.
- Sem entregador disponível: estabelecimento pode aguardar em fila ou cancelar antes de aceite; registrar tempo de espera, tentar novamente quando elegibilidade mudar, timeout máximo configurável, despacho manual por admin.
- Estabelecimento pode solicitar automaticamente ou selecionar entregador específico elegível (se permitido); se escolhido recusar, avisar e oferecer alternativa conforme configuração.
- Suportar entregas múltiplas em um atendimento do mesmo estabelecimento, com itens de entrega individualizados, destinos, preço, horário e contagem; não criar várias corridas simultâneas para o mesmo entregador. Permitir adicionar destinos/entregas durante atendimento mediante regras claras e consentimento das partes quando valores ou escopo mudarem.

## 6. Ciclo de atendimento
Estados explícitos: SOLICITADO, BUSCANDO, AGUARDANDO, OFERTADO, ACEITO, A_CAMINHO_COLETA, NO_ESTABELECIMENTO, EM_ENTREGA, ENTREGADOR_CONCLUIU, AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO, FINALIZADO, CANCELAMENTO_SOLICITADO, CANCELADO, INTERVENCAO_ADMIN.
- Entregador marca “Entrega realizada” ao concluir as entregas; estabelecimento confirma que está tudo certo e então servidor libera o entregador (se online e elegível). Não liberar apenas por botão do entregador.
- Depois do aceite, cancelamento por entregador/estabelecimento exige solicitação, motivo obrigatório do entregador quando ele inicia, aceite de ambas as partes e trilha de auditoria. Super Admin pode intervir, cancelar ou liberar unilateralmente, com motivo, confirmação de ação sensível e registro imutável.
- O estabelecimento pode registrar quantas entregas foram realizadas no atendimento; validar consistência, evitar duplicidade e preservar histórico.
- Não exigir foto, assinatura ou PIN de entrega por padrão. Disponibilizar esses recursos como módulos opcionais habilitáveis pelo administrador, caso implementados.
- Registro opcional de itens sob responsabilidade do entregador (maquininha, dinheiro e outros): recebimento/devolução, valores, horários, anexos e confirmações bilaterais, com permissões e histórico; esse registro não é comprovante obrigatório de entrega.
- Em divergências ou falta de confirmação, mostrar pendências e permitir intervenção do administrador. Não desbloquear silenciosamente por tempo decorrido.

## 7. Funcionalidades do estabelecimento
Cadastro exclusivamente por admin, com campos customizáveis: nome fantasia, razão social, CPF/CNPJ quando cabível, responsável, contato, WhatsApp, endereço, geolocalização, logotipo e credenciais. Múltiplos funcionários por estabelecimento, limite e RBAC por usuário. Solicitar entregas por endereço digitado, busca/autocomplete, seleção de mapa e GPS; editar origem/destino; visualizar preço antes de confirmar; rastrear apenas entregadores autorizados e associados a atendimento ou conforme permissão; chat; confirmações; histórico detalhado, filtros e exportações PDF/XLSX; gráficos, despesas, suporte e avaliações.

## 8. Funcionalidades do entregador
Cadastro exclusivamente por admin, campos customizáveis (nome, CPF, telefone, endereço, foto, veículo, placa, CNH quando aplicável), login, botão ONLINE/OFFLINE, disponibilidade, alerta push com som/vibração quando permitido pelo Android, tela de oferta com nome/contato/endereço do solicitante, destino e valor, ACEITAR/RECUSAR, timer 10 segundos do servidor, navegação por mapa interno e deep links Google Maps/Waze, atualização de localização autorizada durante trabalho/atendimento, chat de texto/áudio/fotos/localização, histórico e ganhos por dia/semana/mês/ano/período customizado, avaliações, suporte, bloqueios e horários. Não prometer sobreposição de tela nem entrega de push em todas as condições do sistema operacional; implementar fallback por sincronização ao abrir app e reconexão.

## 9. Super Admin e governança
Conta inicial Super Admin criada por bootstrap seguro (variáveis de ambiente/CLI; nunca senha hardcoded); outros admins não podem rebaixar/remover Super Admin. Papéis: Admin Geral, Admin de Cidade, Supervisor, Suporte, além de papéis customizáveis; RBAC com escopo por cidade, estabelecimento e permissão. Criar usuários e redefinir credenciais com troca obrigatória no primeiro acesso. Painel de operações com mapa, lista, filtros, estados, despacho manual, intervenção e auditoria. Administração de cidades, bairros, geofences, veículos, tarifas, preferências/exclusões, horários, bloqueios, avaliações, chats de atendimento com acesso justificado e auditado, planos, pagamentos, relatórios, backups, manutenção, notificações, suporte, cadastros e configurações.
- Criar painel de feature flags e configurações dinâmicas por escopo (global/cidade/estabelecimento/usuário), com validação, permissões, versionamento e rollback. Permitir adicionar/remover campos customizados por formulário configurável. NÃO prometer criação arbitrária de novas funções de código apenas por interface; mudanças estruturais requerem atualização de software.
- Ações de admin sensíveis devem pedir motivo, confirmação, autenticação reforçada quando apropriado e log de auditoria. Dados financeiros históricos não devem ser reescritos silenciosamente.

## 10. Preços, ganhos e monetização
Tarifas definidas pelo administrador: fixo, por km, base + km, bairro/região, veículo, cidade e vigência. Definir regra de prioridade e arredondamento, distância calculada por rota quando disponível e fallback claro. Exibir cotação antes da solicitação, congelar preço aceito como snapshot, registrar ajustes e motivo. Pagamento de cada entrega é diretamente entre estabelecimento e entregador; plataforma não custodia nem liquida esse dinheiro. Ganhos do entregador são registros de valores de entregas concluídas, NÃO comprovante de recebimento. Planos de plataforma: gratuito, mensalidade, taxa por entrega, isenções e regras por estabelecimento/cidade. Métodos de cobrança da plataforma: PIX manual, PIX via gateway, cartão, boleto, recorrência quando suportada. Integrar provedor por interface; usar webhooks autenticados, idempotência, conciliação e estados de pagamento. Não armazenar dados completos de cartão. Integração real requer conta e credenciais do operador.

## 11. Comunicação e notificações
Chat em tempo real por atendimento com texto, áudio, imagem e compartilhamento de localização; autenticação, autorização, limites de tamanho, moderação, retenção e acesso administrativo justificado e auditado. Notificações push para ofertas, chat, mudanças de status, suporte, cobranças e comunicados; segmentos todos/entregadores/estabelecimentos/cidade/indivíduo; histórico e preferências. Configuração de som/vibração sujeita ao Android e consentimentos. Timeout de ofertas sempre controlado pelo backend.

## 12. Segurança, LGPD e operação
TLS/HTTPS, hash de senha Argon2id, 2FA configurável, refresh token rotativo, revogação de sessão, rate limits, validação de entrada, RBAC no backend, isolamento entre estabelecimentos/cidades, proteção de upload, segredo fora do repositório, auditoria e políticas de retenção. Coletar localização somente para finalidades declaradas e durante estados apropriados; consentimento/permissões do Android, indicadores visíveis, acesso mínimo e política de privacidade. Não permitir que configurações desliguem proteções essenciais. Incluir orientações de adequação LGPD sem afirmar conformidade jurídica automática.
- Offline: cache local seguro, indicador sem conexão, fila idempotente apenas para operações adequadas, sincronização e reconciliação; não confirmar aceite, conclusão ou rastreamento como efetivados sem confirmação do servidor.
- Backups criptografados, retenção, teste de restauração, alertas; modo manutenção global ou por serviço/cidade, mantendo operações em andamento quando seguro.
- Logs estruturados, métricas, tracing básico, alertas e health checks. CI com lint, typecheck, testes, scan de dependências e build. Documentar custos e limites das APIs de mapas/push/pagamento.

## 13. Telas e UX
Criar design system coerente com logo enviada, acessibilidade, responsividade, estados vazios, carregamento, erros, reconexão e confirmação de ações críticas. App entregador: login, home/status, oferta, entrega ativa, mapa, chat, histórico, ganhos, perfil e suporte. App estabelecimento: login, dashboard, solicitar, cotação, aguardando, acompanhamento, chat, confirmação, histórico, relatórios, equipe e suporte. Web: institucional, login, portal, dashboard Super Admin, operações, mapa, usuários, estabelecimentos, entregadores, cidades, tarifas, distribuição, áreas, horários, veículos, planos, cobranças, chats, suporte, avaliações, notificações, permissões, logs, configurações, backups e manutenção.

## 14. Modelo de dados mínimo
Entidades: User, Role, Permission, UserRole, Session, TwoFactorMethod, City, Neighborhood, ServiceArea, Establishment, EstablishmentMember, Courier, Vehicle, CourierAvailability, CourierLocation, WorkSchedule, DeliveryRequest, DeliveryStop, DeliveryAssignment, DispatchOffer, DispatchAttempt, DeliveryEvent, CancellationRequest, Confirmation, CustodyItem, CustodyEvent, Tariff, TariffRule, PriceQuote, CourierPreference, CourierBlock, EstablishmentBlock, ChatThread, ChatMessage, MessageAttachment, Notification, PushDevice, Rating, SupportTicket, TicketMessage, SubscriptionPlan, Subscription, PlatformInvoice, PaymentTransaction, PaymentWebhookEvent, Referral, FeatureFlag, Setting, CustomFieldDefinition, AuditLog, MaintenanceWindow, BackupJob. Definir chaves, índices geoespaciais apropriados, FKs, constraints, soft delete onde fizer sentido, snapshots financeiros e timestamps UTC. Não armazenar senha em texto puro.

## 15. APIs e eventos
REST versionada /api/v1 com documentação OpenAPI e WebSocket autenticado para localização, despacho, aceite, recusa, chat, confirmação, notificações e intervenção. Separar APIs por domínio e aplicar autorização em cada operação. Eventos com IDs, timestamp, correlação, ack/retry e idempotência. Validar concorrência em aceites, liberações e cancelamentos. Testar corrida entre timeout e aceite.

## 16. Fluxo de implementação obrigatório
1. Inspecionar repositório e ativos fornecidos; escrever plano e árvore final de diretórios antes de implementar.
2. Criar monorepo, ambiente local, migrations, seed seguro e documentação .env.example sem segredos.
3. Implementar auth/RBAC, cidades, estabelecimentos, entregadores e permissões.
4. Implementar tarifas, cotação, estados de entrega, distribuição com Redis, timeout e testes de concorrência.
5. Implementar site/portal, apps Android, GPS/mapas, push, chat, confirmação bilateral, intervenção administrativa.
6. Implementar múltiplas entregas, relatórios, áreas, preferências, bloqueios, suporte, avaliações, pagamentos da plataforma, notificações e configurações dinâmicas.
7. Adicionar testes, CI, observabilidade, backups, implantação e builds APK/AAB.
8. Fornecer instruções exatas para iniciar, migrar banco, popular dados de demonstração, executar testes, criar APK de debug/release e publicar com segurança.

Se não houver credenciais externas, construir adaptadores e modo de desenvolvimento claramente identificado, nunca fingir que pagamentos, push ou rotas reais estão ativos. Não inventar chaves nem embutir segredos. Quando algo depender de decisão do proprietário ou requisitos legais, registrar em docs/decisions.md e seguir com padrão seguro reversível. Entregar progresso incremental funcional, testes executados e pendências verificáveis. Não dizer “100% pronto” sem comprovação.

## 17. Critérios de aceite
- Entregador online elegível recebe oferta de 10 segundos; expiração encaminha ao próximo, sem duplicação.
- Aceite concorrente não atribui mesma entrega a dois entregadores.
- Entregador ocupado não recebe outra corrida.
- Entregador só é liberado após sua conclusão + confirmação do estabelecimento, ou intervenção autorizada de Super Admin.
- Cancelamento pós-aceite exige acordo bilateral ou intervenção administrativa auditada.
- Múltiplas entregas para um estabelecimento são contabilizadas individualmente.
- Estabelecimento rastreia entregador autorizado durante atendimento, com privacidade.
- Tarifas e prioridades respeitam configurações e exclusões administrativas.
- Relatórios de ganhos não afirmam pagamento recebido.
- Usuário de um estabelecimento não vê dados privados de outro.
- Painel Super Admin gerencia usuários, permissões, cidades e recursos configuráveis.
- Builds Android e web são reproduzíveis com documentação e testes.

**Comece agora:** apresente a arquitetura, a árvore de diretórios expandida, o esquema inicial do banco, o plano por fases e então implemente a primeira fase diretamente no repositório. Continue de forma incremental, executando testes a cada fase, e sinalize dependências externas sem bloquear o desenvolvimento local.
