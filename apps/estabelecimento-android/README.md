# Estabelecimento Android

Aplicativo Expo SDK 54, React Native 0.81 e TypeScript. Cadastros são administrativos; este aplicativo não cria usuários.

## Desenvolvimento

Na raiz do monorepo, execute `corepack pnpm install --frozen-lockfile`. Copie `.env.example` deste aplicativo para `.env` e informe a API. `10.0.2.2` é o host do emulador Android; em aparelho físico, informe um endereço acessível ao aparelho. As variáveis `EXPO_PUBLIC_*` são públicas e nunca devem receber segredos.

```sh
corepack pnpm --filter @ligeirinho/estabelecimento-android dev
corepack pnpm --filter @ligeirinho/estabelecimento-android android
corepack pnpm --filter @ligeirinho/estabelecimento-android typecheck
corepack pnpm --filter @ligeirinho/estabelecimento-android test
CI=1 EXPO_NO_TELEMETRY=1 corepack pnpm --filter @ligeirinho/estabelecimento-android export:android
```

O segundo comando requer Android SDK, Java e emulador/aparelho disponíveis. A exportação Hermes valida o empacotamento JavaScript e **não** gera APK nem valida comportamento em aparelho.

## Compilação e publicação

Consulte `docs/android-builds.md` na raiz. Os perfis EAS `development` e `preview` geram APK; `production` gera AAB. Conta Expo/EAS, identificação do projeto, credenciais de assinatura e URL HTTPS da API são requisitos externos. Preview e produção exigem API HTTPS pública real com `/api/v1` e `LIGEIRINHO_ANDROID_VERSION_CODE` crescente. O helper `scripts/build-android-release.py` gera APK independente do Metro com assinatura persistente; veja os pré-requisitos em `docs/android-builds.md`.

## Comportamento e limites

O aplicativo descobre o provedor em `/auth/provider` e usa o SDK oficial no modo Supabase, com troca autorizada pela API; o modo legado preserva contas locais. Tokens são guardados em blocos criptografados do SecureStore; renovação é compartilhada entre requisições e o logout invalida trabalho atrasado. Configuração inválida não ativa fallback de autenticação. Aceite, conclusão e cancelamento só são considerados realizados após confirmação do servidor. O aplicativo sincroniza ao retornar ao primeiro plano e permite atualização manual. Mensagens de texto sincronizam a cada cinco segundos em primeiro plano.

A cotação usa os destinos informados e o endereço cadastrado da loja. A distância e o valor vêm do servidor. A solicitação usa chave de idempotência; o preço expira e deve ser recalculado. A confirmação final informa a quantidade de destinos e só libera o entregador após a conclusão registrada por ele.

Localização em segundo plano, FCM, mapas internos, autocomplete, anexos e notificações do sistema ainda não estão implementados. Há navegação externa por Google Maps. O relatório de valores não é comprovante de recebimento ou quitação. Não há iOS nem portal web de entregador.

## Histórico, valores e ajuda

O histórico tem filtros por dia, semana (segunda a domingo), mês, ano, intervalo personalizado e situação. As datas seguem o fuso do aparelho; finalizados e cancelados usam o encerramento, e atendimentos em andamento usam a criação. Ganhos/despesas somam somente finalizados, em centavos, e o total é ocultado se houver um valor inválido. A consulta abrange o lote atual de até 100 registros; períodos antigos podem estar incompletos.

O botão de CSV abre o compartilhamento nativo com conteúdo CSV como texto, após confirmação. O relatório neutraliza fórmulas de planilha e exclui endereços, GPS e contatos. A tela de ajuda oferece orientações e um diagnóstico compartilhável com versão, horários e situação; ele remove credenciais e parâmetros da URL e não inclui sessão nem localização. Não há envio automático para terceiros nem criação de ticket de suporte por esse botão.

Links de navegação validados abrem Google Maps ou Waze. Ao retornar ao primeiro plano, a sincronização é solicitada imediatamente; a interface mostra o último horário confirmado pelo servidor. Essas funções foram empacotadas e testadas em lógica de domínio, sem substituir testes em aparelho.
