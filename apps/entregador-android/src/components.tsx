import React, { useEffect, useState } from 'react';
import { Alert, AppState, Linking, Text, View } from 'react-native';
import { api, changePassword, currentUser, login } from './api';
import { label, money, type Delivery, type Message, type User } from './domain';
import { Button, Card, Field, Notice, Pill, styles } from './ui';
import { navigationUrls } from './history';

export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : 'Não foi possível conectar. Tente novamente.';
export function Login({ role, onLogin }: { role: User['role']; onLogin: (user: User) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    setBusy(true);
    setError('');
    try {
      onLogin(await login(email, password, role));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <View style={{ gap: 8, paddingVertical: 12 }}>
        <Text style={styles.overline}>Seu próximo atendimento começa aqui</Text>
        <Text style={styles.title}>Bom ter você por aqui.</Text>
        <Text style={styles.muted}>
          {role === 'COURIER'
            ? 'Entre para receber ofertas e acompanhar seus atendimentos.'
            : 'Solicite entregadores e acompanhe sua operação.'}
        </Text>
      </View>
      <Card>
        <Text style={styles.heading}>Acesse sua conta</Text>
        <Field
          label="E-mail"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <Field label="Senha" secureTextEntry value={password} onChangeText={setPassword} />
        {error ? <Notice text={error} error /> : null}
        <Button
          title="Entrar com segurança"
          onPress={submit}
          busy={busy}
          disabled={!email.trim() || !password}
        />
      </Card>
      <Notice text="Os cadastros são feitos exclusivamente pela administração. Caso precise de acesso ou recuperação de senha, fale com o administrador da sua cidade." />
    </>
  );
}
export function PasswordChange({ onChanged }: { onChanged: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit() {
    setBusy(true);
    setError('');
    try {
      if (next !== confirm) throw new Error('A confirmação da senha não confere.');
      await changePassword(current, next);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <Text style={styles.heading}>Proteja sua conta</Text>
      <Text style={styles.muted}>
        Troque a senha temporária antes de continuar. Depois, entre novamente com a nova senha.
      </Text>
      <Field label="Senha atual" secureTextEntry value={current} onChangeText={setCurrent} />
      <Field
        label="Nova senha (mínimo de 12 caracteres)"
        secureTextEntry
        value={next}
        onChangeText={setNext}
      />
      <Field
        label="Confirme a nova senha"
        secureTextEntry
        value={confirm}
        onChangeText={setConfirm}
      />
      {error ? <Notice error text={error} /> : null}
      <Button
        title="Salvar nova senha"
        onPress={submit}
        busy={busy}
        disabled={next.length < 12 || !current || !confirm}
      />
    </Card>
  );
}
export function DeliveryInfo({ delivery }: { delivery: Delivery }) {
  return (
    <>
      <View style={styles.row}>
        <Pill text={label(delivery.status)} />
        <Text style={styles.muted}>#{delivery.id.slice(-6).toUpperCase()}</Text>
      </View>
      <Text style={styles.heading}>{delivery.establishment?.name ?? 'Atendimento'}</Text>
      <Text style={styles.muted}>
        Coleta · {delivery.establishment?.address ?? 'Consulte o endereço na solicitação'}
      </Text>
      {delivery.stops.map((stop, index) => (
        <View key={stop.id ?? index} style={{ gap: 4 }}>
          <Text style={styles.overline}>Destino {index + 1}</Text>
          <Text style={styles.text}>{stop.address}</Text>
        </View>
      ))}
      <View style={styles.separator} />
      <Text style={[styles.heading, { fontSize: 25 }]}>{money(delivery.totalCents)}</Text>
      <Text style={styles.muted}>Valor combinado diretamente entre a loja e o entregador.</Text>
    </>
  );
}
export function Navigate({
  latitude,
  longitude,
  title = 'Abrir navegação',
}: {
  latitude: number;
  longitude: number;
  title?: string;
}) {
  let urls: { google: string; waze: string };
  try {
    urls = navigationUrls(latitude, longitude);
  } catch (error) {
    return <Notice error text={errorText(error)} />;
  }
  function open(url: string) {
    Linking.openURL(url).catch(() =>
      Alert.alert('Navegação indisponível', 'Instale um navegador ou aplicativo de mapas.'),
    );
  }
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{title}</Text>
      <Button secondary title="Abrir no Google Maps" onPress={() => open(urls.google)} />
      <Button secondary title="Abrir no Waze" onPress={() => open(urls.waze)} />
    </View>
  );
}

export function Chat({ deliveryId, canSend = true }: { deliveryId: string; canSend?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let mounted = true;
    let foreground = AppState.currentState === 'active';
    let inFlight = false;
    const refresh = async () => {
      if (!foreground || inFlight) return;
      inFlight = true;
      try {
        const next = await api<Message[]>(`/deliveries/${deliveryId}/messages`);
        if (mounted) {
          setMessages(next);
          setLoaded(true);
          setError('');
        }
      } catch (e) {
        if (mounted) setError(errorText(e));
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    const subscription = AppState.addEventListener('change', (state) => {
      foreground = state === 'active';
      if (foreground) void refresh();
    });
    return () => {
      mounted = false;
      clearInterval(timer);
      subscription.remove();
    };
  }, [deliveryId]);
  async function load() {
    setBusy(true);
    setError('');
    try {
      setMessages(await api<Message[]>(`/deliveries/${deliveryId}/messages`));
      setLoaded(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function send() {
    setBusy(true);
    setError('');
    try {
      await api(`/deliveries/${deliveryId}/messages`, 'POST', { text: text.trim() });
      setText('');
      setMessages(await api<Message[]>(`/deliveries/${deliveryId}/messages`));
      setLoaded(true);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <Text style={styles.heading}>Conversa do atendimento</Text>
      {!loaded ? (
        <Text style={styles.muted}>Abra a conversa para consultar as mensagens do servidor.</Text>
      ) : messages.length === 0 ? (
        <Text style={styles.muted}>Nenhuma mensagem ainda.</Text>
      ) : (
        messages.map((message) => (
          <View
            key={message.id}
            style={{ backgroundColor: '#f1f4eb', borderRadius: 12, padding: 12, gap: 4 }}
          >
            <Text style={[styles.muted, { fontWeight: '700' }]}>
              {message.sender?.name ??
                message.user?.name ??
                (message.userId === currentUser()?.id ? 'Você' : 'Outro participante')}{' '}
              ·{' '}
              {new Date(message.createdAt).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </Text>
            <Text style={styles.text}>{message.text}</Text>
          </View>
        ))
      )}
      {error ? <Notice error text={error} /> : null}
      <Button
        title={loaded ? 'Atualizar conversa' : 'Carregar conversa'}
        onPress={load}
        secondary
        busy={busy}
      />
      <Field
        label="Mensagem"
        multiline
        maxLength={2000}
        value={text}
        onChangeText={setText}
        editable={canSend}
      />
      {!canSend ? (
        <Text style={styles.muted}>
          O envio fica disponível após o aceite e durante o atendimento.
        </Text>
      ) : null}
      <Button
        title="Enviar mensagem"
        onPress={send}
        disabled={!canSend || !text.trim()}
        busy={busy}
      />
    </Card>
  );
}
