import { PublicHeader, Footer } from '../../components/public-header';
export default function Terms() {
  return (
    <>
      <PublicHeader />
      <main id="conteudo" className="wrap document-page">
        <span className="eyebrow">INFORMAÇÕES DE USO</span>
        <h1>Termos de uso</h1>
        <div className="info-banner">
          Versão de desenvolvimento. O responsável pela operação deverá completar a identificação
          jurídica, as condições comerciais e os canais de atendimento antes da abertura ao público.
        </div>
        <h2>Como a plataforma funciona</h2>
        <p>
          O Ligeirinho conecta estabelecimentos cadastrados a entregadores elegíveis. A
          disponibilidade depende da área de atendimento, localização recente, horários e regras da
          operação. Uma solicitação não garante a disponibilidade imediata de um entregador.
        </p>
        <h2>Cadastros e credenciais</h2>
        <p>
          Os cadastros são feitos pela administração. Cada pessoa deve usar apenas sua própria conta
          e manter suas credenciais protegidas. Bloqueios e permissões podem limitar as funções
          disponíveis.
        </p>
        <h2>Entregas e confirmação</h2>
        <p>
          A cotação é apresentada antes da solicitação. Após o aceite, cancelamentos dependem da
          concordância das partes ou de intervenção administrativa justificada. O atendimento é
          finalizado após a conclusão do entregador e a confirmação do estabelecimento.
        </p>
        <h2>Valores e pagamentos</h2>
        <p>
          O pagamento da entrega acontece diretamente entre estabelecimento e entregador. Os valores
          registrados no histórico representam entregas, sem comprovar seu recebimento. Eventuais
          cobranças da plataforma são separadas e dependem do plano contratado.
        </p>
        <h2>Responsável e atendimento</h2>
        <p>
          O operador deverá informar neste documento sua razão social, CNPJ, endereço, contato,
          regras comerciais e procedimento de contestação. Este texto inicial exige revisão jurídica
          e não constitui adequação legal automática.
        </p>
      </main>
      <Footer />
    </>
  );
}
