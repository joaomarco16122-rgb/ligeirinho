# API v1

Base: `/api/v1`. JSON UTF-8. Use `Authorization: Bearer <accessToken>` para endpoints protegidos. Não registrar tokens. A documentação navegável fica em `/api/docs`; schemas Zod/controllers são a referência final dos payloads. Alguns endpoints podem estar listados no OpenAPI sem todos os exemplos de entrada.

Erros seguem status HTTP e mensagem em português; `400` para dados inválidos, `401` para sessão ausente/inválida, `403` para escopo/perfil/troca de senha pendente, `409` para conflito de estado, `429` para limite e `503` para dependência indisponível. O cliente precisa atualizar estado após conflito; não assumir sucesso offline.

## Autenticação

| Método/caminho | Entrada/resultado |
| --- | --- |
| `GET /auth/provider` | Configuração pública sem cache: `{provider,configured:true}`; Supabase inclui somente `url` e `publishableKey` validadas |
| `POST /auth/login` | `{email,password}` → `{accessToken,refreshToken,user}` |
| `POST /auth/supabase` | `{accessToken}` do provedor → sessão Nest para UID já vinculado e ativo |
| `POST /auth/refresh` | `{refreshToken}` → par rotacionado; reutilização é rejeitada |
| `GET /auth/me` | Perfil da sessão atual, sem hash de senha |
| `POST /auth/change-password` | `{currentPassword,newPassword}`; nova senha de 12–128 caracteres |
| `POST /auth/logout` | Revoga a sessão autenticada |
| `POST /auth/logout-all` | Revoga todas as sessões Nest conhecidas; o cliente também deve encerrar o provedor |

Contas novas precisam trocar a senha antes de operações de negócio. Credenciais de usuário/estabelecimento/entregador são criadas por administração, sem cadastro público.

Clientes Android consultam `/auth/provider` antes de autenticar; configuração ausente ou contraditória responde 503, sem fallback silencioso. Uma conta vinculada usa o SDK Supabase, troca prova em `/auth/supabase` e renova pelo provedor. O refresh Nest funciona somente para sessões locais. Perfil e escopo continuam vindo do banco. Veja [supabase-auth.md](supabase-auth.md).

## Administração

Requer `SUPER_ADMIN` ou `ADMIN` com escopo pertinente. Criação de cidades/admins e acesso à auditoria têm restrições adicionais no serviço.

| Método/caminho | Entrada |
| --- | --- |
| `GET/POST /admin/cities` | POST `{name,state}` (UF de duas letras) |
| `GET/POST /admin/establishments` | POST `{name,cityId,email,password,address,latitude,longitude,responsibleName?}` |
| `GET/POST /admin/couriers` | POST `{name,cityId,email,password}` |
| `GET/POST /admin/users` | POST `{name,cityId,email,password}` cria admin permitido pelo escopo |
| `POST /admin/users/:id/reset-password` | `{password,reason,confirm:true}`; motivo mínimo de 10 caracteres |
| `GET/POST /admin/tariffs` | POST `{cityId,baseCents,perKmCents}` |
| `POST /admin/blocks` | `{establishmentId,courierId,reason}` |
| `POST /admin/preferences` | `{establishmentId,courierId,priority}` |
| `GET /admin/audit` | Trilha administrativa autorizada |

## Entregas

`stops` contém de 1 a 20 objetos `{address,latitude,longitude}`. Coordenadas são números válidos e endereço não é automaticamente geocodificado. O modo local usa distância geográfica aproximada identificada, sem Google Routes ativo.

| Método/caminho | Entrada/efeito |
| --- | --- |
| `GET /deliveries` | Lista autorizada pelo perfil/escopo |
| `POST /deliveries/quote` | `{stops}` → cotação com ID, valor, distância e expiração |
| `POST /deliveries` | `{quoteId,idempotencyKey,stops?}` consome cotação; repetir chave não duplica atendimento |
| `GET /deliveries/:id` | Atendimento/destinos/estado autorizados |
| `GET /deliveries/:id/events` | Histórico de eventos do atendimento com o mesmo controle de acesso |
| `PATCH /deliveries/:id/progress` | `{status}`; sequência validada pelo servidor e perfil |
| `POST /deliveries/:id/confirm` | `{stopCount?}`; estabelecimento confirma quantidade consistente e libera conclusão |
| `POST /deliveries/:id/cancellation` | `{reason}`; antes do aceite pode cancelar, depois exige acordo |
| `POST /deliveries/:id/cancellation/approve` | Outra parte aprova cancelamento pendente |
| `POST /deliveries/:id/intervene` | Super Admin: `{action:'cancel'|'release',reason,confirm:true}` |
| `GET/POST /deliveries/:id/messages` | POST `{text}` de até 2.000 caracteres, autorizado pelo atendimento |

