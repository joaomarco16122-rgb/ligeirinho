# Segurança e privacidade

## Controles do núcleo

Senhas são hashes Argon2id. Não há credencial administrativa padrão: o bootstrap recebe `BOOTSTRAP_ADMIN_EMAIL` e `BOOTSTRAP_ADMIN_PASSWORD` temporariamente, cria o primeiro Super Admin e preserva uma conta existente. Troca de senha inicial é obrigatória. JWT precisa de segredo forte exclusivo; refresh tokens são rotativos, armazenados como hash, têm expiração e podem ser revogados. Reset administrativo exige motivo e confirmação e não deve permitir que outro administrador altere Super Admin.

O backend verifica perfil e escopo a cada operação. Estabelecimentos acessam seus atendimentos; entregadores acessam ofertas e entregas atribuídas; administradores de cidade operam dentro do escopo. Objetos relacionados precisam respeitar o mesmo escopo. Rejeitar payloads desconhecidos e coordenadas/valores inválidos protege invariantes além da interface.

A API aplica limites de corpo, cabeçalhos Helmet, CORS explícito e limites de requisição via Redis. Em produção, projetar limites no gateway por cliente e configurar proxies confiáveis corretamente; CORS não substitui autorização e não protege clientes nativos. Um proxy que agrega clientes no mesmo endereço precisa de configuração específica para limites por origem, sem confiar em cabeçalhos enviados livremente pelo usuário.

## Sessões nos clientes

Android guarda tokens no armazenamento seguro do sistema. Clientes precisam renovar/revogar sessões e apagar credenciais ao sair. A web mantém os tokens em memória, sem persistir em localStorage/sessionStorage; ainda exige prevenção de XSS. Atualizar a página encerra essa sessão no cliente. Para uma implantação exposta, revisar a sessão web para cookies HttpOnly/Secure, política CSP e proteção CSRF correspondente antes de tratar a aplicação como endurecida para produção.

## Localização e LGPD

Coordenadas são dados pessoais. O app deve informar finalidade, pedir permissão e coletar somente para disponibilidade/atendimento. Estabelecimento só deve receber posição de entregador associado e autorizado durante o fluxo pertinente. Atualização foreground não equivale a rastreamento contínuo em background. Não coletar quando o trabalho não justificar e não apresentar posição antiga como atual.

O operador precisa definir bases legais, controlador/operador, canal de direitos, retenção por categoria, eliminação/anonimização, contratos de fornecedores e resposta a incidentes. Textos de termos/privacidade incluídos são iniciais e exigem revisão. O código não representa certificação de conformidade jurídica automática.

## Antes de produção

- TLS válido, domínio definido, CORS restrito e banco/Redis em rede privada, com autenticação e TLS quando apropriado.
- Segredos em gerenciador próprio, rotação, backup criptografado e restauração testada.
- Revisão externa de autorização, concorrência, sessão web, logs, dependências e limites operacionais.
- 2FA/autenticação reforçada, papéis/permissões customizados e políticas de auditoria inviolável ainda precisam de implementação e validação próprias.
- Uploads, armazenamento de mídia e webhooks só devem ser expostos quando validação, assinatura, limites, retenção e testes existirem. O núcleo não declara esses serviços ativos.

Nunca imprimir ambiente completo, tokens, senhas ou arquivos de credenciais. Não versionar `.env`, chaves Firebase, chaves de assinatura Android, dumps ou dados reais. A tabela `AuditLog` não é por si só uma garantia contra adulteração por quem controla o banco; produção exige separação de privilégios e retenção independente.

## Dependências e risco residual

Os overrides da raiz foram motivados por avisos de auditoria e revalidados nos builds web/Hermes. A última auditoria desta preparação não encontrou achados críticos, altos ou moderados; manteve um aviso baixo transitivo `GHSA-gcqx-w48m-w2h4` em `deepmerge@4.3.1` (Expo → `@expo/config`), sem correção disponível no registro consultado. Consulte [dependency-policy.md](dependency-policy.md) para versões, limites da evidência e rotina de atualização. Não há alegação de dependências livres de vulnerabilidades.

## IP encaminhado e limites por cliente

Por padrão, `TRUST_LOCAL_PROXY` não habilita confiança em cabeçalhos encaminhados. Use exatamente `TRUST_LOCAL_PROXY=1` apenas quando o Nginx estiver no mesmo host/loopback e a API não tiver acesso público direto. A confiança do Express é restrita a loopback, nunca a todos os proxies; o limite usa `req.ip` resolvido por essa política. Outros saltos precisam de uma política revisada antes de uso. Quatro testes HTTP verificam separação de clientes e rejeição de IP forjado.

## Credencial gerada para desenvolvimento

O montador completo pode gerar uma senha aleatória e salvá-la em `.local/acesso-local.json` modo `0600`, somente com banco local/loopback e fora de produção. A senha não é impressa e o bootstrap preserva Super Admin existente. Esse acesso não é segredo de fornecedor nem credencial de produção e não deve ser enviado a chat, logs ou Git. O arquivo gerado só demonstra material local disponível; a criação efetiva da conta exige que a etapa de bootstrap conclua.

Para a topologia de contêineres, `TRUST_PROXY_ADDRESS` aceita um único IP controlado exato, com precedência sobre a opção de loopback. CIDR e wildcard não são aceitos. O Compose de produção associa essa política ao gateway de sua bridge própria; mantenha entrada da API restrita ao Nginx do host e valide o salto observado. Não confiar na subnet inteira nem copiar um endereço de outra implantação sem conferir a rede.
