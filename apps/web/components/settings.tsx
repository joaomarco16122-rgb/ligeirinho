'use client';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, ApiError, post, type User } from '../lib/api';
import { date } from '../lib/format';
import {
  displaySetting,
  isSettingKey,
  settingsDefinitions,
  settingsQuery,
  settingValue,
  sourceLabel,
  type SettingCatalog,
  type SettingEffective,
  type SettingHead,
  type SettingKey,
  type SettingRevision,
  type SettingTarget,
  type SettingValue,
} from '../lib/settings';
import { Dialog } from './dialog';
import { Icon } from './icons';

type Selection = {
  key: SettingKey;
  label: string;
  target: SettingTarget;
  version: number;
  value: SettingValue;
};
export function Settings({
  user,
  cities,
  revision = 0,
}: {
  user: User;
  cities: { id: string; name?: string; state?: string }[];
  revision?: number;
}) {
  const [scope, setScope] = useState<SettingTarget['scope']>(
    user.role === 'SUPER_ADMIN' ? 'GLOBAL' : 'CITY',
  );
  const [cityId, setCityId] = useState(user.cityId || '');
  const [catalog, setCatalog] = useState<SettingCatalog[]>([]);
  const [saved, setSaved] = useState<SettingHead[]>([]);
  const [effective, setEffective] = useState<Record<string, SettingEffective>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<Selection | null>(null);
  const [history, setHistory] = useState<Selection | null>(null);
  const requests = useRef(0);
  const target: SettingTarget = scope === 'GLOBAL' ? { scope } : { scope, scopeId: cityId };
  const load = useCallback(async () => {
    const request = ++requests.current;
    setError('');
    if (scope === 'CITY' && !cityId) {
      setCatalog([]);
      setSaved([]);
      setEffective({});
      setLoading(false);
      return;
    }
    setLoading(true);
    setCatalog([]);
    setSaved([]);
    setEffective({});
    try {
      const selected: SettingTarget = scope === 'GLOBAL' ? { scope } : { scope, scopeId: cityId };
      const [definitions, heads, resolved] = await Promise.all([
        api<SettingCatalog[]>('/admin/settings/catalog'),
        api<SettingHead[]>(`/admin/settings?${settingsQuery(selected)}`),
        api<Record<string, SettingEffective>>(
          `/admin/settings/effective${scope === 'CITY' ? `?${new URLSearchParams({ cityId })}` : ''}`,
        ),
      ]);
      if (request !== requests.current) return;
      setCatalog(
        definitions.filter(
          (definition) => isSettingKey(definition.key) && definition.scopes.includes(scope),
        ),
      );
      setSaved(heads);
      setEffective(resolved);
    } catch (err) {
      if (request === requests.current) {
        setError(
          err instanceof Error ? err.message : 'Não foi possível consultar as configurações.',
        );
        setCatalog([]);
        setSaved([]);
        setEffective({});
      }
    } finally {
      if (request === requests.current) setLoading(false);
    }
  }, [scope, cityId]);
  useEffect(() => {
    void load();
    return () => {
      requests.current += 1;
    };
  }, [load, revision]);
  function selection(definition: SettingCatalog): Selection {
    if (!isSettingKey(definition.key)) throw new Error('Configuração não permitida.');
    const current = saved.find(
      (entry) =>
        entry.key === definition.key &&
        entry.scope === scope &&
        entry.scopeId === (scope === 'GLOBAL' ? 'global' : cityId),
    );
    return {
      key: definition.key,
      label: definition.label,
      target: { ...target },
      version: current?.version ?? 0,
      value: current?.value ?? effective[definition.key]?.value ?? definition.defaultValue,
    };
  }
  function done(message: string) {
    setEditing(null);
    setHistory(null);
    setNotice(message);
    void load();
  }
  function review() {
    setEditing(null);
    setHistory(null);
    setNotice('');
    void load();
  }
  return (
    <div className="settings-layout">
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Configurações da operação</h2>
            <p>Valores permitidos, escopo explícito e histórico de cada alteração.</p>
          </div>
        </div>
        <div className="operations-content">
          <p className="muted">
            Este painel altera apenas configurações previstas no software. Ele não cria novas
            funções nem desativa proteções essenciais de segurança.
          </p>
          <div className="settings-scope">
            <label>
              Escopo
              <select
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value as SettingTarget['scope']);
                  setNotice('');
                }}
              >
                <option value="CITY">Cidade</option>
                {user.role === 'SUPER_ADMIN' && (
                  <option value="GLOBAL">Global — todas as cidades</option>
                )}
              </select>
            </label>
            {scope === 'CITY' && (
              <label>
                Cidade
                <select
                  value={cityId}
                  onChange={(e) => {
                    setCityId(e.target.value);
                    setNotice('');
                  }}
                >
                  <option value="" disabled>
                    Selecione uma cidade autorizada
                  </option>
                  {cities.map((city) => (
                    <option key={city.id} value={city.id}>
                      {city.name}
                      {city.state && ` · ${city.state}`}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p className="fine">
            A configuração da cidade prevalece sobre a global. Configurações específicas de
            estabelecimento ou usuário, quando aplicáveis, podem prevalecer neste contexto; este
            painel edita os níveis global e cidade.
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
        </div>
      </section>
      {loading ? (
        <section className="panel empty-state" role="status">
          Consultando valores salvos e efetivos…
        </section>
      ) : scope === 'CITY' && !cityId ? (
        <section className="panel empty-state">
          <Icon name="pin" size={30} />
          <h3>Escolha uma cidade.</h3>
          <p>Consulte e altere as configurações somente no escopo autorizado.</p>
        </section>
      ) : (
        <div className="settings-grid">
          {catalog.map((definition) => {
            const current = saved.find(
              (entry) =>
                entry.key === definition.key &&
                entry.scope === scope &&
                entry.scopeId === (scope === 'GLOBAL' ? 'global' : cityId),
            );
            const resolved = effective[definition.key];
            return (
              <article key={definition.key} className="panel setting-card">
                <div>
                  <span className="eyebrow">
                    {current
                      ? `VERSÃO ${current.version} NESTE ESCOPO`
                      : 'SEM SOBRESCRITA NESTE ESCOPO'}
                  </span>
                  <h3>{definition.label}</h3>
                  <code>{definition.key}</code>
                </div>
                <div className="setting-value">
                  <span>Valor efetivo para o contexto selecionado</span>
                  <strong>{displaySetting(resolved?.value ?? definition.defaultValue)}</strong>
                  <small>
                    {sourceLabel(resolved?.source ?? null)}
                    {resolved?.version ? ` · versão ${resolved.version}` : ''}
                  </small>
                </div>
                <p>{definition.effect}</p>
                {definition.key === 'features.optionalProof' && (
                  <p className="setting-reserved">
                    <Icon name="alert" size={16} />
                    Apenas reserva: foto, assinatura e PIN não são coletados nem exigidos por esta
                    opção.
                  </p>
                )}
                <div className="setting-actions">
                  <button
                    className="button button-outline button-small"
                    onClick={() => setEditing(selection(definition))}
                  >
                    Alterar valor
                  </button>
                  <button className="text-link" onClick={() => setHistory(selection(definition))}>
                    Ver histórico <Icon name="file" size={15} />
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {editing && (
        <SettingEditor
          selection={editing}
          onClose={() => setEditing(null)}
          onSaved={() => done('Configuração salva e auditada.')}
          onStale={review}
        />
      )}
      {history && (
        <SettingHistory
          selection={history}
          onClose={() => setHistory(null)}
          onSaved={() =>
            done('Valor restaurado em uma nova versão. O histórico anterior foi preservado.')
          }
          onStale={review}
        />
      )}
    </div>
  );
}
function conflictText(error: unknown) {
  return error instanceof ApiError && error.status === 409
    ? 'A configuração mudou desde sua consulta. Nenhum valor foi sobrescrito por esta tentativa. Atualize os valores e revise a versão atual antes de reenviar.'
    : error instanceof Error
      ? error.message
      : 'Não foi possível salvar a configuração.';
}
function SettingEditor({
  selection,
  onClose,
  onSaved,
  onStale,
}: {
  selection: Selection;
  onClose: () => void;
  onSaved: () => void;
  onStale: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const definition = settingsDefinitions[selection.key];
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setError('');
    setBusy(true);
    try {
      const value = settingValue(selection.key, values.get('value'));
      await api(`/admin/settings/${encodeURIComponent(selection.key)}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...selection.target,
          value,
          expectedVersion: selection.version,
          reason: String(values.get('reason')).trim(),
          confirm: true,
        }),
      });
      onSaved();
    } catch (err) {
      setError(conflictText(err));
      setStale(err instanceof ApiError && err.status === 409);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={`Alterar: ${selection.label}`} onClose={busy ? undefined : onClose}>
      <p className="fine">
        Escopo:{' '}
        {selection.target.scope === 'GLOBAL' ? 'Global' : `Cidade ${selection.target.scopeId}`} ·
        versão consultada: {selection.version}. Uma nova versão será criada.
      </p>
      <form onSubmit={submit}>
        {definition.kind === 'boolean' ? (
          <label className="checkbox-label">
            <input
              name="value"
              type="checkbox"
              defaultChecked={selection.value === true}
              disabled={busy || stale}
            />
            Reservar configuração do módulo opcional (sem coleta de comprovantes)
          </label>
        ) : (
          <label>
            Novo valor
            <input
              name="value"
              type={definition.kind === 'number' ? 'number' : 'tel'}
              defaultValue={String(selection.value)}
              min={definition.kind === 'number' ? definition.min : undefined}
              max={definition.kind === 'number' ? definition.max : undefined}
              step={definition.kind === 'number' ? 1 : undefined}
              maxLength={definition.kind === 'string' ? definition.maxLength : undefined}
              required={definition.kind === 'number'}
              disabled={busy || stale}
            />
          </label>
        )}
        <label>
          Motivo da alteração
          <input name="reason" required minLength={10} maxLength={500} disabled={busy || stale} />
        </label>
        <label className="checkbox-label">
          <input type="checkbox" required disabled={busy || stale} />
          Confirmei o escopo e revisei o impacto desta alteração.
        </label>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
        {stale ? (
          <button className="button button-primary button-full" type="button" onClick={onStale}>
            Fechar e atualizar valores para revisão
          </button>
        ) : (
          <button className="button button-primary button-full" type="submit" disabled={busy}>
            {busy ? 'Salvando…' : 'Salvar nova versão'}
            <Icon name="check" size={17} />
          </button>
        )}
      </form>
    </Dialog>
  );
}
function SettingHistory({
  selection,
  onClose,
  onSaved,
  onStale,
}: {
  selection: Selection;
  onClose: () => void;
  onSaved: () => void;
  onStale: () => void;
}) {
  const [entries, setEntries] = useState<SettingRevision[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const [chosen, setChosen] = useState<SettingRevision | null>(null);
  useEffect(() => {
    let alive = true;
    api<SettingRevision[]>(
      `/admin/settings/${encodeURIComponent(selection.key)}/history?${settingsQuery(selection.target)}`,
    )
      .then((data) => {
        if (alive) setEntries(data);
      })
      .catch((err) => {
        if (alive)
          setError(err instanceof Error ? err.message : 'Não foi possível consultar o histórico.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [selection]);
  async function rollback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chosen) return;
    setBusy(true);
    setError('');
    const values = new FormData(event.currentTarget);
    try {
      await post(`/admin/settings/${encodeURIComponent(selection.key)}/rollback`, {
        ...selection.target,
        toVersion: chosen.version,
        expectedVersion: selection.version,
        reason: String(values.get('reason')).trim(),
        confirm: true,
      });
      onSaved();
    } catch (err) {
      setError(conflictText(err));
      setStale(err instanceof ApiError && err.status === 409);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title={`Histórico: ${selection.label}`} wide onClose={busy ? undefined : onClose}>
      <p className="fine">
        Até 100 versões deste escopo. Restaurar copia o valor para uma nova versão e preserva todo o
        histórico. Versão consultada: {selection.version}.
      </p>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      {loading ? (
        <p role="status">Consultando versões…</p>
      ) : entries.length === 0 ? (
        <p className="muted">
          Não há versões salvas neste escopo. O valor efetivo é herdado ou padrão.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Versão / data</th>
                <th>Valor e motivo</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>
                    <strong>
                      v{entry.version}
                      {entry.version === selection.version ? ' · atual' : ''}
                    </strong>
                    <small>{date(entry.createdAt)}</small>
                    <small>{entry.actorId}</small>
                  </td>
                  <td>
                    <strong>{displaySetting(entry.value)}</strong>
                    <small>{entry.reason}</small>
                    {entry.rollbackOfVersion && (
                      <small>Restaurada da versão {entry.rollbackOfVersion}</small>
                    )}
                  </td>
                  <td>
                    {entry.version !== selection.version && (
                      <button
                        type="button"
                        className="text-link"
                        disabled={busy || stale}
                        onClick={() => setChosen(entry)}
                      >
                        Revisar restauração
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {chosen && !stale && (
        <form className="action-form" onSubmit={rollback}>
          <h3>Restaurar valor da versão {chosen.version}</h3>
          <p className="muted">
            Novo valor: <strong>{displaySetting(chosen.value)}</strong>
          </p>
          <label>
            Motivo da restauração
            <input name="reason" required minLength={10} maxLength={500} disabled={busy} />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" required disabled={busy} />
            Revisei o escopo e confirmo a criação de uma nova versão com este valor.
          </label>
          <button className="button button-primary button-small" type="submit" disabled={busy}>
            {busy ? 'Restaurando…' : 'Confirmar restauração'}
          </button>
        </form>
      )}
      {stale && (
        <button className="button button-primary button-full" onClick={onStale}>
          Fechar e atualizar valores para revisão
        </button>
      )}
    </Dialog>
  );
}
