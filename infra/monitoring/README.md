# Sinais operacionais

O endpoint `GET /api/v1/health` verifica banco e Redis. Uma resposta HTTP 200 deve conter os componentes saudáveis; falhas precisam retirar a instância do balanceamento. Os logs do processo e os eventos persistidos ajudam a investigar; não são uma plataforma completa de tracing.

Monitorar externamente: disponibilidade/latência da API, erros 5xx, conexões e espaço do PostgreSQL, consumo/persistência do Redis, atraso de jobs, ofertas expiradas, solicitações aguardando e confirmações pendentes. Uma entrega aguardando confirmação não deve ser liberada por um alerta automático.

Configurar antes de produção: coleta central de logs com remoção de tokens/dados pessoais, IDs de correlação, métricas Prometheus/OpenTelemetry e alertas com responsáveis. Esta pasta documenta os sinais; não instala um coletor nem afirma que alertas estão ativos.
