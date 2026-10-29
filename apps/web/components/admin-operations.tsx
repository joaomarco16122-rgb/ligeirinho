'use client';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, post } from '../lib/api';
import { date } from '../lib/format';
import { Dialog } from './dialog';
import { Icon } from './icons';

type Registry = { id: string; name: string; cityId: string; active?: boolean };
type AuditEntry = {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  reason?: string | null;
  createdAt: string;
  metadata?: unknown;
};

export function DistributionRules({ revision = 0 }: { revision?: number }) {
  const [establishments, setEstablishments] = useState<Registry[]>([]);
  const [couriers, setCouriers] = useState<Registry[]>([]);
  const [selected, setSelected] = useState('');
  const [kind, setKind] = useState<'preferences' | 'blocks'>('preferences');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [places, riders] = await Promise.all([
        api<Registry[]>('/admin/establishments'),
        api<Registry[]>('/admin/couriers'),
      ]);
      setEstablishments(places);
      setCouriers(riders);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar os cadastros.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, revision]);
  const cityId = establishments.find((place) => place.id === selected)?.cityId;
  const eligibleCouriers = couriers.filter((c) => c.active !== false && c.cityId === cityId);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    setBusy(true);
    setError('');
    setNotice('');
    const common = {
      establishmentId: String(fields.get('establishmentId')),
      courierId: String(fields.get('courierId')),
    };
    try {
      await post(
        `/admin/${kind}`,
        kind === 'blocks'
          ? { ...common, reason: String(fields.get('reason')).trim() }
          : { ...common, priority: Number(fields.get('priority')) },
      );
      setNotice(
        kind === 'blocks'
          ? 'Bloqueio confirmado pelo servidor. O entregador não receberá novas ofertas deste estabelecimento.'
          : 'Preferência confirmada pelo servidor. Se o entregador não estiver elegível, a distribuição poderá seguir para outro.',
      );
      const reason = form.elements.namedItem('reason');
      if (reason instanceof HTMLInputElement) reason.value = '';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'A regra não foi salva.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel operations-panel">
      <div className="panel-heading">
        <div>
          <h2>Preferências e bloqueios por estabelecimento</h2>
          <p>Somente cadastros da mesma cidade podem ser associados.</p>
        </div>
        <button
          type="button"
          className="text-link"
          onClick={() => void load()}
          disabled={loading || busy}
        >
          <Icon name="refresh" size={16} />
          Recarregar cadastros
        </button>
      </div>
      <div className="operations-content">
        <p className="muted">
          A preferência orienta a ordem das ofertas; ela não garante exclusividade. O bloqueio
          impede novas ofertas para a combinação de estabelecimento e entregador. Um atendimento já
          aceito continua seguindo suas regras de execução.
        </p>
        <p className="fine">
          Esta tela envia ou atualiza regras individuais. A consulta e remoção de regras existentes
          ainda não estão disponíveis neste módulo; em caso de correção de bloqueio, procure o
          responsável técnico.
        </p>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="alert alert-success" role="status">
            {notice}
          </p>
        )}
        {loading ? (
          <p role="status">Carregando cadastros autorizados…</p>
        ) : establishments.length === 0 || couriers.length === 0 ? (
          <div className="empty-state">
            <Icon name="users" size={30} />
            <h3>Prepare os cadastros primeiro.</h3>
            <p>É necessário ter um estabelecimento e um entregador cadastrados na mesma cidade.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="operations-form">
            <label>
              Tipo de regra
              <select
                value={kind}
                onChange={(e) => {
                  setKind(e.target.value as 'preferences' | 'blocks');
                  setNotice('');
                }}
                disabled={busy}
              >
                <option value="preferences">Preferência de distribuição</option>
                <option value="blocks">Bloqueio de ofertas</option>
              </select>
            </label>
            <label>
              Estabelecimento
              <select
                name="establishmentId"
                value={selected}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setNotice('');
                }}
                required
                disabled={busy}
              >
                <option value="" disabled>
                  Selecione um estabelecimento
                </option>
                {establishments
                  .filter((e) => e.active !== false)
                  .map((e) => (
                    <option value={e.id} key={e.id}>
                      {e.name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Entregador da mesma cidade
              <select
                key={selected}
                name="courierId"
                defaultValue=""
                required
                disabled={!selected || busy}
              >
                <option value="" disabled>
                  Selecione um entregador
                </option>
                {eligibleCouriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {selected && eligibleCouriers.length === 0 && (
              <p className="fine">
                Não há entregadores ativos cadastrados para a cidade deste estabelecimento.
              </p>
            )}
            {kind === 'preferences' ? (
              <label>
                Prioridade (0 a 10.000)
                <input
                  name="priority"
                  type="number"
                  min={0}
                  max={10000}
                  step={1}
                  defaultValue={0}
                  required
                  disabled={busy}
                />
                <span className="field-note">
                  Valores menores têm preferência na ordem de distribuição.
                </span>
              </label>
            ) : (
              <>
                <label>
                  Motivo do bloqueio
                  <input
                    name="reason"
                    required
                    minLength={10}
                    maxLength={500}
                    placeholder="Explique o motivo com pelo menos 10 caracteres"
                    disabled={busy}
                  />
                </label>
                <label className="checkbox-label">
                  <input type="checkbox" required disabled={busy} />
                  Confirmo que o entregador deverá deixar de receber novas ofertas deste
                  estabelecimento.
                </label>
              </>
            )}
            <button
              className="button button-primary button-small"
              type="submit"
              disabled={busy || !selected || eligibleCouriers.length === 0}
            >
              {busy ? 'Salvando…' : kind === 'blocks' ? 'Confirmar bloqueio' : 'Salvar preferência'}
              <Icon name="check" size={17} />
            </button>
          </form>
        )}
      </div>
    </section>
  );
}

export function AuditLog({ revision = 0 }: { revision?: number }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setEntries(await api<AuditEntry[]>('/admin/audit'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível carregar a auditoria.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, revision]);
  const visible = entries.filter((entry) =>
    [entry.action, entry.actorId, entry.entityId, entry.entityType, entry.reason].some((value) =>
      String(value || '')
        .toLocaleLowerCase('pt-BR')
        .includes(query.toLocaleLowerCase('pt-BR')),
    ),
  );
  return (
    <section className="panel operations-panel">
      <div className="panel-heading">
        <div>
          <h2>Trilha de auditoria</h2>
          <p>Até os 200 eventos mais recentes. Acesso exclusivo do Super Admin.</p>
        </div>
        <button className="text-link" onClick={() => void load()} disabled={loading}>
          <Icon name="refresh" size={16} />
          Atualizar eventos
        </button>
      </div>
      <div className="operations-content">
        <p className="muted">
          Consulte quem realizou uma ação sensível, o recurso afetado e a justificativa registrada.
          Esta consulta não permite alterar o histórico.
        </p>
        <label>
          Buscar nesta consulta
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            type="search"
            placeholder="Ação, usuário, recurso ou motivo"
            maxLength={160}
          />
        </label>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {loading ? (
        <div className="empty-state" role="status">
          Carregando eventos de auditoria…
        </div>
      ) : visible.length === 0 ? (
        <div className="empty-state">
          <Icon name="file" size={30} />
          <h3>Nenhum evento encontrado.</h3>
          <p>Os eventos que corresponderem à consulta aparecerão aqui.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Quando / ação</th>
                <th>Responsável / recurso</th>
                <th>Justificativa</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <strong>{entry.action}</strong>
                    <small>{date(entry.createdAt)}</small>
                  </td>
                  <td>
                    <strong>{entry.actorId}</strong>
                    <small>
                      {entry.entityType} · {entry.entityId}
                    </small>
                  </td>
                  <td>{entry.reason || 'Sem justificativa adicional neste tipo de evento.'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export function ResetPassword({
  user,
  onClose,
  onSuccess,
}: {
  user: { id: string; name?: string; email?: string };
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const values = new FormData(event.currentTarget);
    if (values.get('password') !== values.get('confirmation')) {
      setError('As senhas temporárias não coincidem.');
      return;
    }
    setBusy(true);
    try {
      await post(`/admin/users/${user.id}/reset-password`, {
        password: String(values.get('password')),
        reason: String(values.get('reason')).trim(),
        confirm: true,
      });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível redefinir a senha.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Redefinir credencial de acesso" onClose={busy ? undefined : onClose}>
      <p className="muted">
        Conta: <strong>{user.name || user.email || user.id}</strong>
      </p>
      <p className="fine">
        Todas as sessões da pessoa serão revogadas. Ela precisará trocar esta senha temporária no
        próximo acesso. Compartilhe a credencial somente por um canal seguro.
      </p>
      <form onSubmit={submit}>
        <label>
          Senha temporária
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            disabled={busy}
          />
        </label>
        <label>
          Confirme a senha temporária
          <input
            type="password"
            name="confirmation"
            autoComplete="new-password"
            required
            minLength={12}
            maxLength={128}
            disabled={busy}
          />
        </label>
        <label>
          Motivo da redefinição
          <input name="reason" required minLength={10} maxLength={500} disabled={busy} />
        </label>
        <label className="checkbox-label">
          <input type="checkbox" required disabled={busy} />
          Confirmo a redefinição e a revogação das sessões desta conta.
        </label>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        <button className="button button-primary button-full" type="submit" disabled={busy}>
          {busy ? 'Redefinindo…' : 'Redefinir senha e revogar sessões'}
          <Icon name="shield" size={17} />
        </button>
      </form>
    </Dialog>
  );
}
