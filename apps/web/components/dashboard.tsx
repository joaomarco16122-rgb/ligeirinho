'use client';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api, post, getSession, destination, type Session, ApiError } from '../lib/api';
import { money, date, statusLabel, isFinished } from '../lib/format';
import { Icon } from './icons';
import { logoutWeb, restoreWebSession } from '../lib/web-auth';
import { Dialog } from './dialog';
import { Reports } from './reports';
import { Settings } from './settings';
import { AuditLog, DistributionRules, ResetPassword } from './admin-operations';
type Stop = {
  id?: string;
  address: string;
  latitude: number;
  longitude: number;
  completedAt?: string | null;
};
type Delivery = {
  id: string;
  status: string;
  createdAt: string;
  totalCents?: number;
  priceCents?: number;
  stops?: Stop[];
  establishment?: { name: string };
  courier?: {
    name?: string;
    latitude?: number | null;
    longitude?: number | null;
    locationAt?: string | null;
    user?: { name?: string };
  };
  events?: { id: string; type?: string; status?: string; createdAt: string }[];
};
type Quote = { id: string; totalCents: number; distanceKm: number; expiresAt: string };
type Row = {
  baseCents?: number;
  perKmCents?: number;
  state?: string;
  id: string;
  name?: string;
  email?: string;
  role?: string;
  status?: string;
  address?: string;
  city?: { name: string };
  user?: { name?: string; email?: string };
  active?: boolean;
  cityId?: string;
};
type Message = {
  id: string;
  text: string;
  createdAt: string;
  sender?: { name?: string };
  user?: { name?: string };
};
type DraftStop = { address: string; latitude: string; longitude: string };
const blankStop = (): DraftStop => ({ address: '', latitude: '', longitude: '' });
const recordTitles: Record<string, string> = {
  cities: 'Cidades',
  establishments: 'Estabelecimentos',
  couriers: 'Entregadores',
  users: 'Usuários',
  tariffs: 'Tarifas',
};
const screenTitles: Record<string, string> = {
  ...recordTitles,
  reports: 'Relatórios',
  distribution: 'Distribuição',
  audit: 'Auditoria',
  settings: 'Configurações',
};
export function Dashboard({ admin = false }: { admin?: boolean }) {
  const router = useRouter();
  const [session, setSession] = useState<Session | null>(null);
  const [tab, setTab] = useState('deliveries');
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [cities, setCities] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [resetUser, setResetUser] = useState<Row | null>(null);
  const [toolsRevision, setToolsRevision] = useState(0);
  const [detail, setDetail] = useState<Delivery | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  const [menu, setMenu] = useState(false);
  const [filter, setFilter] = useState('active');
  const load = useCallback(
    async (quiet = false) => {
      if (!getSession() || getSession()?.user.mustChangePassword) return;
      if (!quiet) setLoading(true);
      try {
        if (tab === 'deliveries' || tab === 'reports')
          setDeliveries(await api<Delivery[]>('/deliveries'));
        else if (!['distribution', 'audit', 'settings'].includes(tab))
          setRows(await api<Row[]>(`/admin/${tab}`));
        setError('');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          router.replace('/login');
          return;
        }
        setError(e instanceof Error ? e.message : 'Erro ao carregar dados.');
      } finally {
        setLoading(false);
      }
    },
    [tab, router],
  );
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const current = getSession() ?? (await restoreWebSession());
        if (!alive) return;
        if (!current) {
          router.replace('/login');
          return;
        }
        if (
          (admin && !['SUPER_ADMIN', 'ADMIN'].includes(current.user.role)) ||
          (!admin && current.user.role !== 'ESTABLISHMENT')
        ) {
          router.replace(destination(current.user.role));
          return;
        }
        setSession(current);
      } catch (err) {
        if (alive) {
          setError(err instanceof Error ? err.message : 'Não foi possível verificar a sessão.');
          setLoading(false);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [admin, router]);
  useEffect(() => {
    if (!session) return;
    void load();
    if (admin && !session.user.mustChangePassword)
      api<Row[]>('/admin/cities')
        .then(setCities)
        .catch(() => {});
    const timer = setInterval(() => void load(true), 10000);
    return () => clearInterval(timer);
  }, [admin, load, session]);
  async function openDelivery(id: string) {
    setError('');
    try {
      const data = await api<Delivery>(`/deliveries/${id}`);
      setDetail(data);
      if (!admin) setMessages(await api<Message[]>(`/deliveries/${id}/messages`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao abrir atendimento.');
    }
  }
  async function action(path: string, body?: unknown) {
    setBusy(true);
    setError('');
    try {
      await post(path, body);
      setNotice('Operação confirmada pelo servidor.');
      await load(true);
      if (detail) await openDelivery(detail.id);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível concluir.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function signOut() {
    setBusy(true);
    try {
      await logoutWeb();
    } catch {
    } finally {
      router.replace('/login');
    }
  }
  const active = deliveries.filter((d) => !isFinished(d.status));
  const pending = deliveries.filter((d) =>
    ['ENTREGADOR_CONCLUIU', 'AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO'].includes(d.status),
  );
  const shown = deliveries.filter(
    (d) => filter === 'all' || (filter === 'active' ? !isFinished(d.status) : isFinished(d.status)),
  );
  if (!session)
    return (
      <main id="conteudo" className="loading-page" role="status">
        {error ? (
          <div className="error-section">
            <h1>Não foi possível verificar o acesso.</h1>
            <p role="alert">{error}</p>
            <Link href="/login" className="button button-primary">
              Voltar ao acesso
            </Link>
          </div>
        ) : (
          'Verificando sua sessão…'
        )}
      </main>
    );
  return (
    <div className="app-shell">
      <aside className={`sidebar ${menu ? 'is-open' : ''}`}>
        <Link className="wordmark" href="/">
          ligeirinho<span>.</span>
        </Link>
        <div className="workspace-label">
          {admin ? 'ADMINISTRAÇÃO' : 'PORTAL DO ESTABELECIMENTO'}
        </div>
        <nav aria-label="Navegação do painel">
          <button
            className={tab === 'deliveries' ? 'nav-item active' : 'nav-item'}
            onClick={() => {
              setTab('deliveries');
              setMenu(false);
            }}
          >
            <Icon name="grid" />
            {admin ? 'Operações' : 'Meus atendimentos'}
          </button>
          {admin &&
            Object.entries(recordTitles).map(([key, title]) => (
              <button
                key={key}
                className={tab === key ? 'nav-item active' : 'nav-item'}
                onClick={() => {
                  setTab(key);
                  setMenu(false);
                }}
              >
                <Icon
                  name={
                    key === 'couriers'
                      ? 'bike'
                      : key === 'cities'
                        ? 'pin'
                        : key === 'users'
                          ? 'users'
                          : key === 'tariffs'
                            ? 'file'
                            : 'box'
                  }
                />
                {title}
              </button>
            ))}
          <button
            className={tab === 'reports' ? 'nav-item active' : 'nav-item'}
            onClick={() => {
              setTab('reports');
              setMenu(false);
            }}
          >
            <Icon name="file" />
            Relatórios
          </button>
          {admin && (
            <button
              className={tab === 'distribution' ? 'nav-item active' : 'nav-item'}
              onClick={() => {
                setTab('distribution');
                setMenu(false);
              }}
            >
              <Icon name="pin" />
              Distribuição
            </button>
          )}
          {admin && session.user.role === 'SUPER_ADMIN' && (
            <button
              className={tab === 'audit' ? 'nav-item active' : 'nav-item'}
              onClick={() => {
                setTab('audit');
                setMenu(false);
              }}
            >
              <Icon name="shield" />
              Auditoria
            </button>
          )}
          {admin && (
            <button
              className={tab === 'settings' ? 'nav-item active' : 'nav-item'}
              onClick={() => {
                setTab('settings');
                setMenu(false);
              }}
            >
              <Icon name="grid" />
              Configurações
            </button>
          )}
          <Link href="/suporte" className="nav-item">
            <Icon name="chat" />
            Ajuda e suporte
          </Link>
        </nav>
        <div className="sidebar-bottom">
          <div className="user-avatar">
            {(session.user.name || session.user.email).charAt(0).toUpperCase()}
          </div>
          <div className="user-identity">
            <strong>{session.user.name || 'Minha conta'}</strong>
            <span>{admin ? 'Administração' : 'Estabelecimento'}</span>
          </div>
          <button
            className="icon-button"
            aria-label="Sair da conta"
            title="Sair da conta"
            onClick={signOut}
            disabled={busy}
          >
            <Icon name="logout" />
          </button>
        </div>
      </aside>
      <div className="app-body">
        <header className="app-topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Abrir menu"
            onClick={() => setMenu(!menu)}
          >
            <Icon name="menu" />
          </button>
          <span className="breadcrumb">
            {admin ? 'Administração' : 'Seu estabelecimento'}
            <span>/</span>
            {tab === 'deliveries' ? 'Atendimentos' : screenTitles[tab]}
          </span>
          <Link href="/suporte" className="topbar-help">
            Precisa de ajuda? <Icon name="chat" size={17} />
          </Link>
        </header>
        <main id="conteudo" className="dashboard-main">
          <div className="dashboard-heading">
            <div>
              <span className="eyebrow">
                {admin ? 'VISÃO DA OPERAÇÃO' : 'TUDO PRONTO PARA A PRÓXIMA ENTREGA'}
              </span>
              <h1>
                {tab === 'deliveries'
                  ? admin
                    ? 'Visão geral da operação'
                    : 'Seus atendimentos'
                  : screenTitles[tab]}
              </h1>
              <p className="muted">
                {tab === 'deliveries'
                  ? 'Acompanhe cada etapa e mantenha tudo em movimento.'
                  : 'Cadastros e configurações da sua operação.'}
              </p>
            </div>
            <div className="heading-actions">
              <button
                className="button button-outline button-small"
                onClick={() => {
                  if (['distribution', 'audit', 'settings'].includes(tab))
                    setToolsRevision((value) => value + 1);
                  else void load();
                }}
                disabled={loading}
              >
                <Icon name="refresh" size={16} />
                Atualizar
              </button>
              {((!admin && tab === 'deliveries') ||
                (admin &&
                  (['establishments', 'couriers', 'tariffs'].includes(tab) ||
                    (session.user.role === 'SUPER_ADMIN' &&
                      ['cities', 'users'].includes(tab))))) && (
                <button
                  className="button button-primary button-small"
                  onClick={() => {
                    setShowNew(true);
                    setNotice('');
                  }}
                >
                  <Icon name="plus" size={17} />
                  {admin ? 'Novo cadastro' : 'Solicitar entregador'}
                </button>
              )}
            </div>
          </div>
          {error && (
            <div role="alert" className="alert alert-error">
              <Icon name="alert" />
              {error}
              <button className="text-link" onClick={() => void load()}>
                Tentar novamente
              </button>
            </div>
          )}
          {notice && (
            <div role="status" className="alert alert-success">
              <Icon name="check" />
              {notice}
              <button
                className="icon-button"
                onClick={() => setNotice('')}
                aria-label="Fechar aviso"
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          {tab === 'settings' && admin ? (
            <Settings user={session.user} cities={cities} revision={toolsRevision} />
          ) : tab === 'reports' ? (
            <Reports deliveries={deliveries} loading={loading} />
          ) : tab === 'distribution' && admin ? (
            <DistributionRules revision={toolsRevision} />
          ) : tab === 'audit' && admin && session.user.role === 'SUPER_ADMIN' ? (
            <AuditLog revision={toolsRevision} />
          ) : tab === 'deliveries' ? (
            <>
              <div className="stat-grid">
                <article className="stat-card">
                  <span>
                    Em andamento <Icon name="bike" />
                  </span>
                  <strong>{loading ? '—' : active.length}</strong>
                  <small>Atendimentos ativos</small>
                </article>
                <article className="stat-card">
                  <span>
                    Aguardando confirmação <Icon name="clock" />
                  </span>
                  <strong>{loading ? '—' : pending.length}</strong>
                  <small>Confira as entregas concluídas</small>
                </article>
                <article className="stat-card">
                  <span>
                    Finalizados <Icon name="check" />
                  </span>
                  <strong>
                    {loading ? '—' : deliveries.filter((d) => d.status === 'FINALIZADO').length}
                  </strong>
                  <small>Histórico desta consulta</small>
                </article>
              </div>
              <section className="panel">
                <div className="panel-heading">
                  <div>
                    <h2>{admin ? 'Atendimentos da plataforma' : 'Acompanhe seus atendimentos'}</h2>
                    <p>
                      Até 100 atendimentos mais recentes da sua conta. Atualização a cada 10
                      segundos.
                    </p>
                  </div>
                  <div className="segmented" aria-label="Filtrar atendimentos">
                    {[
                      ['active', 'Em andamento'],
                      ['finished', 'Histórico'],
                      ['all', 'Todos'],
                    ].map(([v, l]) => (
                      <button
                        aria-pressed={filter === v}
                        className={filter === v ? 'selected' : ''}
                        key={v}
                        onClick={() => setFilter(v)}
                      >
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                {loading ? (
                  <div className="empty-state" role="status">
                    <Icon name="refresh" size={32} />
                    <h3>Carregando atendimentos…</h3>
                  </div>
                ) : shown.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">
                      <Icon name="box" size={35} />
                    </div>
                    <h3>
                      {filter === 'active'
                        ? 'Um novo caminho começa aqui.'
                        : 'Nenhum atendimento encontrado.'}
                    </h3>
                    <p>
                      {filter === 'active'
                        ? 'Quando houver uma solicitação, você poderá acompanhar cada etapa por aqui.'
                        : 'Os atendimentos deste filtro aparecerão aqui.'}
                    </p>
                    {!admin && filter === 'active' && (
                      <button
                        className="button button-primary button-small"
                        onClick={() => setShowNew(true)}
                      >
                        <Icon name="plus" size={16} />
                        Solicitar primeiro entregador
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Atendimento</th>
                          <th>Destinos</th>
                          <th>Status</th>
                          <th>Valor</th>
                          <th>
                            <span className="sr-only">Ações</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((d) => (
                          <tr key={d.id}>
                            <td>
                              <strong>#{d.id.slice(0, 8).toUpperCase()}</strong>
                              <small>
                                {date(d.createdAt)}
                                {d.establishment?.name && ` · ${d.establishment.name}`}
                              </small>
                            </td>
                            <td>
                              {d.stops?.[0]?.address || 'Consultar atendimento'}
                              {(d.stops?.length || 0) > 1 && (
                                <small>+{d.stops!.length - 1} destino(s)</small>
                              )}
                            </td>
                            <td>
                              <span
                                className={`status-badge ${d.status === 'FINALIZADO' ? 'status-green' : d.status === 'CANCELADO' ? 'status-gray' : ''}`}
                              >
                                {statusLabel(d.status)}
                              </span>
                            </td>
                            <td>{money(d.totalCents ?? d.priceCents ?? 0)}</td>
                            <td>
                              <button className="text-link" onClick={() => void openDelivery(d.id)}>
                                Ver detalhes <Icon name="arrow" size={16} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
              <p className="dashboard-note">
                <Icon name="shield" size={16} />O valor da entrega é pago diretamente ao entregador.
                O histórico não comprova recebimento.
              </p>
            </>
          ) : (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2>{recordTitles[tab]} cadastrados</h2>
                  <p>As permissões são verificadas pelo servidor em cada operação.</p>
                </div>
              </div>
              {loading ? (
                <div className="empty-state" role="status">
                  Carregando cadastros…
                </div>
              ) : rows.length === 0 ? (
                <div className="empty-state">
                  <Icon name="users" size={32} />
                  <h3>Nenhum registro por aqui.</h3>
                  <p>Adicione o primeiro cadastro para preparar a operação.</p>
                </div>
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Nome / identificador</th>
                        <th>Informações</th>
                        <th>Situação</th>
                        {tab === 'users' && <th>Ações de acesso</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => (
                        <tr key={row.id}>
                          <td>
                            <strong>{row.name || row.user?.name || row.id.slice(0, 8)}</strong>
                            <small>{row.id}</small>
                          </td>
                          <td>
                            {row.baseCents !== undefined
                              ? `${money(row.baseCents)} base + ${money(row.perKmCents ?? 0)}/km`
                              : row.email ||
                                row.user?.email ||
                                row.city?.name ||
                                row.address ||
                                row.state ||
                                '—'}
                          </td>
                          <td>
                            <span className="status-badge status-gray">
                              {row.role ||
                                row.status ||
                                (row.active === false ? 'Inativo' : 'Cadastrado')}
                            </span>
                          </td>
                          {tab === 'users' && (
                            <td>
                              {row.role !== 'SUPER_ADMIN' && row.id !== session.user.id ? (
                                <button
                                  className="text-link"
                                  type="button"
                                  onClick={() => setResetUser(row)}
                                >
                                  Redefinir senha
                                </button>
                              ) : (
                                <span className="fine">Conta protegida</span>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </main>
      </div>
      {showNew &&
        (admin ? (
          <AdminForm
            resource={tab}
            cities={cities}
            onClose={() => setShowNew(false)}
            onSuccess={() => {
              setShowNew(false);
              setNotice('Cadastro salvo pelo servidor.');
              void load();
              void api<Row[]>('/admin/cities').then(setCities);
            }}
          />
        ) : (
          <RequestForm
            onClose={() => setShowNew(false)}
            onSuccess={() => {
              setShowNew(false);
              setNotice('Solicitação criada. A busca por um entregador foi iniciada.');
              void load();
            }}
          />
        ))}
      {detail && (
        <Dialog
          title={`Atendimento #${detail.id.slice(0, 8)}`}
          eyebrow="ACOMPANHAMENTO"
          wide
          closeLabel="Fechar detalhes"
          onClose={
            busy
              ? undefined
              : () => {
                  setDetail(null);
                  setMessages([]);
                }
          }
        >
          {error && (
            <p className="alert alert-error" role="alert">
              {error}
            </p>
          )}
          <div className="detail-summary">
            <span className="status-badge">{statusLabel(detail.status)}</span>
            <strong>{money(detail.totalCents ?? detail.priceCents ?? 0)}</strong>
            <button
              className="text-link"
              disabled={busy}
              onClick={() => void openDelivery(detail.id)}
            >
              <Icon name="refresh" size={16} />
              Atualizar
            </button>
          </div>
          <ol className="stops-list">
            {detail.stops?.map((stop, i) => (
              <li key={stop.id || i}>
                <Icon name="pin" />
                <div>
                  <small>DESTINO {i + 1}</small>
                  <strong>{stop.address}</strong>
                  {stop.completedAt && <span>Concluído em {date(stop.completedAt)}</span>}
                </div>
              </li>
            ))}
          </ol>
          {detail.courier && (
            <div className="tracking-card">
              <Icon name="bike" />
              <div>
                <strong>{detail.courier.name || 'Entregador atribuído'}</strong>
                {!isFinished(detail.status) &&
                detail.courier.latitude != null &&
                detail.courier.longitude != null ? (
                  <>
                    <p>
                      Última posição: {detail.courier.latitude.toFixed(5)},{' '}
                      {detail.courier.longitude.toFixed(5)}
                      {detail.courier.locationAt && ` · ${date(detail.courier.locationAt)}`}
                    </p>
                    <a
                      className="text-link"
                      href={`https://www.google.com/maps/search/?api=1&query=${detail.courier.latitude},${detail.courier.longitude}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Abrir última posição no Google Maps <Icon name="arrow" size={15} />
                    </a>
                  </>
                ) : (
                  <p>
                    {isFinished(detail.status)
                      ? 'A localização fica oculta após o encerramento.'
                      : 'Aguardando localização autorizada do entregador.'}
                  </p>
                )}
              </div>
            </div>
          )}
          <p className="fine">
            O mapa com rotas depende da configuração do provedor. Acompanhe os estados confirmados
            pelo servidor nesta tela.
          </p>
          {!admin &&
            ['ENTREGADOR_CONCLUIU', 'AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO'].includes(
              detail.status,
            ) && (
              <div className="confirmation-box">
                <h3>Está tudo certo com a entrega?</h3>
                <p>
                  Ao confirmar, o atendimento será finalizado e o entregador poderá receber novas
                  ofertas.
                </p>
                <button
                  className="button button-primary"
                  disabled={busy}
                  onClick={() => void action(`/deliveries/${detail.id}/confirm`)}
                >
                  Confirmar todas as entregas <Icon name="check" />
                </button>
              </div>
            )}
          {!isFinished(detail.status) && (!admin || session.user.role === 'SUPER_ADMIN') && (
            <form
              className="action-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const reason = String(f.get('reason'));
                if (admin)
                  void action(`/deliveries/${detail.id}/intervene`, {
                    reason,
                    confirm: true,
                    action: f.get('action'),
                  });
                else void action(`/deliveries/${detail.id}/cancellation`, { reason });
              }}
            >
              <h3>{admin ? 'Intervenção administrativa' : 'Solicitar cancelamento'}</h3>
              <label>
                Motivo obrigatório
                <input
                  name="reason"
                  required
                  minLength={admin ? 10 : 5}
                  maxLength={500}
                  placeholder="Descreva o motivo da solicitação"
                />
              </label>
              {admin && (
                <>
                  <label>
                    Ação
                    <select name="action">
                      <option value="cancel">Cancelar atendimento</option>
                      <option value="release">Liberar entregador</option>
                    </select>
                  </label>
                  <label className="checkbox-label">
                    <input type="checkbox" required />
                    Confirmo que revisei o atendimento e autorizo esta ação sensível.
                  </label>
                </>
              )}
              <button disabled={busy} className="button button-outline button-small" type="submit">
                {admin ? 'Confirmar intervenção' : 'Enviar solicitação'}
              </button>
              <p className="fine">
                {admin
                  ? 'Restrito a Super Admin. O motivo e a ação serão auditados.'
                  : 'Após o aceite, o cancelamento depende da concordância das duas partes.'}
              </p>
            </form>
          )}
          {!admin && detail.status === 'CANCELAMENTO_SOLICITADO' && (
            <button
              className="button button-outline"
              disabled={busy}
              onClick={() => void action(`/deliveries/${detail.id}/cancellation/approve`)}
            >
              Concordar com o cancelamento
            </button>
          )}
          {!admin && (
            <div className="chat-section">
              <h3>
                <Icon name="chat" />
                Conversa do atendimento
              </h3>
              {messages.length === 0 ? (
                <p className="muted">Nenhuma mensagem neste atendimento.</p>
              ) : (
                <div className="messages">
                  {messages.map((m) => (
                    <div className="message" key={m.id}>
                      <small>
                        {m.sender?.name || m.user?.name || 'Participante'} · {date(m.createdAt)}
                      </small>
                      <p>{m.text}</p>
                    </div>
                  ))}
                </div>
              )}
              <form
                className="chat-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const text = String(new FormData(form).get('text')).trim();
                  if (!text) return;
                  const sent = await action(`/deliveries/${detail.id}/messages`, { text });
                  if (sent) form.reset();
                }}
              >
                <label className="sr-only" htmlFor="chat-text">
                  Mensagem
                </label>
                <input
                  id="chat-text"
                  name="text"
                  placeholder="Escreva uma mensagem…"
                  required
                  maxLength={2000}
                />
                <button
                  className="button button-primary button-small"
                  disabled={busy}
                  type="submit"
                >
                  Enviar <Icon name="arrow" size={16} />
                </button>
              </form>
            </div>
          )}
        </Dialog>
      )}
      {resetUser && (
        <ResetPassword
          user={resetUser}
          onClose={() => setResetUser(null)}
          onSuccess={() => {
            setResetUser(null);
            setNotice(
              'Senha temporária definida e sessões revogadas. Compartilhe a credencial por um canal seguro.',
            );
            void load(true);
          }}
        />
      )}
      {session.user.mustChangePassword && (
        <PasswordChange
          onSuccess={() => {
            setSession(null);
            router.replace('/login');
          }}
        />
      )}
    </div>
  );
}
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      {children}
    </Dialog>
  );
}
function RequestForm({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [stops, setStops] = useState<DraftStop[]>([blankStop()]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  function update(index: number, field: keyof DraftStop, value: string) {
    setQuote(null);
    setStops(stops.map((s, i) => (i === index ? { ...s, [field]: value } : s)));
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const parsedStops = stops.map((s) => ({
        ...s,
        latitude: Number(s.latitude),
        longitude: Number(s.longitude),
      }));
      if (quote) {
        if (new Date(quote.expiresAt).getTime() <= Date.now()) {
          setQuote(null);
          throw new Error('A cotação expirou. Calcule novamente.');
        }
        await post('/deliveries', { quoteId: quote.id, idempotencyKey: key, stops: parsedStops });
        onSuccess();
      } else setQuote(await post<Quote>('/deliveries/quote', { stops: parsedStops }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível solicitar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Para onde vamos?" onClose={busy ? undefined : onClose}>
      <p className="muted">
        A origem é o endereço cadastrado do seu estabelecimento. Adicione os destinos e confira o
        valor antes de solicitar.
      </p>
      <form onSubmit={submit}>
        {stops.map((s, i) => (
          <fieldset className="stop-fields" key={i}>
            <legend>
              <Icon name="pin" size={16} />
              Destino {i + 1}
            </legend>
            <label>
              Endereço completo
              <input
                required
                value={s.address}
                onChange={(e) => update(i, 'address', e.target.value)}
                placeholder="Rua, número, bairro e cidade"
                maxLength={500}
              />
            </label>
            <div className="form-row">
              <label>
                Latitude
                <input
                  type="number"
                  step="any"
                  min={-90}
                  max={90}
                  required
                  value={s.latitude}
                  onChange={(e) => update(i, 'latitude', e.target.value)}
                />
              </label>
              <label>
                Longitude
                <input
                  type="number"
                  step="any"
                  min={-180}
                  max={180}
                  required
                  value={s.longitude}
                  onChange={(e) => update(i, 'longitude', e.target.value)}
                />
              </label>
            </div>
            {stops.length > 1 && (
              <button
                className="text-link"
                type="button"
                onClick={() => {
                  setStops(stops.filter((_, n) => n !== i));
                  setQuote(null);
                }}
              >
                Remover destino
              </button>
            )}
          </fieldset>
        ))}
        <p className="fine">
          Busca automática de endereços requer configuração de mapas. Informe as coordenadas reais
          do destino.
        </p>
        <button
          type="button"
          disabled={stops.length >= 10 || busy}
          className="text-link"
          onClick={() => {
            setStops([...stops, blankStop()]);
            setQuote(null);
          }}
        >
          <Icon name="plus" size={16} />
          Adicionar outro destino
        </button>
        {quote && (
          <div className="quote-card">
            <span>Valor total do atendimento</span>
            <strong>{money(quote.totalCents)}</strong>
            <p>
              {quote.distanceKm.toFixed(2)} km estimados · Válido até {date(quote.expiresAt)}
            </p>
            <small>
              Estimativa em linha reta, sem rota viária. Pagamento direto ao entregador.
            </small>
          </div>
        )}
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <button className="button button-primary button-full" disabled={busy} type="submit">
          {busy ? 'Aguarde…' : quote ? 'Confirmar e solicitar entregador' : 'Calcular cotação'}
          <Icon name="arrow" />
        </button>
      </form>
    </Modal>
  );
}
function AdminForm({
  resource,
  cities,
  onClose,
  onSuccess,
}: {
  resource: string;
  cities: Row[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const fields = Object.fromEntries(new FormData(e.currentTarget));
    const body: Record<string, unknown> = { ...fields };
    for (const f of ['latitude', 'longitude', 'baseCents', 'perKmCents'])
      if (f in body) body[f] = Number(body[f]);
    try {
      await post(`/admin/${resource}`, body);
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível salvar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title={`Novo cadastro · ${recordTitles[resource]}`} onClose={busy ? undefined : onClose}>
      <form onSubmit={submit}>
        {resource !== 'tariffs' && (
          <label>
            Nome
            <input name="name" required minLength={2} maxLength={120} />
          </label>
        )}
        {resource === 'cities' && (
          <label>
            UF
            <input
              name="state"
              required
              minLength={2}
              maxLength={2}
              pattern="[A-Za-z]{2}"
              placeholder="SP"
              style={{ textTransform: 'uppercase' }}
            />
          </label>
        )}
        {resource !== 'cities' && (
          <label>
            Cidade
            <select name="cityId" required defaultValue="">
              <option disabled value="">
                Selecione uma cidade
              </option>
              {cities.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {['establishments', 'couriers', 'users'].includes(resource) && (
          <>
            <label>
              E-mail de acesso
              <input name="email" type="email" autoComplete="off" required maxLength={254} />
            </label>
            <label>
              Senha inicial
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                maxLength={128}
              />
            </label>
            <p className="fine">
              Compartilhe as credenciais por um canal seguro. A troca da senha será exigida no
              primeiro acesso.
            </p>
          </>
        )}
        {resource === 'establishments' && (
          <>
            <label>
              Endereço completo
              <input name="address" required minLength={5} maxLength={500} />
            </label>
            <div className="form-row">
              <label>
                Latitude
                <input name="latitude" type="number" min={-90} max={90} step="any" required />
              </label>
              <label>
                Longitude
                <input name="longitude" type="number" min={-180} max={180} step="any" required />
              </label>
            </div>
          </>
        )}
        {resource === 'tariffs' && (
          <>
            <label>
              Valor base (centavos)
              <input name="baseCents" type="number" min={0} step={1} required />
            </label>
            <label>
              Valor por km (centavos)
              <input name="perKmCents" type="number" min={0} step={1} required />
            </label>
            <p className="fine">
              Exemplo: 500 corresponde a R$ 5,00. Novas tarifas não reescrevem os valores de
              atendimentos existentes.
            </p>
          </>
        )}
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <button className="button button-primary button-full" type="submit" disabled={busy}>
          {busy ? 'Salvando…' : 'Salvar cadastro'}
          <Icon name="check" />
        </button>
      </form>
    </Modal>
  );
}

function PasswordChange({ onSuccess }: { onSuccess: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <Dialog title="Proteja seu primeiro acesso">
      <p className="muted">
        Troque a senha inicial antes de acessar a operação. Após a troca, entre novamente com sua
        nova senha.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          if (f.get('newPassword') !== f.get('confirmation')) {
            setError('As novas senhas não coincidem.');
            return;
          }
          setBusy(true);
          setError('');
          try {
            await post('/auth/change-password', {
              currentPassword: f.get('currentPassword'),
              newPassword: f.get('newPassword'),
            });
            await logoutWeb().catch(() => {});
            onSuccess();
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Não foi possível alterar a senha.');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Senha atual
          <input
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </label>
        <label>
          Nova senha
          <input
            name="newPassword"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
          />
        </label>
        <label>
          Confirme a nova senha
          <input
            name="confirmation"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
          />
        </label>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <button className="button button-primary button-full" disabled={busy} type="submit">
          {busy ? 'Alterando…' : 'Alterar senha e entrar novamente'}
        </button>
      </form>
    </Dialog>
  );
}
