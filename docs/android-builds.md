# Android: desenvolvimento e builds

Os apps ficam em `apps/entregador-android` e `apps/estabelecimento-android`, com Expo SDK 54/React Native e plataforma Android. Não há iOS nem portal web de entregador. Typecheck e exportação JavaScript não geram APK/AAB nem provam funcionamento em aparelho físico.

## Execução e conexão

Instale as dependências na raiz usando o lockfile. Em terminal com ambiente configurado:

```sh
corepack pnpm --filter @ligeirinho/entregador-android dev
corepack pnpm --filter @ligeirinho/estabelecimento-android dev
```

A variável pública `EXPO_PUBLIC_API_URL` precisa incluir `/api/v1`. No emulador oficial Android, `http://10.0.2.2:3001/api/v1` aponta para a máquina hospedeira. No aparelho físico, use uma URL HTTPS alcançável; `localhost` aponta para o próprio telefone. Um `.env` por app pode ser criado a partir do exemplo local, sem segredos. Compilar release com HTTPS é requisito; não permitir tráfego inseguro global para contornar configuração de rede.

GPS é solicitado explicitamente e usado em foreground nesta fase. Permissões/background location, serviço em foreground contínuo e push FCM precisam de implementação e validação nativa próprias. Aceites e conclusões só são efetivos após confirmação do servidor. Tokens são mantidos em SecureStore; não guardar senha.

## APK local de debug

Pré-requisitos: JDK 17 compatível, Android Studio/SDK, `ANDROID_HOME` e dispositivo/emulador configurados. As ferramentas nativas não são instaladas automaticamente pelo typecheck do monorepo.

```sh
cd apps/entregador-android
corepack pnpm exec expo prebuild --platform android
corepack pnpm exec expo run:android --variant debug
# APK usual: android/app/build/outputs/apk/debug/app-debug.apk
```

Repita em `apps/estabelecimento-android`. `prebuild` gera pastas nativas ignoradas pelo Git; valide e preserve alterações nativas próprias antes de regenerar. Para exportar apenas o bundle JavaScript use `corepack pnpm --filter @ligeirinho/entregador-android export:android` e o equivalente do estabelecimento. Esse artefato exige um runtime nativo compatível. Em execução automatizada restrita, use `CI=1 EXPO_NO_TELEMETRY=1` para desativar interação/telemetria; mantenha TLS e a cadeia de confiança configurados.

## EAS preview/release

Cada app inclui `eas.json`, com preview APK e produção AAB. Precisam de conta Expo do operador, associação do projeto e credenciais de assinatura próprias. Execute CLI EAS instalada/verificada na versão aprovada pelo operador; a CLI não é parte do lockfile desta fase.

```sh
cd apps/entregador-android
eas build:configure --platform android
eas build --platform android --profile preview
eas build --platform android --profile production
```

Repita no app do estabelecimento. O perfil `development` usa `expo-dev-client`, incluído nas dependências, e produz um cliente nativo de desenvolvimento. Não executar login interativo em nome do proprietário, inventar IDs de projeto ou gerar/enviar chaves de assinatura sem gestão segura.

Package IDs iniciais são `br.com.ligeirinho.entregador` e `br.com.ligeirinho.estabelecimento`; o proprietário precisa validar titularidade antes da primeira publicação, pois não são intercambiáveis após lançamento. Arquive keystore/credenciais com acesso controlado, configure versionamento e HTTPS, teste instalação limpa/atualização, permissões, reconexão, expiração e confirmação bilateral. Fornecer logo, ícones, ficha Play Store, política de privacidade, revisão de permissões e testes internos antes de distribuir.

Preview e produção exigem também `LIGEIRINHO_ANDROID_VERSION_CODE`, inteiro crescente de 1 a 2100000000. O versionamento é explícito, sem `autoIncrement` concorrente. A configuração recusa origens locais, IPs, domínios reservados, credenciais na URL e caminhos diferentes de `/api/v1`.

Nenhum APK/AAB assinado ou publicação Play Store deve ser anunciado como concluído sem artefato real, assinatura validada e teste de instalação.

## APK independente com assinatura persistente

`scripts/build-android-release.py` usa `assembleRelease`, incorpora JavaScript e verifica se o APK foi assinado pelo certificado fornecido. O caminho de debug continua voltado ao desenvolvimento com Metro. Não reutilize o certificado Android Debug para a entrega.