O entregador avança pelos estados permitidos até `AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO`; não pode marcar `FINALIZADO` para se liberar. O estabelecimento só confirma uma conclusão correspondente. Não há garantias de envio idempotente de chat ou upload de áudio/foto nesta fase.

## Entregador

| Método/caminho | Entrada/resultado |
| --- | --- |
| `GET /courier/me` | Disponibilidade e cadastro do próprio entregador |
| `POST /courier/location` | `{latitude,longitude}` atualiza posição/timestamp do próprio usuário somente online ou ocupado |
| `POST /courier/availability` | `{online,latitude?,longitude?}`; início online pode registrar GPS atomicamente, exige posição recente e não abandona oferta/atribuição |
| `GET /courier/offers` | Ofertas próprias pendentes ainda válidas |
| `POST /courier/offers/:id/accept` | Aceite atômico, sujeito ao prazo do servidor |
| `POST /courier/offers/:id/reject` | Recusa registrada e tentativa de próximo candidato |

O contador da interface é informativo. O prazo aceito é `expiresAt` conferido no servidor; o cliente nunca prolonga a oferta.

## Tempo real e recuperação

Socket.IO usa namespace `/events`, com `auth: {token: accessToken}` no handshake. `subscribe.delivery` recebe `{deliveryId}`; o servidor revalida acesso e responde com o atendimento. Atualizações `delivery.updated` incluem identificador e timestamp. A implementação atual sincroniza snapshots periodicamente; não equivale a um barramento durável com ack/retry de todos os eventos da especificação completa.

Clientes também consultam REST ao reabrir/reconectar. Falha de conexão não autoriza aceite/conclusão local. O estado recebido novamente do servidor prevalece. Push, mídia, pagamentos e rotas externas não são endpoints operacionais ativos nesta fase.

## Configurações versionadas

O catálogo é uma whitelist; não existe configuração para desligar autenticação, auditoria, validação de estado ou isolamento. Administrador de cidade pode atuar somente nos alvos da própria cidade; alterações globais exigem Super Admin. Os escopos internos são `GLOBAL`, `CITY`, `ESTABLISHMENT` e `USER`; a interface web inicial edita global/cidade.

| Método/caminho | Entrada/resultado |
| --- | --- |
| `GET /admin/settings/catalog` | Chaves, limites, escopos e descrição do efeito |
| `GET /admin/settings` | Query `{scope,scopeId?}` → valores/revisões do alvo |
| `GET /admin/settings/effective` | Query opcional `{cityId,establishmentId,userId}` → composição autorizada |
| `GET /admin/settings/:key/history` | Query `{scope,scopeId?}` → revisões anteriores |
| `PUT /admin/settings/:key` | `{scope,scopeId?,value,expectedVersion,reason,confirm:true}` |
| `POST /admin/settings/:key/rollback` | `{scope,scopeId?,toVersion,expectedVersion,reason,confirm:true}` cria nova revisão |

`scopeId` é UUID nos escopos específicos; global usa `global` ou omite identificador. Uma versão desatualizada causa `409`; atualizar/revisar antes de tentar novamente, sem sobrescrever silenciosamente. Motivo tem mínimo de 10 caracteres. Revisões anteriores permanecem preservadas.

Chaves atuais: `dispatch.offerTimeoutSeconds` (5–60s), `dispatch.maxWaitSeconds` (60–3600s), `support.phone` (informação pública) e `features.optionalProof` (booleano **reservado**). Alterar esse último não cria coleta de foto/assinatura/PIN nem torna comprovantes obrigatórios. Prazo de oferta afeta novas ofertas; o timestamp de uma oferta existente permanece congelado. Espera máxima afeta a próxima avaliação de atendimentos sem aceite.

## Relatórios do cliente web

A interface calcula resumos a partir da lista autorizada de `/deliveries`, limitada aos últimos 100 atendimentos retornados. Filtros de data/status usam dias de `America/Sao_Paulo`. Soma de finalizados e soma de todos os estados são apresentadas separadamente; nenhuma é comprovante de pagamento.

O CSV é gerado de fato no navegador, com BOM UTF-8, separador `;` e neutralização de fórmulas de planilha. Impressão/“Salvar como PDF” usa o diálogo do navegador; não há serviço de PDF fiscal ou XLSX gerado. A lista limitada não deve ser anunciada como histórico integral da operação.
