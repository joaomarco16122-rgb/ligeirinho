'use client';
import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PublicHeader } from '../../components/public-header';
import { Icon } from '../../components/icons';
import { destination, type Role } from '../../lib/api';
import { canAccess, safeReturnPath } from '../../lib/supabase/policy';
import { loginWeb, restoreWebSession, webAuthProvider } from '../../lib/web-auth';
function nextDestination(role: Role) {
  const fallback = destination(role);
  const candidate = safeReturnPath(
    new URLSearchParams(window.location.search).get('next'),
    fallback,
  );
  return canAccess(role, new URL(candidate, window.location.origin).pathname)
    ? candidate
    : fallback;
}
export default function Login() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await webAuthProvider();
        const current = await restoreWebSession();
        if (alive && current) router.replace(nextDestination(current.user.role));
      } catch (err) {
        if (alive) {
          setUnavailable(true);
          setError(err instanceof Error ? err.message : 'A autenticação está indisponível.');
        }
      } finally {
        if (alive) setChecking(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [router]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setBusy(true);
    const data = new FormData(e.currentTarget);
    try {
      const result = await loginWeb(String(data.get('email')), String(data.get('password')));
      router.push(nextDestination(result.user.role));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Não foi possível entrar.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PublicHeader />
      <main id="conteudo" className="login-layout wrap">
        <aside className="login-story">
          <span className="eyebrow">SEU DELIVERY, EM MOVIMENTO.</span>
          <h1>
            Bom ter você
            <br />
            por aqui.
          </h1>
          <p>Um só lugar para organizar os atendimentos e acompanhar o que está a caminho.</p>
          <div className="login-decoration">
            <Icon name="bike" size={100} />
            <span>
              Mais perto.
              <br />
              <strong>Mais simples.</strong>
            </span>
          </div>
        </aside>
        <section className="login-card">
          <span className="small-icon">
            <Icon name="shield" size={24} />
          </span>
          <h2>Acesse sua conta</h2>
          <p className="muted">Use as credenciais fornecidas pela administração.</p>
          <form onSubmit={submit}>
            <label>
              E-mail
              <input
                name="email"
                type="email"
                autoComplete="username"
                placeholder="voce@estabelecimento.com.br"
                required
                maxLength={254}
              />
            </label>
            <label>
              Senha
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Digite sua senha"
                required
                maxLength={128}
              />
            </label>
            {error && (
              <p role="alert" className="alert alert-error">
                {error}
              </p>
            )}
            <button
              disabled={busy || checking || unavailable}
              className="button button-primary button-full"
              type="submit"
            >
              {checking ? 'Verificando autenticação…' : busy ? 'Entrando…' : 'Entrar'}
              <Icon name="arrow" />
            </button>
          </form>
          <p className="fine">
            Esqueceu sua senha ou ainda não tem acesso?
            <br />
            <Link href="/suporte">Fale com a administração</Link>.
          </p>
          <div className="login-note">
            <Icon name="bike" />
            <span>
              Entregadores acessam pelo aplicativo Android.
              <br />
              <Link href="/downloads">Informações sobre os aplicativos</Link>
            </span>
          </div>
        </section>
      </main>
    </>
  );
}