Forneça pelo ambiente seguro `EXPO_PUBLIC_API_URL`, `LIGEIRINHO_ANDROID_VERSION_CODE`, `ANDROID_RELEASE_KEYSTORE`, `ANDROID_RELEASE_STORE_PASSWORD`, `ANDROID_RELEASE_KEY_ALIAS` e `ANDROID_RELEASE_KEY_PASSWORD`. O keystore deve ser um arquivo privado regular, fora do código ou sob `.local`, com modo 0600. Senhas são lidas do processo; não entram em argumentos, arquivo Gradle gerado nem artefatos públicos. Mantenha backup protegido da assinatura para futuras atualizações.

```sh
python3 scripts/build-android-release.py entregador --check-only
python3 scripts/build-android-release.py estabelecimento --check-only
# Depois de confirmar a API pública, assinatura e checkout commitado:
python3 scripts/build-android-release.py entregador
python3 scripts/build-android-release.py estabelecimento
```

`--check-only` valida configuração e certificado sem rede ou build. `--prepare-only` prepara o projeto nativo e valida configuração de assinatura, mas não comprova API nem APK. O build completo exige um commit limpo e respostas reais de `/health` com banco/Redis prontos e de `/auth/provider` com autenticação configurada. Esse check não autentica uma conta nem substitui uma jornada em aparelho.

Somente depois do sucesso, o helper grava `.local/artifacts/android/ligeirinho-<app>-v<codigo>.apk`, checksum SHA256 e metadados do commit, assinatura e backend. Os metadados registram explicitamente que login externo e teste em aparelho ainda não foram executados.

## Compilação e publicação no GitHub

O workflow manual `.github/workflows/android-release.yml` compila os dois apps a partir do mesmo commit. Ele exige API pública e código de versão; o repositório precisa ter os secrets `ANDROID_RELEASE_KEYSTORE_BASE64`, `ANDROID_RELEASE_STORE_PASSWORD`, `ANDROID_RELEASE_KEY_ALIAS` e `ANDROID_RELEASE_KEY_PASSWORD`, configurados por canal seguro. Sem esses valores, interrompe antes da instalação pesada.

Após builds e verificações bem-sucedidos, os APKs ficam nos artifacts da execução. A opção manual `publish_release` publica ambos em uma nova GitHub Release e recusa sobrescrever tag existente. Downloads só devem ser anunciados depois dessa execução real. O workflow não cria hospedagem, projeto Supabase ou contas; sua presença no GitHub não comprova execução nem APK produzido.

## Autenticação nativa

Os apps incluem o SDK oficial do Supabase e descobrem a configuração pública em `/auth/provider`. Não exigem chaves privadas no APK. Renovação, restauração e logout mantêm tokens em blocos criptografados do SecureStore, preservam o refresh rotacionado e recusam o perfil do outro app. Veja [supabase-auth.md](supabase-auth.md). Os testes com SDK controlado não substituem conexão real e instalação Android.

## Ferramentas preparadas nesta instância e retomada

Foram instalados em `.local` SDK36, build-tools35/36, NDK27.1, CMake3.22.1, platform-tools e JDK17, com verificação dos arquivos oficiais. Os helpers preservam o manifest original do projeto e geram as pastas Android ignoradas pelo Git.

```sh
python3 scripts/install-android-sdk.py
python3 scripts/build-android-debug.py entregador --architectures arm64-v8a
python3 scripts/build-android-debug.py estabelecimento --architectures arm64-v8a
```

O build do entregador avançou por 137 tarefas, mas ficou bloqueado no download de `react-android:0.81.5`: redirecionamento oficial Maven para `repo.reactnative.dev`, negado pelo proxy com403. Liberar esse domínio na política aplicada antes de retomar. Não há APK produzido nem aparelho conectado; exports Hermes e prebuild não equivalem a esse resultado. APK debug eventual usa cliente de desenvolvimento e exige Metro; o helper valida sua assinatura de debug e publica o arquivo apenas se o Gradle terminar com sucesso. Produção exige fluxo de assinatura próprio e servidor real, sem reutilizar credenciais de debug.

O comando raiz `corepack pnpm dev` inicia somente API e web. Para Metro, use `corepack pnpm dev:entregador` (porta 8081) ou `corepack pnpm dev:estabelecimento` (porta 8082), sem tentar abrir aparelho automaticamente. O SDK helper foi validado repetidamente sem entrada interativa; os helpers `--prepare-only` preservaram exatamente manifests e lockfile.
