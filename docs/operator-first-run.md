# Primeira operação assistida

Este roteiro organiza a montagem do ambiente e a criação do primeiro acesso. Ele não declara que a API ou um APK estejam prontos: veja o resultado real em [validation.md](validation.md). Cadastro e acesso a clientes dependem de a API estar saudável.

## Montagem do ambiente

No checkout existente, execute o montador de desenvolvimento:

```sh
cd /workspace/ligeirinho
corepack pnpm montar
```

O comando preserva `.env`, instala pelo lockfile congelado, verifica infraestrutura/ferramentas Android, gera Prisma, aplica migrações, cria o acesso inicial local, roda checks, compila, inicia API/web e tenta compilar APKs de debug. Toda etapa obrigatória precisa terminar com sucesso; ele interrompe na primeira falha e grava o resultado em `.local/assembly-status.json`. Downloads oficiais continuam verificados. Se parar por HTTP 403 em `binaries.prisma.sh` ou `repo.reactnative.dev`, aplique nas configurações de rede do ambiente os domínios já adicionados ao rascunho e execute novamente. Rascunho salvo e rede aplicada são estados diferentes. Não alterar checksum, TLS, proxy ou lockfile para esconder a falha.

Não remova `.env`, volumes ou registros para repetir a montagem. O arquivo local contém senhas geradas aleatoriamente e precisa permanecer fora do Git. Logs devem mostrar etapas e erros sem imprimir suas variáveis ou credenciais.

Para apenas preparar arquivos/dependências/serviços, execute `corepack pnpm montar --prepare-only`. Esse caminho para antes de Prisma, bootstrap, API e APKs, registra `preparedOnly` e não marca a montagem completa.

Depois de uma montagem completa bem-sucedida, `corepack pnpm iniciar` retoma os processos/API e web e exige resposta saudável; `corepack pnpm parar` encerra somente os processos que o montador registrou, verificando identidade e início do processo. Banco, Redis, volumes e processos de outras tarefas permanecem preservados. Não apagar `.local/processes.json` para tentar assumir ou encerrar um processo manual. `corepack pnpm diagnostico` mostra ferramentas/serviços sem imprimir segredos.

## Acesso local criado pelo montador

Se as variáveis de bootstrap não forem fornecidas, o comando completo gera uma senha aleatória para o **desenvolvimento local** e salva o acesso em `.local/acesso-local.json`, com permissão `0600`. Abra esse arquivo apenas no editor privado para consultar o acesso; não use comandos que imprimam seu conteúdo em logs e não copie para Git/chat. O nome do arquivo e seu status não são segredo; a senha é.

Isso só é permitido com banco de loopback e fora de `NODE_ENV=production`. Se um Super Admin já existia no banco, o bootstrap não o altera: mantenha a credencial anterior, pois um arquivo local novo não redefine uma conta existente. A troca de senha inicial continua obrigatória. A geração do arquivo não comprova bootstrap se a etapa correspondente falhou.

## Fornecer o primeiro acesso manualmente

Depois de migração e saúde da API aprovadas, crie o Super Admin com uma credencial definida pelo operador. Não existe senha de fábrica. Para definir o acesso por conta própria, execute o bootstrap com variáveis temporárias em um terminal Bash interativo:

```sh
set -a
. ./.env
set +a
read -r -p 'E-mail administrativo: ' BOOTSTRAP_ADMIN_EMAIL
read -r -s -p 'Senha temporária forte (12 a 128 caracteres): ' BOOTSTRAP_ADMIN_PASSWORD
printf '\n'
export BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
corepack pnpm bootstrap
unset BOOTSTRAP_ADMIN_EMAIL BOOTSTRAP_ADMIN_PASSWORD
```

A senha não aparece durante a digitação e não é escrita no comando. Guarde-a no gerenciador de senhas do operador; não no repositório ou chat. O bootstrap preserva o primeiro Super Admin existente e não redefine credenciais como efeito colateral de reinstalação.

Entre na tela de login da web com essa conta. O primeiro acesso exige troca da senha; conclua-a e entre novamente quando solicitado. Não compartilhe o Super Admin com funcionários. Contas administrativas adicionais devem ter escopo e responsabilidade definidos.

## Preparar uma cidade para o piloto

No painel administrativo, siga esta ordem:

1. Crie a cidade e UF. Use uma cidade real do piloto e confira o escopo das contas administrativas.
2. Cadastre o estabelecimento com endereço e coordenadas reais da origem, responsável e e-mail. Defina uma credencial temporária exclusiva e transmita-a por canal seguro.
3. Cadastre os entregadores da mesma cidade com contas individuais. Eles usam o app Android; não existe portal web de entregador.
4. Defina a tarifa da cidade em centavos: valor base e valor por km. Sem tarifa válida, não force uma cotação por edição manual do banco.
5. Faça login de cada novo perfil e conclua a troca de senha inicial. Revise os dados antes de operar.

O conjunto completo de campos/documentos, permissões customizadas e áreas geográficas da especificação ainda tem pendências. Não interpretar um cadastro básico como verificação cadastral ou validação jurídica concluída.

## Fazer um atendimento de homologação

Use contas, endereços e valores exclusivamente de teste até homologar a operação. O pagamento real da entrega não é processado pela plataforma neste núcleo.

No app do entregador, autorize localização durante o uso e ative a disponibilidade de forma deliberada. A API exige GPS recente; não invente coordenadas para um entregador em produção. Se não houver aparelho/build nativo disponível, registre essa etapa como não executada em vez de simular sucesso.

No portal/app do estabelecimento, informe um ou mais destinos com coordenadas, calcule a cotação e confira o valor antes de confirmar. O modo local identifica distância geográfica aproximada; não é um trajeto real do Google Routes. Uma oferta vence pelo relógio do servidor, independentemente do contador da interface.

Aceite com o entregador designado, avance pelos estados de coleta/entrega e indique a conclusão. Confirme que ele continua ocupado até o estabelecimento confirmar os destinos realizados. Depois da confirmação do estabelecimento, confira finalização e liberação. Repita cenários de recusa, expiração, segundo estabelecimento sem autorização e cancelamento bilateral.

Teste a perda/reabertura de conexão sem repetir efeitos nem mostrar ações offline como confirmadas. Intervenção administrativa exige motivo, confirmação e auditoria. Não use edição SQL para pular um estado.

## Entrega para operação real

Antes de disponibilizar a usuários: concluir os testes de integração Prisma/API, builds/instalação Android e pendências funcionais necessárias ao piloto; escolher domínio/HTTPS, revisar marca e textos legais, configurar fornecedores realmente utilizados e ensaiar backup/restauração. [requirements.md](requirements.md) diferencia código inicial, módulos pendentes e dependências externas.
