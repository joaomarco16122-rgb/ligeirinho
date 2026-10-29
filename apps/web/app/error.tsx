'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main id="conteudo" className="error-section">
      <h1>Não foi possível carregar esta página.</h1>
      <p>Tente novamente. Se o problema continuar, consulte a administração da operação.</p>
      <button className="button button-primary" onClick={reset}>
        Tentar novamente
      </button>
    </main>
  );
}
