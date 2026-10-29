import React, { useState } from 'react';
import { Share, Text, View } from 'react-native';
import configuration from '../app.json';
import { apiDestination } from './api';
import { errorText } from './components';
import { supportReport } from './support';
import { Button, Card, Notice, styles } from './ui';

export function SupportCard({
  audience,
  lastSyncAt,
  status,
}: {
  audience: 'courier' | 'establishment';
  lastSyncAt: number | null;
  status?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function share() {
    setBusy(true);
    setError('');
    try {
      await Share.share({
        title: 'Suporte Ligeirinho',
        message: supportReport({
          audience,
          lastSyncAt,
          status,
          version: configuration.expo.version,
          apiUrl: apiDestination(),
        }),
      });
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  }
  const answers =
    audience === 'courier'
      ? [
          [
            'A oferta expirou antes do aceite',
            'O servidor controla o prazo. Após a expiração, aguarde outra oferta; reabrir a tela não recupera uma oferta vencida.',
          ],
          [
            'Concluí e continuo em atendimento',
            'O estabelecimento precisa confirmar todas as entregas. Se houver divergência, converse no chat do atendimento e procure a administração.',
          ],
          [
            'Fiquei sem conexão',
            'Retorne ao aplicativo para sincronizar. Confira a situação confirmada pelo servidor antes de repetir uma ação. Nenhum aceite ou conclusão é confirmado offline.',
          ],
          [
            'Como recebo o pagamento?',
            'Combine o pagamento diretamente com o estabelecimento. Os ganhos exibidos registram os valores de entregas finalizadas e não comprovam recebimento.',
          ],
        ]
      : [
          [
            'Estou aguardando um entregador',
            'O servidor procura entregadores elegíveis. Você pode continuar aguardando ou cancelar antes do aceite. Após o aceite, o cancelamento depende da outra parte.',
          ],
          [
            'Há uma entrega com divergência',
            'Confira os destinos e converse no chat do atendimento. Confirme a conclusão apenas quando estiver tudo certo; se precisar, solicite intervenção da administração.',
          ],
          [
            'A conexão caiu ao solicitar',
            'Retorne ao aplicativo e confira a lista atualizada antes de solicitar novamente. A confirmação depende da resposta do servidor.',
          ],
          [
            'Como altero cadastro ou equipe?',
            'Entre em contato com a administração da sua cidade. Ela gerencia os cadastros e as permissões de acesso.',
          ],
        ];
  return (
    <Card>
      <Text style={styles.heading}>Precisa de ajuda?</Text>
      <Text style={styles.muted}>
        Use o canal de atendimento informado pela administração da sua cidade. Você pode
        compartilhar um diagnóstico para ajudar na análise.
      </Text>
      {answers.map(([question, answer]) => (
        <View key={question} style={{ gap: 5 }}>
          <Text style={styles.label}>{question}</Text>
          <Text style={styles.muted}>{answer}</Text>
        </View>
      ))}
      <Text style={styles.muted}>
        O diagnóstico contém versão do app, horários de sincronização, situação e endereço do
        servidor. Escolha o destinatário no compartilhamento do Android.
      </Text>
      <Button
        title="Compartilhar diagnóstico para suporte"
        secondary
        busy={busy}
        onPress={() => void share()}
      />
      {error ? <Notice error text={error} /> : null}
    </Card>
  );
}
