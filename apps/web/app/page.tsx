import Link from 'next/link';
import { PublicHeader, Footer } from '../components/public-header';
import { Icon } from '../components/icons';
export default function Home() {
  return (
    <>
      <PublicHeader />
      <main id="conteudo">
        <section className="hero wrap">
          <div className="hero-copy">
            <span className="eyebrow">
              <span className="dot" /> FEITO PARA O SEU DELIVERY
            </span>
            <h1>
              Sua próxima entrega.
              <br />
              <span>Já em movimento.</span>
            </h1>
            <p className="lead">
              Você cuida do seu negócio. A gente conecta você a quem leva mais longe.
            </p>
            <p className="muted hero-detail">
              Solicite um entregador disponível, acompanhe o atendimento e confirme a conclusão.
              Tudo em um só lugar.
            </p>
            <div className="hero-actions">
              <Link className="button button-primary" href="/login">
                Entrar no meu estabelecimento <Icon name="arrow" />
              </Link>
              <a href="#como-funciona" className="text-link">
                Conheça o Ligeirinho
              </a>
            </div>
            <div className="hero-footnote">
              <Icon name="shield" size={17} />
              <span>Pagamento da entrega direto ao entregador.</span>
            </div>
          </div>
          <div
            className="journey-art"
            aria-label="Ilustração do caminho entre estabelecimento e destino"
            role="img"
          >
            <div className="art-grid" />
            <div className="art-label">
              <span className="dot" /> CADA ENTREGA TEM UM CAMINHO.
            </div>
            <svg className="route-art" viewBox="0 0 500 400" fill="none" aria-hidden="true">
              <path
                d="M100 280V190Q100 160 130 160H340Q375 160 375 125V100"
                stroke="#e0ded7"
                strokeWidth="48"
              />
              <path
                d="M100 280V190Q100 160 130 160H340Q375 160 375 125V100"
                stroke="#eaaa22"
                strokeWidth="3"
                strokeDasharray="7 8"
              />
              <circle cx="100" cy="280" r="10" fill="#132b3b" />
              <circle cx="375" cy="100" r="10" fill="#f5b52c" />
            </svg>
            <div className="route-card route-origin">
              <div className="route-icon">
                <Icon name="box" size={26} />
              </div>
              <div>
                <small>PONTO DE PARTIDA</small>
                <strong>Seu estabelecimento</strong>
                <span>Uma nova entrega começa aqui</span>
              </div>
            </div>
            <div className="rider-marker">
              <Icon name="bike" size={35} />
            </div>
            <div className="route-card route-destination">
              <div className="route-icon route-icon-yellow">
                <Icon name="pin" size={25} />
              </div>
              <div>
                <small>O PRÓXIMO DESTINO</small>
                <strong>Mais um cliente atendido</strong>
                <span>Conexões que vão mais longe</span>
              </div>
            </div>
            <div className="art-caption">
              Do seu balcão ao próximo destino.
              <Icon name="arrow" size={18} />
            </div>
          </div>
        </section>
        <section className="benefits wrap" aria-label="Diferenciais">
          <div>
            <Icon name="pin" />
            <span>Conexões por proximidade</span>
          </div>
          <div>
            <Icon name="clock" />
            <span>Ofertas com prazo no servidor</span>
          </div>
          <div>
            <Icon name="shield" />
            <span>Confirmação pelas duas partes</span>
          </div>
        </section>
        <section id="como-funciona" className="steps-section wrap">
          <div className="section-heading">
            <div>
              <span className="eyebrow">MENOS ETAPAS. MAIS CAMINHO.</span>
              <h2>Simples do início ao fim.</h2>
            </div>
            <p>
              Uma rotina mais organizada para quem pede
              <br className="desktop-only" /> e para quem faz a entrega.
            </p>
          </div>
          <div className="steps-grid">
            {[
              {
                n: '01',
                icon: 'box',
                title: 'Solicite a entrega',
                text: 'Informe os destinos, confira a cotação e confirme a solicitação no portal.',
              },
              {
                n: '02',
                icon: 'bike',
                title: 'Encontre quem entrega',
                text: 'O sistema oferece o atendimento a um entregador elegível de cada vez.',
              },
              {
                n: '03',
                icon: 'check',
                title: 'Acompanhe e confirme',
                text: 'Veja o andamento e confirme a conclusão após o entregador finalizar.',
              },
            ].map((x) => (
              <article className="step-card" key={x.n}>
                <div className="step-top">
                  <span className="step-icon">
                    <Icon name={x.icon} size={26} />
                  </span>
                  <span className="step-number">{x.n}</span>
                </div>
                <h3>{x.title}</h3>
                <p>{x.text}</p>
              </article>
            ))}
          </div>
        </section>
        <section className="business-band wrap">
          <div>
            <span className="eyebrow">CADA NEGÓCIO TEM SEU RITMO.</span>
            <h2>
              O seu delivery merece
              <br />
              um caminho mais simples.
            </h2>
            <p>
              Os cadastros são realizados pela administração.
              <br />
              Já tem acesso? Seu próximo atendimento começa no portal.
            </p>
          </div>
          <Link href="/login" className="button button-primary">
            Acessar minha conta <Icon name="arrow" />
          </Link>
        </section>
      </main>
      <Footer />
    </>
  );
}
