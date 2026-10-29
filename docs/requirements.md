# Escopo e rastreabilidade

A especificação mestre define o produto de destino. Esta primeira implementação entrega o núcleo operacional e clientes iniciais; não é a plataforma completa liberada para produção. O relatório de execução `validation.md` deve registrar o que realmente passou no ambiente atual. Arquivos e instruções, isoladamente, não comprovam integração ou publicação.

| Área da especificação | Situação nesta implementação | Limites/verificação necessária |
| --- | --- | --- |
| Monorepo web/API/dois Android | Estrutura e código | Build web/typecheck/testes no relatório; APK nativo separado |
| PostgreSQL/Prisma/Redis/BullMQ | Núcleo implementado | Migração e testes reais exigem serviços disponíveis |
| Bootstrap, Argon2id, sessão rotativa | Implementado no núcleo legado | Verificar integração real e fluxo de troca inicial; produção seleciona Supabase Auth |
| Supabase Auth e proteção SSR | Código de integração web/API, configuração validada e vínculo a perfis locais | Exige servidor Next; sem projeto/chave configurados ou login remoto comprovado; export estático recusa o modo |
| RBAC e isolamento | Perfis fixos e escopo de cidade/estabelecimento | Papéis customizáveis, permissões granulares e 2FA pendentes |
| Cadastros administrativos | Cidades, estabelecimentos, entregadores, admins | Campos cadastrais completos/documentos/formulários customizados pendentes |
| Cotação e preço congelado | Base + km por cidade, centavos, destinos | Rotas reais, regiões, veículos, vigência e ajustes financeiros pendentes |
| Despacho/oferta 10s/concorrência | Núcleo transacional, expiração e retentativa | Ensaios de carga/falhas distribuídas e homologação operacional pendentes |
| Preferências e bloqueios | Relação por estabelecimento/entregador | Gestão completa de horários, áreas e geofences pendente |
| Confirmação/liberação | Bilateral, cancelamento e intervenção com motivo | Autenticação reforçada e governança de produção pendentes |
| Múltiplos destinos | Destinos no atendimento e contagem consistente | Adicionar destinos após aceite/consentimento ainda pendente |
| Rastreamento | Última posição autorizada durante atendimento | Mapa real, geofences e coleta contínua background pendentes |
| Chat | Texto por atendimento | Áudio/foto/localização como mensagem, moderação e retenção configurável pendentes |
| Site/portal/admin | Interfaces funcionais do núcleo | Várias telas administrativas do produto completo ainda pendentes |
| Android | Clientes Expo com Auth Supabase/legado, SecureStore criptografado, GPS foreground, sincronização e bundles Hermes exportados; pipeline de APK standalone | API pública, assinatura persistente, builds nativos, dispositivos físicos e background/push pendentes |
| FCM/Google Maps/S3 | Adaptadores com testes; Google Routes conectado à cotação quando configurado | Sem credenciais/testes reais; FCM e S3 ainda sem rotas/módulos persistentes, Places/Geocoding pendentes |
| Pagamentos da plataforma | Contrato de adaptador, HMAC/reconciliação com testes controlados | Sem gateway real, faturas/inbox persistente ou rota pública; planos/recorrência pendentes |
| Ganhos | Valores de entregas são informativos | Não representam comprovante de pagamento; relatórios completos pendentes |
| Custódia/avaliações/suporte | Fora do núcleo inicial | Implementação de módulos, APIs e testes pendente |
| Configurações/feature flags | Catálogo limitado, escopos, versionamento, rollback e UI global/cidade | Prisma/HTTP autenticado ainda não validado; campo de comprovante é apenas reserva, sem coleta |
| Manutenção/backups no painel | Não implementados | Agendamento, retenção e proteção de operações pendentes |
| Relatórios e exportações | Resumo por data/status dos últimos 100 atendimentos, CSV real e impressão pelo navegador | Histórico completo, PDF gerado/fiscal e XLSX pendentes; valores não comprovam recebimento |
| Auditoria | Trilha persistida com proteções SQL | Separação de privilégios e retenção independente em produção |
| Operação/CI | Compose local, Dockerfiles/Compose opcional de produção, pipeline e documentação | Imagem web isolada validada (HTTP/CSS/health/nonroot); imagens API/migração, Compose de produção e CI remota ainda não validados; TLS, alertas/tracing e backup/restore reais pendentes |
| Marca e textos legais | Nome textual e textos iniciais | Logo original e revisão jurídica/operacional do proprietário pendentes |

## Bloqueio observado no ambiente atual

A geração Prisma depende do download verificado de engines em `binaries.prisma.sh`. O proxy retornou HTTP 403 por política de rede; foi salva no rascunho do ambiente a adição desse domínio. Até aplicar a alteração de rede e executar novamente geração, migração e testes com serviços reais, esses passos permanecem não validados. Não desabilitar TLS, checksums ou verificação de artefatos como atalho. O relatório de validação registra eventual resolução posterior.

## Critérios de validação do núcleo

Testar com PostgreSQL/Redis: oferta expirada não aceita, concorrência não duplica atribuição, entregador ocupado não recebe nova corrida, conclusão não libera sem confirmação, cancelamento pós-aceite requer outra parte, preço idempotente e isolamento entre estabelecimentos. Testar HTTP real/fluxo integrado além de regras puras. Contagem zero, teste desabilitado ou erro de infraestrutura não equivalem a aprovação.

Antes de produção, completar os módulos relevantes ao lançamento escolhido, revisar segurança e privacidade, homologar dispositivos Android, integrar fornecedores reais e operar um piloto controlado. Não há alegação de ausência total de bugs ou conclusão de todo o escopo mestre.

O build Android nativo também foi tentado após instalar SDK36/NDK/JDK17 oficiais. O artefato React Native foi redirecionado para `repo.reactnative.dev`, bloqueado com403. Esse domínio também está no rascunho; APK e homologação seguem pendentes.

Os contratos e limites dos adaptadores estão em [integration-adapters.md](integration-adapters.md). O painel de configurações aceita somente chaves conhecidas; não cria funções de código novas e não permite desligar proteções essenciais.

A imagem `ligeirinho-web-auth:verified` inclui a integração Supabase e as correções de sessão, com validação local de bloqueio e redirecionamento anônimo. As imagens web/site anteriores são snapshots institucionais; não oferecem evidência de login no projeto real. Consulte o relatório de validação e conclua conexão, migração e homologação antes de distribuir.
