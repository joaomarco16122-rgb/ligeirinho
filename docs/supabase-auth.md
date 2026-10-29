# Supabase Auth e sessões protegidas do Ligeirinho

O modo Supabase usa Auth como provedor de identidade e mantém Nest/Prisma como backend de permissões, estabelecimentos e entregas. Código preparado não comprova que um projeto remoto foi configurado: URL, chave publicável, contas, migrações e testes reais continuam requisitos independentes.

## Configuração

Configure por entrada segura:

- `AUTH_PROVIDER=supabase`, ou `SUPABASE_AUTH_ENABLED=1` para habilitar a ponte da API durante uma transição controlada. O valor `AUTH_PROVIDER=legacy` permanece disponível em desenvolvimento para contas locais ainda não vinculadas.
- `SUPABASE_URL`: origem HTTPS pública real do projeto, sem credenciais/caminhos/parâmetros. Domínio personalizado exige `SUPABASE_PROJECT_REF` explícito.
- `SUPABASE_PUBLISHABLE_KEY`: chave publicável. `SUPABASE_ANON_KEY` é alternativa para projetos com chave pública legada; não use uma chave secreta/service-role nessa variável.
- `SUPABASE_REQUIRE_EMAIL_CONFIRMED=1` por padrão. Contas anônimas são recusadas. Desativar a exigência de e-mail requer decisão explícita do operador, sem alterar a autorização por vínculo e perfil.

A API faz requisições HTTPS pelo transporte com proxy/CA herdados, timeout e redirecionamentos desativados. O host precisa estar autorizado na política de rede. O corpo enviado pelo cliente fornece somente o access token; nunca URL de destino, papel, escopo ou credencial de administração.

## Login e autorização

1. O cliente autentica no projeto Supabase configurado.
2. Envia `POST /api/v1/auth/supabase` com `{ "accessToken": "<token de acesso real>" }`, por TLS e sem registrar o token.
3. A API consulta **`GET /auth/v1/user` no projeto configurado**, com chave pública e Bearer. Não confia em um usuário que veio do navegador nem apenas em decodificação local do JWT.
4. Depois da aceitação pelo provedor, confere `sub` e `exp` desse token contra o UID verificado, exige prazo válido, valida o UUID `session_id` e procura **`User.supabaseUserId` exato e ativo**. O identificador de sessão vem do token aceito pelo provedor; não há campo de família fornecido separadamente pelo cliente.
5. Retorna o contrato Nest existente `{accessToken, refreshToken, user}`. O papel, cidade e estabelecimento vêm do banco Ligeirinho; `user_metadata.role` e `app_metadata.role` não elevam permissões na API.

Não há criação nem vinculação automática por e-mail. Um usuário Supabase novo não ganha acesso operacional por conseguir se cadastrar. Metadados `app_metadata` controlados por administrador podem orientar navegação SSR após validação pelo provedor, mas o papel persistido no Nest é a autoridade para operações/dados. Metadados editáveis pelo usuário não devem autorizar rotas.

### Duração e renovação

A migração `202610290004_supabase_auth` acrescenta UID único e `Session.authProvider` (`local` ou `supabase`, local por padrão para registros antigos).

A migração `202610290005_supabase_sessions` acrescenta `Session.supabaseSessionId` e uma chave única por usuário e sessão do provedor. Recarregar a página ou renovar o token reutiliza a mesma sessão Nest, sob bloqueio da linha do usuário; não cria sessões independentes que sobrevivam ao logout. O registro revogado é preservado: apresentar outro access token da mesma sessão Supabase não reabre uma sessão Nest encerrada. Uma nova entrada no provedor cria um novo `session_id`. Não remova esses registros revogados enquanto a família externa ainda puder apresentar tokens válidos.

Na atualização de uma instalação anterior, a migração encerra somente sessões Supabase antigas que ainda não tinham esse identificador. Isso exige nova entrada dessas contas; sessões locais e vínculos de usuário são preservados.

O access JWT Nest dura no máximo quinze minutos e nunca ultrapassa o `exp` da prova Supabase usada naquela troca. O prazo do registro de sessão pode ser estendido mediante nova prova verificada da mesma família; uma aba com token mais antigo não encurta um prazo já comprovado por outra aba. O refresh Nest dessa sessão é recusado: o cliente precisa renovar sua sessão pelo SDK Supabase e apresentar nova prova em `/auth/supabase`. A resposta mantém um refresh opaco por compatibilidade de contrato, mas esse valor não renova uma sessão Supabase na API. Nenhum refresh token do provedor é armazenado no servidor.

Sessões locais não vinculadas mantêm sua política de renovação. As contas explicitamente vinculadas não aceitam o hash Argon antigo como fallback de login; isso evita que a alteração de senha externa reative uma senha temporária local antiga. Os aplicativos Android agora descobrem o provedor da API e incluem o fluxo Supabase, preservando o modo legado quando explicitamente selecionado no servidor.

### Clientes Android

Ambos os aplicativos consultam `GET /api/v1/auth/provider` pela API configurada em `EXPO_PUBLIC_API_URL`. A resposta é uma whitelist pública sem cache; URL/chave Supabase inválidas ou seleção contraditória interrompem o login. Nenhuma chave administrativa deve estar no aplicativo.

No modo Supabase, o SDK oficial autentica e renova a prova; o backend decide o perfil pelo vínculo no banco. O aplicativo recusa contas que pertencem ao outro perfil. Tokens do provedor e do Nest ficam em registros criptografados do SecureStore, divididos em blocos para respeitar o limite por item. Senhas não são persistidas. O SDK usa sessão em memória, sem AsyncStorage ou renovação autônoma fora do controle do aplicativo.

