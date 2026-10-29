import Link from 'next/link';
import { PublicHeader, Footer } from '../components/public-header';
export default function NotFound() {
  return (
    <>
      <PublicHeader />
      <main id="conteudo" className="not-found">
        <span className="eyebrow">404 · CAMINHO NÃO ENCONTRADO</span>
        <h1>Vamos voltar ao início?</h1>
        <p className="muted">Esta página não está disponível.</p>
        <Link className="button button-primary" href="/">
          Ir para o início
        </Link>
      </main>
      <Footer />
    </>
  );
}
