import Link from 'next/link';
import { Icon } from './icons';
export function PublicHeader() {
  return (
    <header className="public-header wrap">
      <Link href="/" className="wordmark" aria-label="Ligeirinho, início">
        ligeirinho<span>.</span>
      </Link>
      <nav aria-label="Menu principal">
        <Link href="/#como-funciona">Como funciona</Link>
        <Link href="/downloads">Aplicativos</Link>
        <Link href="/suporte">Suporte</Link>
      </nav>
      <Link className="button button-dark button-small" href="/login">
        Acessar portal <Icon name="arrow" size={16} />
      </Link>
    </header>
  );
}
export function Footer() {
  return (
    <footer className="footer wrap">
      <div>
        <Link href="/" className="wordmark">
          ligeirinho<span>.</span>
        </Link>
        <p>Mais perto. Mais simples.</p>
      </div>
      <div className="footer-links">
        <Link href="/privacidade">Privacidade</Link>
        <Link href="/termos">Termos de uso</Link>
        <Link href="/suporte">Suporte</Link>
      </div>
      <p className="fine">© {new Date().getFullYear()} Ligeirinho</p>
    </footer>
  );
}
