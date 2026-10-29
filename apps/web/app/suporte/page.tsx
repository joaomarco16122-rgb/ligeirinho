import Link from 'next/link';
import { PublicHeader, Footer } from '../../components/public-header';
export default function Support() {
  return (
    <>
      <PublicHeader />
      <main id="conteudo" className="wrap document-page">
        <span className="eyebrow">PODEMOS AJUDAR</span>
        <h1>Um caminho para resolver.</h1>
        <p>
          Para solicitar cadastro, recuperar acesso ou tratar uma divergência, entre em contato com
          a administração responsável pelo seu estabelecimento.
        </p>
        <div className="info-banner">
          O canal oficial de suporte ainda não foi configurado pelo operador. Não envie senhas,
          documentos ou dados financeiros por canais não verificados.
        </div>
        <h2>Problemas para entrar?</h2>
        <p>
          Confira o e-mail cadastrado e as credenciais recebidas. Se o problema continuar, solicite
          à administração a redefinição da senha por um canal seguro.
        </p>
        <h2>Entrega com pendência?</h2>
        <p>
          Consulte o atendimento no portal. Após o aceite, o cancelamento depende da concordância
          das partes. Se houver divergência, a administração poderá intervir com justificativa e
          registro de auditoria.
        </p>
        <h2>Sem conexão?</h2>
        <p>
          Operações críticas só são consideradas concluídas após a confirmação do servidor.
          Reconecte-se e consulte o estado atual antes de tentar novamente.
        </p>
        <Link className="button button-primary" href="/login">
          Voltar para o acesso
        </Link>
      </main>
      <Footer />
    </>
  );
}