Login, renovação, restauração e logout são coordenados para que respostas antigas não restaurem uma conta encerrada. Restaurações concorrentes compartilham a mesma operação. Tokens de refresh recém-rotacionados são persistidos antes da troca com a API; falha transitória nessa troca permite tentar novamente com a prova atual. Esses fluxos têm testes de contrato com SDK/armazenamento controlados; o login no projeto real e a instalação em aparelho continuam pendentes.

Não há promessa de revogação externa instantânea: JWTs Supabase podem permanecer válidos até o prazo definido pelo provedor mesmo após invalidar refresh tokens. A verificação remota e os limites descritos não substituem essa semântica. Revogação das sessões Nest é aplicada no banco a cada operação autenticada.

## Vínculo administrativo explícito

`POST /api/v1/admin/users/:id/link-supabase`, exclusivo Super Admin autenticado no Nest:

```json
{
  "supabaseUserId": "<UUID real confirmado no projeto>",
  "reason": "Motivo administrativo com pelo menos dez caracteres",
  "confirm": true
}
```

A identidade precisa existir no projeto real; o endpoint não cria a conta externa. Para vincular a própria conta Super Admin, é obrigatório enviar também `proofAccessToken`, que será validado no projeto e precisa corresponder ao UID indicado. Não é permitido vincular outra conta Super Admin por esse endpoint. A operação fica auditada, preserva `mustChangePassword` e revoga as sessões Nest anteriores do usuário. A constraint única impede usar o mesmo UID para dois usuários locais. A atribuição de papel não vem do corpo e não muda com o vínculo.

O projeto/chave da ponte precisam estar configurados antes do vínculo, evitando trocar o método de entrada de uma conta para um provedor desativado. Planeje o bootstrap seguro antes de habilitar exclusivamente o login Supabase na interface de produção. Não envie tokens, senhas ou chaves pelo chat nem os grave na documentação.

## Troca obrigatória da senha inicial

A API continua bloqueando operações de usuários com `mustChangePassword=true`; a simples vinculação ou troca de token não remove essa proteção.

`POST /api/v1/auth/change-password` recebe `{currentPassword,newPassword}`. O método é decidido pela **sessão persistida**, não por campo controlado pelo cliente:

- Sessão local não vinculada: verifica/atualiza Argon2id como antes.
- Sessão Supabase: usa o e-mail do cadastro local para reautenticar em `POST /auth/v1/token?grant_type=password`, verifica que o UID retornado é exatamente o vínculo e chama `PUT /auth/v1/user` com a nova senha e access token recém-obtido.

Somente depois de resposta bem-sucedida e UID consistente, a API bloqueia a linha do usuário, reconfirma o vínculo, limpa a flag, audita e revoga **outras** sessões Nest. Não reescreve o hash Argon dessa conta. Senha atual incorreta, UID divergente, falha do provedor ou necessidade de nonce/reautenticação adicional deixam flag e credenciais locais intactas. O e-mail cadastrado pelo administrador deve corresponder à conta externa para essa reautenticação; não há alteração automática de vínculo por igualdade de e-mail.

A sessão Nest atual permanece válida para o cliente encerrar o login. Depois de alterar a senha, o cliente deve encerrar ambas as sessões e entrar novamente com a nova senha. Não há transação distribuída entre Supabase e PostgreSQL: se a atualização externa funcionar e a transação local falhar, o estado local continua bloqueado e exige nova autenticação/reconciliação com a senha externa atual; a API não remove a proteção silenciosamente.

O reset administrativo local recusa contas vinculadas e orienta o fluxo do provedor. Definir um hash Argon não muda uma senha Supabase e não é apresentado como reset externo concluído.

## Logout

O logout normal deve tentar **os dois lados**, mesmo que um deles falhe:

- `POST /api/v1/auth/logout` revoga a sessão Nest atual.
- O cliente encerra a sessão Supabase correspondente e limpa os cookies/estado local.

Na web, login, renovação e verificações SSR que podem escrever cookies são serializados com a limpeza do logout. Uma resposta atrasada termina antes da limpeza final; uma nova entrada aguarda essa limpeza. O estado Nest é invalidado imediatamente. Se a revogação na API falhar, o cliente informa a falha; limpar cookies sozinho não comprova que o servidor revogou a sessão.

Para uma ação explícita em todos os dispositivos, `POST /api/v1/auth/logout-all` revoga todas as sessões Nest do usuário; o cliente também deve executar o sign-out global do provedor. Um sign-out feito só no Supabase não altera automaticamente registros Nest. Não use logout global no lugar do logout comum sem que essa seja a intenção do usuário.

As rotas de login local, troca Supabase, refresh e troca de senha compartilham o grupo de limite restrito por IP. A configuração de proxy confiável continua necessária atrás do Nginx.

## Evidências e pendências

Testes de contrato/segurança em `services/api/test/supabase-auth.test.ts` usam transporte controlado e substitutos de banco: validam identidade remota aceita/rejeitada, UID/exp, papel do banco, ausência de vínculo por e-mail, teto de expiração, bloqueio de refresh/fallback, vínculo auditado e falhas de troca de senha. Eles **não** comprovam acesso ao projeto real nem concorrência no banco pelo Prisma.

`RUN_POSTGRES_SECURITY_TEST=1 node --test tests/sql/supabase-auth.test.mjs` aplica as migrações reais em schema local temporário: dezoito verificações cobrem preservação dos registros locais, UID único, valores conhecidos de provedor, família UUID única e preservação de revogações; o teste executa rollback completo. Não usa Supabase remoto.

Continuam pendentes a geração/migração pelo Prisma quando seus binários estiverem disponíveis, conexão real, configuração Auth/URLs de redirecionamento, contas externas, vínculo aprovado e testes ponta a ponta em um deployment com HTTPS. A referência a um plugin não comprova essas etapas.
