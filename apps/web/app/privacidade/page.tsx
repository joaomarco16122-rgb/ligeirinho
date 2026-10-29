import { PublicHeader, Footer } from '../../components/public-header';
export default function Privacy() {
  return (
    <>
      <PublicHeader />
      <main id="conteudo" className="wrap document-page">
        <span className="eyebrow">CUIDADO COM SEUS DADOS</span>
        <h1>Privacidade</h1>
        <div className="info-banner">
          Política inicial para desenvolvimento. O operador deverá informar controlador, bases
          legais, prazos de retenção e canal de direitos dos titulares antes de iniciar a operação
          pública.
        </div>
        <h2>Dados necessários à operação</h2>
        <p>
          A plataforma trata dados de cadastro, contato, autenticação, endereços dos atendimentos,
          eventos de entrega e mensagens. O acesso é limitado aos perfis autorizados para cada
          atendimento.
        </p>
        <h2>Localização do entregador</h2>
        <p>
          A localização deve ser coletada com a permissão do Android, durante o trabalho e para
          distribuição e acompanhamento autorizados. O estabelecimento somente pode acompanhar um
          entregador vinculado a um atendimento permitido.
        </p>
        <h2>Segurança e fornecedores</h2>
        <p>
          Senhas são armazenadas em formato de hash, sessões podem ser revogadas e ações sensíveis
          são auditadas. Mapas, notificações e armazenamento podem depender de fornecedores externos
          configurados pelo operador. Nenhum sistema elimina integralmente os riscos de segurança.
        </p>
        <h2>Seus direitos</h2>
        <p>
          Solicitações de acesso, correção, exclusão ou informações sobre tratamento devem ser
          encaminhadas ao responsável pela operação. A exclusão pode estar sujeita a retenções
          justificadas por obrigações legais e segurança.
        </p>
        <h2>Retenção e contato</h2>
        <p>
          Os prazos e as rotinas de eliminação precisam ser aprovados pelo operador. O canal de
          privacidade e a identificação do controlador ainda devem ser preenchidos. Este documento
          não afirma conformidade jurídica automática com a LGPD.
        </p>
      </main>
      <Footer />
    </>
  );
}
