# João Vendas IA — painel de vendas por WhatsApp

Projeto independente, pronto para testes locais. Integração pelo **WhatsApp Business Platform Cloud API (oficial)**. Não usa WhatsApp Web nem lê mensagens pessoais.

## O que já está implementado

- Login de administrador com senha criptografada (scrypt), cookie HTTP-only assinado e CSRF.
- Painel responsivo, métricas, produtos, planos, importação de informações de links públicos.
- **Revisão humana obrigatória**: importação cria rascunho, não publica nada automaticamente.
- Simulação com API da OpenAI; sem chave retorna **DEMONSTRAÇÃO (sem IA)**.
- Conversas, pausa por contato, envio manual, opt-out.
- Webhook Meta com validação de token e assinatura HMAC, identificação do phone_number_id e desduplicação básica.
- Respostas automáticas somente para mensagens recebidas, se a IA estiver habilitada e configurada.
- Impede enviar respostas livres fora da janela de 24h (no envio manual), conforme política da Meta.

## Iniciar localmente

```bash
python -m venv .venv
source .venv/bin/activate   # no Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
cp .env.example .env      # no Windows: copie manualmente
# edite .env, incluindo SESSION_SECRET com ao menos 32 caracteres,
# ADMIN_EMAIL e ADMIN_PASSWORD de 12+ caracteres.
python -m scripts.create_admin
uvicorn app:app --reload
```

Abra http://127.0.0.1:8000. Configure `COOKIE_SECURE=false` **somente em ambiente local sem HTTPS**.

## Conectar Meta e OpenAI

1. Crie/configure app em https://developers.facebook.com/apps/ e WhatsApp Business Platform.
2. Verifique elegibilidade para **coexistência** se pretende usar o mesmo número no aplicativo WhatsApp Business e na API simultaneamente; a conexão NÃO é apenas escanear um QR comum.
3. No Render, informe `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` e `PUBLIC_BASE_URL` em variáveis secretas.
4. Configure o webhook `https://SEU-SERVICO.onrender.com/webhook/whatsapp` com o verify token e assine o campo `messages`.
5. Informe `OPENAI_API_KEY` (API cobrada separadamente da assinatura ChatGPT) e `OPENAI_MODEL` suportado.
6. Cadastre links e revise manualmente textos, preços, planos e links de cada produto; marque **Ativo** após a aprovação.
7. Habilite automação no painel **somente depois** de validar Meta, IA e catálogo e testar em um número autorizado.

### Deploy de produção

Use **PostgreSQL persistente**, opcionalmente `DB_SCHEMA=joao_vendas_ia` para isolar as tabelas ao compartilhar uma instância (configure `DATABASE_URL=postgresql://...`) e HTTPS; configure `COOKIE_SECURE=true`; use `uvicorn app:app --host 0.0.0.0 --port $PORT --workers 1` como comando de início. Rode `python -m scripts.create_admin` uma vez (localmente apontando para o banco ou em um job controlado). O plano Render Free pode hibernar, e **SQLite local no Render Free não é durável**; não use SQLite para clientes reais. Guarde senhas/tokens apenas em variáveis de ambiente, nunca no GitHub.

## Limites atuais e próximos passos

- O importador consegue ler HTML público, metadados e alguns preços em JSON-LD; sites com login, proteções antibot ou conteúdo gerado por JavaScript precisarão de cadastro manual. Ele **não** descobre todos os planos nem acompanha alterações de preço automaticamente.
- Para maior segurança em produção, reforçar verificação de DNS/SSRF com um proxy de saída controlado ou allowlist de domínios; o importador atual bloqueia IPs privados e redirects, mas DNS rebinding ainda é um risco residual.
- Mensagens de saída só na janela de serviço de 24 horas, a não ser que seja desenvolvido envio de templates aprovados. Não existe disparo em massa neste MVP.
- Webhook usa BackgroundTasks simples; para escala e entregas garantidas, implementar fila durável, retentativa idempotente, observabilidade, controle LGPD (retenção/exclusão de dados) e auditoria.
- Não integra checkout nem comprova pagamento; confirmá-lo exige integração com provedor oficial.
- Não implementa Embedded Signup por botão único. É necessário configurar a conta Meta do proprietário e conceder permissões.
- A plataforma pode ter cobranças da Meta por mensagens e da OpenAI por uso. Consulte as tarifas atuais no painel oficial.

## Estrutura

- `app.py`: API, catálogo, login, importador e webhook.
- `static/index.html`: interface administrativa.
- `static/styles.css`: aparência.
- `static/app.js`: ações do painel.
- `scripts/create_admin.py`: criação/redefinição da senha administrativa.
- `tests/`: testes básicos.

## Implantação guiada pelo `render.yaml`

Publique os arquivos num **repositório GitHub novo e separado**, depois crie um Blueprint no Render usando esse repositório. No primeiro deploy, forneça as variáveis com `sync: false` e configure `PUBLIC_BASE_URL` com a URL HTTPS final. O processo cria/redefine o administrador a partir das variáveis, mas a aplicação não fica pronta para vendas reais sem Meta e IA autorizadas. O plano gratuito do Render pode dormir e não garante atendimento em tempo integral.

**Importante:** `render.yaml` não cria automaticamente banco nem credenciais Meta. Configure PostgreSQL durável antes do primeiro uso real. Para testes locais, SQLite é suficiente.
