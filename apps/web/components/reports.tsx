'use client';
import { useMemo, useState } from 'react';
import { money, statusLabel } from '../lib/format';
import {
  deliveryCsv,
  filterDeliveries,
  summarizeDeliveries,
  type ReportDelivery,
} from '../lib/reports';
import { Icon } from './icons';

export function Reports({
  deliveries,
  loading = false,
}: {
  deliveries: ReportDelivery[];
  loading?: boolean;
}) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState('all');
  const available = useMemo(() => deliveries.slice(0, 100), [deliveries]);
  const filtered = useMemo(
    () => filterDeliveries(available, { from, to, status }),
    [available, from, to, status],
  );
  const summary = useMemo(() => summarizeDeliveries(filtered), [filtered]);
  const invalidRange = Boolean(from && to && from > to);
  const statuses = useMemo(
    () => [...new Set(available.map((delivery) => delivery.status))].sort(),
    [available],
  );

  function downloadCsv() {
    const url = URL.createObjectURL(
      new Blob([deliveryCsv(filtered)], { type: 'text/csv;charset=utf-8;' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `ligeirinho-atendimentos-${from || 'inicio'}-${to || 'fim'}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section className="reports-print" aria-labelledby="reports-title">
      <div className="panel reports-filter-panel">
        <div className="panel-heading">
          <div>
            <h2 id="reports-title">Relatório dos atendimentos carregados</h2>
            <p>
              Até 100 registros mais recentes permitidos para sua conta. Este recorte não representa
              o histórico completo.
            </p>
          </div>
        </div>
        <div className="reports-toolbar no-print">
          <label>
            Data inicial
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label>
            Data final
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <label>
            Situação
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">Todas as situações</option>
              {statuses.map((value) => (
                <option value={value} key={value}>
                  {statusLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button button-outline button-small"
            onClick={() => {
              setFrom('');
              setTo('');
              setStatus('all');
            }}
          >
            Limpar filtros
          </button>
        </div>
        {invalidRange && (
          <p className="alert alert-error" role="alert">
            A data final deve ser igual ou posterior à data inicial.
          </p>
        )}
        <p className="reports-period">
          Datas de criação no fuso de São Paulo: {from || 'sem limite inicial'} a{' '}
          {to || 'sem limite final'} ·{' '}
          {status === 'all' ? 'Todas as situações' : statusLabel(status)}.
        </p>
      </div>
      <div className="stat-grid reports-stats" aria-live="polite">
        <article className="stat-card">
          <span>
            Atendimentos no filtro <Icon name="box" />
          </span>
          <strong>{loading ? '—' : summary.total}</strong>
          <small>
            {summary.completed} finalizados · {summary.cancelled} cancelados · {summary.active}{' '}
            ativos
          </small>
        </article>
        <article className="stat-card">
          <span>
            Valores de finalizados <Icon name="check" />
          </span>
          <strong>{loading ? '—' : money(summary.completedCents)}</strong>
          <small>Informativo; não comprova recebimento</small>
        </article>
        <article className="stat-card">
          <span>
            Valores de todos os estados <Icon name="file" />
          </span>
          <strong>{loading ? '—' : money(summary.totalCents)}</strong>
          <small>Inclui ativos e cancelados; não é receita</small>
        </article>
      </div>
      <div className="panel">
        <div className="panel-heading">
          <div>
            <h2>Detalhamento do recorte</h2>
            <p>{summary.stops} destinos nos atendimentos filtrados.</p>
          </div>
          <div className="heading-actions no-print">
            <button
              className="button button-outline button-small"
              disabled={loading || invalidRange || filtered.length === 0}
              onClick={downloadCsv}
            >
              <Icon name="file" size={16} />
              Baixar CSV
            </button>
            <button
              className="button button-outline button-small"
              disabled={loading || invalidRange}
              onClick={() => window.print()}
            >
              Imprimir / salvar como PDF
            </button>
          </div>
        </div>
        {loading ? (
          <div className="empty-state" role="status">
            Carregando registros do relatório…
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state">
            <Icon name="file" size={32} />
            <h3>Nenhum atendimento neste filtro.</h3>
            <p>Altere as datas ou a situação para consultar os registros carregados.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Referência e data</th>
                  <th>Estabelecimento / destinos</th>
                  <th>Situação</th>
                  <th>Valor informativo</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((delivery) => (
                  <ReportRow key={delivery.id} delivery={delivery} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {summary.withoutAmount > 0 && (
        <p className="alert alert-error">
          {summary.withoutAmount} registro(s) sem valor válido em centavos foram excluídos das
          somas.
        </p>
      )}
      <p className="dashboard-note reports-disclaimer">
        <Icon name="shield" size={16} />
        Pagamento da entrega é direto entre estabelecimento e entregador. Os valores deste relatório
        não comprovam pagamento, recebimento ou cobrança da plataforma.
      </p>
      <p className="fine">
        O arquivo CSV contém os registros exibidos após os filtros. Para PDF, utilize a opção de
        impressão do navegador e escolha “Salvar como PDF”; não há emissão de documento fiscal.
      </p>
    </section>
  );
}

function ReportRow({ delivery }: { delivery: ReportDelivery }) {
  const createdAt = new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(delivery.createdAt));
  const amount =
    Number.isSafeInteger(delivery.totalCents) && delivery.totalCents! >= 0
      ? money(delivery.totalCents!)
      : 'Não informado';
  return (
    <tr>
      <td>
        <strong>#{delivery.id.slice(0, 8).toUpperCase()}</strong>
        <small>{createdAt}</small>
      </td>
      <td>
        {delivery.establishment?.name || 'Estabelecimento não informado'}
        <small>
          {delivery.stops?.map((stop) => stop.address).join(' · ') || 'Sem destinos informados'}
        </small>
      </td>
      <td>
        <span
          className={`status-badge ${delivery.status === 'FINALIZADO' ? 'status-green' : delivery.status === 'CANCELADO' ? 'status-gray' : ''}`}
        >
          {statusLabel(delivery.status)}
        </span>
      </td>
      <td>{amount}</td>
    </tr>
  );
}
