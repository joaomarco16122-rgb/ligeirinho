import { PublicHeader, Footer } from '../../components/public-header';
import { Icon } from '../../components/icons';
export default function Downloads() {
  return (
    <>
      <PublicHeader />
      <main id="conteudo" className="wrap document-page">
        <span className="eyebrow">O LIGEIRINHO VAI COM VOCÊ</span>
        <h1>Aplicativos Android.</h1>
        <p>Dois aplicativos, cada um com as ferramentas certas para sua rotina.</p>
        <div className="download-grid">
          <article className="download-card">
            <Icon name="bike" size={34} />
            <h2>Para entregadores</h2>
            <p>Disponibilidade, ofertas, atendimento ativo e histórico em um só lugar.</p>
            <span className="status-badge status-gray">Distribuição ainda não disponível</span>
          </article>
          <article className="download-card">
            <Icon name="box" size={34} />
            <h2>Para estabelecimentos</h2>
            <p>Solicitações, acompanhamento e confirmação de atendimentos.</p>
            <span className="status-badge status-gray">Distribuição ainda não disponível</span>
          </article>
        </div>
        <h2>Como instalar</h2>
        <p>
          Os links serão disponibilizados após o build, assinatura e validação dos aplicativos pelo
          operador. Instale apenas arquivos e aplicativos distribuídos pelos canais oficiais da
          operação.
        </p>
        <p className="fine">
          Esta fase contempla Android. Não há aplicativo iOS ou portal web de entregador.
          Notificações e localização dependem das permissões e das condições do sistema operacional.
        </p>
      </main>
      <Footer />
    </>
  );
}
