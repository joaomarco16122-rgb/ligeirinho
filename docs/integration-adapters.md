# Adaptadores de integrações externas

Código em `services/api/src/integrations`. Os adaptadores possuem testes de contrato e de segurança com transportes controlados; isso **não valida credenciais, serviços reais ou entrega de notificações**. Somente o adaptador de mapas está conectado ao fluxo de cotação. Push, uploads e cobranças ainda precisam de módulos persistentes/controladores autorizados e testes reais antes de ativação no produto.

## Transporte e rede

O transporte HTTP usa `undici.EnvHttpProxyAgent`: preserva os proxies herdados, `NO_PROXY`, confiança de certificados Node e verificação TLS. Não segue redirecionamentos levando credenciais para outro destino. Cada chamada tem timeout de oito segundos. A política de rede e as credenciais são requisitos distintos; configurar uma variável não comprova autorização externa.

## Mapas e preço

- `MAPS_PROVIDER=development`: distância geográfica em linha reta entre origem e destinos, em ordem; resposta e snapshot declaram `STRAIGHT_LINE_DEVELOPMENT`, sem duração estimada. Esse modo é rejeitado com `NODE_ENV=production`.
- `MAPS_PROVIDER=google` e `GOOGLE_MAPS_API_KEY`: Google Routes `POST https://routes.googleapis.com/directions/v2:computeRoutes`, `DRIVE`, ordem preservada, máscara somente de distância e duração. O projeto Google precisa habilitar Routes API, faturamento, restrições e cotas da chave. `routes.googleapis.com` precisa de acesso na política de rede.
- Erros ou respostas inválidas do Google **não** mudam silenciosamente para linha reta nem criam cotação com outra fonte. A operação falha, sem criar solicitação.
- O preço continua calculado no servidor em centavos; snapshot inclui fonte, distância e duração quando fornecida. Não estão implementados Places, autocomplete, Geocoding ou mapa visual Google por esse adaptador.

## Push Android

`createPushAdapter` suporta `disabled` em desenvolvimento e `fcm` com `FCM_PROJECT_ID` e função injetada que devolve OAuth access token renovável. Não há senha, chave de serviço ou access token hardcoded. O operador deve fornecer autenticação usando a identidade/SDK apropriado; o adaptador não inventa credenciais e não implementa o ciclo OAuth sozinho.

O envio usa Firebase HTTP v1 em `fcm.googleapis.com`, IDs para sincronização e Android high priority com TTL curto. Resposta `accepted` significa apenas aceitação pelo FCM. Não comprova entrega, som, exibição ou abertura no aparelho. Tokens inválidos, preferências, associação de dispositivos, renovação OAuth, fila persistente e fallback de sincronização exigem integração do módulo de notificações. O modo `disabled` não afirma envio e é recusado em produção pela fábrica do adaptador.

## Mídia S3 em quarentena

`STORAGE_PROVIDER=s3`, `S3_REGION`, `S3_BUCKET`, opcionalmente `S3_ENDPOINT` e `S3_FORCE_PATH_STYLE=1`. O SDK oficial usa sua cadeia de credenciais. Assinar localmente requer credenciais reais da cadeia do SDK; placeholders de segredos substituídos apenas pelo proxy HTTPS não servem como chave local de assinatura.

A política permite JPEG/PNG/WebP até 5 MiB, áudio MP4/WebM até 10 MiB e exige estabelecimento ou entregador associado a um atendimento ativo. Administradores não ganham upload irrestrito por perfil. O backend deve carregar o atendimento do banco antes de chamar o adaptador; IDs e autorização não podem vir de um envelope confiado ao cliente.

O SDK gera POST assinado por 60 segundos com condições de tamanho, Content-Type e chave exata gerada no servidor. Nomes/caminhos do cliente e SVG/HTML são recusados. Objetos vão a `quarantine/<estabelecimento>/<atendimento>/<uuid>.<extensão>`, sem URL pública. HTTPS é obrigatório, exceto endpoint local de desenvolvimento explicitamente permitido.

**Pendente:** rota autenticada, vínculo de intenção de upload no banco, bucket privado/CORS, conclusão verificada, inspeção do tipo real/antimalware, limitação de uso e publicação após inspeção. MIME e tamanho declarados não comprovam conteúdo seguro; um upload não pode ser exibido em chat apenas porque o cliente diz que concluiu.

## Cobranças da plataforma

O conector `contract-gateway` implementa um contrato explícito para um gateway operado/integrado pelo responsável. **Não afirma compatibilidade automática com Stripe, Mercado Pago, Asaas ou outro provedor.** O operador deve implementar/validar um adaptador específico ou um gateway que cumpra este contrato:

- `PAYMENT_PROVIDER=contract-gateway`, `PAYMENT_GATEWAY_ORIGIN=https://<origem>` sem credenciais na URL, `PAYMENT_GATEWAY_TOKEN`.
- `POST /v1/platform-invoices` recebe snapshot da fatura armazenada no servidor: `id`, `establishmentId`, `amountCents`, `currency: BRL`, `payerEmail`. `Idempotency-Key` é o ID da fatura. Retorna `providerInvoiceId` e `checkoutUrl` HTTPS.
- `GET /v1/platform-payments/<id>` autenticado retorna `id`, `invoiceId`, `amountCents`, `currency: BRL`, `status` (`pending`, `paid`, `failed`, `refunded`).

Somente mensalidades/taxas da **plataforma** entram nesse conector. Ele não recebe nem liquida valores de entrega devidos ao entregador e não armazena dados de cartão.

### Contrato de webhook

O corpo bruto, limitado a 64 KiB, contém exclusivamente `eventId` UUID, `type: platform.payment.updated`, `paymentId` e `invoiceId` UUID. Campos como valor e status do webhook são recusados, mesmo com assinatura válida.

Assinatura `t=<epoch em segundos>,v1=<hex HMAC-SHA256>` sobre `<timestamp>.` seguido pelos bytes originais do corpo, com segredo de pelo menos 32 caracteres. A validação usa comparação de tempo constante e tolerância de cinco minutos para passado/futuro. Não desserializar/reconstruir o JSON antes de verificar a assinatura.

Após autenticar, o processamento carrega a fatura do servidor, consulta o pagamento pela API autenticada do gateway e exige correspondência de ID, fatura, moeda e valor. Só depois fornece reconciliação ao `DurablePaymentInbox.applyOnce(eventId,digest,reconciliation)`.

**Pendente:** implementação persistente transacional do inbox, unicidade do ID e rejeição de mesmo ID com digest diferente, controle de transições financeiras, faturas, autorização de criação e controlador de webhook com corpo bruto. Não há inbox em memória usado no runtime nem rota pública de webhook habilitada. Os testes usam um substituto de armazenamento explicitamente identificado; não comprovam idempotência em banco desse módulo.

## Verificação reproduzível

```sh
corepack pnpm --filter @ligeirinho/api exec vitest run test/integrations.test.ts
cd services/api
corepack pnpm exec tsc --noEmit --skipLibCheck --target ES2022 --module CommonJS --moduleResolution Node --esModuleInterop --experimentalDecorators src/integrations/*.ts test/integrations.test.ts
```

A suite testa validação de entrada, requests ao provedor por transporte controlado, falhas, isolamento de uploads, condições de política S3, assinatura local real pelo SDK usando credenciais fictícias, autenticidade/replay do webhook e conciliação contra snapshot. Serviços reais e dispositivo Android continuam sem validação.
