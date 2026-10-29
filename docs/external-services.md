# Serviços externos

O núcleo local deve funcionar sem contas externas. A aplicação não pode apresentar pagamento, push, mapa por rota ou armazenamento de mídia como ativos só porque um campo de configuração existe.

| Serviço | Uso previsto | Configuração e validação exigidas |
| --- | --- | --- |
| Google Maps Platform | Maps/Places/Geocoding/Routes | Projeto faturado, APIs habilitadas, cotas/alertas e chaves restritas por aplicação/API; teste real de rota e autocomplete |
| Firebase Cloud Messaging | Push de oferta, chat e estados | Projeto próprio, registro de dispositivos e teste físico Android foreground/background; credenciais de servidor nunca no app |
| S3 compatível | Fotos/áudios/documentos | Bucket privado, políticas mínimas, URLs assinadas com prazo, validação de mídia, limites e retenção |
| Gateway de cobrança | Cobranças da plataforma | Conta do operador, sandbox, assinatura de webhook, idempotência e reconciliação; dados completos de cartão nunca entram na plataforma |
| TLS/DNS | Acesso público | Domínio próprio, certificado válido e renovação monitorada |

Estado atual: essas integrações exigem implementação/configuração e teste antes de ativação operacional. Distância local aproximada não é rota de trânsito e ganho registrado não é pagamento recebido. Não há garantias de entrega de push sob todas as restrições de bateria/conectividade do Android.

Custos variam por fornecedor e volume. Estimar requisições de busca de endereço/rota por entrega, armazenamento e tráfego de mídia, mensagens, transações, bancos/backup e distribuição Android. Definir cotas e alertas antes de habilitar. Não introduzir chaves irrestritas em `NEXT_PUBLIC_*`/`EXPO_PUBLIC_*`; esses valores são visíveis ao usuário final.

Em ambiente gerenciado use as credenciais injetadas e destinos autorizados. Verificar nomes/presença antes de solicitar novos valores, sem imprimir segredos. Configure valores seguros nas configurações do ambiente; nunca cole credenciais no chat ou no Git.

## Rede de ferramentas de desenvolvimento

Além dos presets de gerenciadores, a política precisa incluir `binaries.prisma.sh` (Prisma, checksum/engine oficial) e `repo.reactnative.dev` (AAR nativo React Native, redirecionado oficialmente pelo Maven Central). As duas inclusões foram salvas no rascunho; precisam ser aplicadas nas configurações do ambiente. Não são credenciais nem ativações de integrações comerciais. A instalação Android usa downloads oficiais Google/GitHub/Gradle, com verificação de artefatos; não desativar TLS/checksums para resolver bloqueios.

## Adaptadores disponíveis no código

Foram adicionados adaptadores testados com transportes controlados para Routes, FCM, S3 em quarentena e gateway por contrato. Somente mapas está ligado ao fluxo de cotação, com modo de desenvolvimento explícito e recusado em produção. FCM/S3/pagamentos ainda dependem de módulos/rotas e persistência; testes controlados não validam serviços externos. Consulte [integration-adapters.md](integration-adapters.md).
