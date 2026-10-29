import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import { api, apiDestination, logout, restore, serverNow } from './src/api';
import { HistoryPanel } from './src/history-panel';
import { SupportCard } from './src/support-card';
import { Chat, DeliveryInfo, errorText, Login, Navigate, PasswordChange } from './src/components';
import {
  finalStatuses,
  money,
  parseCoordinate,
  remainingSeconds,
  type Delivery,
  type Quote,
  type Stop,
  type User,
} from './src/domain';
import { Button, Card, colors, Field, Notice, styles } from './src/ui';

type DraftStop = { key: string; address: string; latitude: string; longitude: string };
const emptyStop = (): DraftStop => ({
  key: Crypto.randomUUID(),
  address: '',
  latitude: '',
  longitude: '',
});
export default function App() {
  return (
    <SafeAreaProvider>
      <Application />
    </SafeAreaProvider>
  );
}
function Application() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState('inicio');
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [active, setActive] = useState(
    AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
  );
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const foregroundSync = useRef<() => Promise<void>>(async () => {});
  const [stops, setStops] = useState<DraftStop[]>([emptyStop()]);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [reason, setReason] = useState('');
  const [now, setNow] = useState(Date.now());
  const requestId = useRef(Crypto.randomUUID());
  const syncing = useRef(false);
  const userRef = useRef(user);
  userRef.current = user;
  useEffect(() => {
    restore('ESTABLISHMENT')
      .then(setUser)
      .catch((e) => setError(errorText(e)))
      .finally(() => setReady(true));
    const sub = AppState.addEventListener('change', (state) => {
      setActive(state === 'active');
      if (state === 'active') void foregroundSync.current();
    });
    return () => sub.remove();
  }, []);
  const sync = useCallback(async () => {
    if (!user || user.mustChangePassword || syncing.current) return;
    syncing.current = true;
    try {
      const next = await api<Delivery[]>('/deliveries');
      if (userRef.current?.id !== user.id) return;
      setDeliveries(next);
      setLastSyncAt(Date.now());
      setError('');
    } catch (e) {
      setError(errorText(e));
    } finally {
      syncing.current = false;
      setRefreshing(false);
    }
  }, [user]);
  foregroundSync.current = sync;
  useEffect(() => {
    if (!active) return;
    void sync();
    const timer = setInterval(() => void sync(), 5000);
    return () => clearInterval(timer);
  }, [sync, active]);
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), 1000);
    return () => clearInterval(timer);
  }, []);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  function invalidate() {
    setQuote(null);
    requestId.current = Crypto.randomUUID();
  }
  function editStop(key: string, patch: Partial<DraftStop>) {
    invalidate();
    setStops((previous) =>
      previous.map((stop) => (stop.key === key ? { ...stop, ...patch } : stop)),
    );
  }
  function validatedStops(): Stop[] {
    return stops.map((stop, index) => {
      if (stop.address.trim().length < 5)
        throw new Error(`Informe o endereço completo do destino ${index + 1}.`);
      return {
        address: stop.address.trim(),
        latitude: parseCoordinate(stop.latitude, 'latitude'),
        longitude: parseCoordinate(stop.longitude, 'longitude'),
      };
    });
  }
  async function quoteRequest() {
    await run(async () => {
      const next = await api<Quote>('/deliveries/quote', 'POST', { stops: validatedStops() });
      setQuote(next);
      setNow(serverNow());
    });
  }
  async function createRequest() {
    await run(async () => {
      if (!quote || remainingSeconds(quote.expiresAt, serverNow()) === 0)
        throw new Error('A cotação expirou. Calcule novamente antes de solicitar.');
      const delivery = await api<Delivery>('/deliveries', 'POST', {
        quoteId: quote.id,
        idempotencyKey: requestId.current,
        stops: validatedStops(),
      });
      setNotice('Solicitação confirmada pelo servidor. Aguarde a atribuição de um entregador.');
      setQuote(null);
      setStops([emptyStop()]);
      requestId.current = Crypto.randomUUID();
      setSelected(delivery.id);
      setTab('inicio');
      await sync();
    });
  }
  async function gps(key: string) {
    await run(async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== 'granted')
        throw new Error('Localização não autorizada. Preencha as coordenadas manualmente.');
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      editStop(key, {
        latitude: String(position.coords.latitude),
        longitude: String(position.coords.longitude),
      });
      setNotice(
        'Coordenadas do aparelho preenchidas. Confira se correspondem ao destino desejado.',
      );
    });
  }
  async function exit() {
    try {
      await logout();
    } catch {
      Alert.alert(
        'Sessão local encerrada',
        'Não foi possível confirmar a revogação no servidor. Ela seguirá sujeita ao prazo de expiração.',
      );
    }
    setLastSyncAt(null);
    userRef.current = null;
    setUser(null);
    setDeliveries([]);
    setQuote(null);
    setSelected(null);
    setStops([emptyStop()]);
    setReason('');
    setError('');
    setNotice('');
    setTab('inicio');
    requestId.current = Crypto.randomUUID();
  }
  const pending = deliveries.filter((delivery) => !finalStatuses.has(delivery.status));
  const current = deliveries.find((delivery) => delivery.id === selected);
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.brand}>Ligeirinho</Text>
        <Text style={{ color: '#c8d3c7', fontSize: 12, marginTop: 4 }}>
          ESTABELECIMENTO · ANDROID
        </Text>
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            user ? (
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => {
                  setRefreshing(true);
                  void sync();
                }}
              />
            ) : undefined
          }
          keyboardShouldPersistTaps="handled"
        >
          {!ready ? (
            <ActivityIndicator size="large" color={colors.ink} />
          ) : !user ? (
            <>
              {error ? <Notice error text={error} /> : null}
              <Login role="ESTABLISHMENT" onLogin={setUser} />
            </>
          ) : user.mustChangePassword ? (
            <PasswordChange onChanged={() => setUser(null)} />
          ) : (
            <>
              <Text style={styles.overline}>Olá, {user.name.split(' ')[0]}</Text>
              <Text style={styles.muted}>
                {lastSyncAt
                  ? `Última atualização confirmada: ${new Date(lastSyncAt).toLocaleTimeString('pt-BR')}`
                  : 'Aguardando sincronização com o servidor.'}
              </Text>
              <Text style={styles.title}>
                {tab === 'inicio'
                  ? 'Sua operação, em dia.'
                  : tab === 'solicitar'
                    ? 'Uma nova entrega.'
                    : tab === 'historico'
                      ? 'Seu histórico.'
                      : 'Sua conta.'}
              </Text>
              {error ? (
                <Notice
                  error
                  text={`${error} Aguarde a confirmação do servidor antes de considerar uma ação concluída.`}
                />
              ) : null}
              {notice ? <Notice text={notice} /> : null}
              {tab === 'solicitar' ? (
                <>
                  <Notice text="A coleta usa o endereço cadastrado do estabelecimento. Informe cada destino separadamente. A busca automática de endereços ainda depende do provedor de mapas; confira as coordenadas." />
                  {stops.map((stop, index) => (
                    <Card key={stop.key}>
                      <Text style={styles.heading}>Destino {index + 1}</Text>
                      <Field
                        label="Endereço completo"
                        value={stop.address}
                        onChangeText={(address) => editStop(stop.key, { address })}
                        maxLength={300}
                        multiline
                        editable={!busy}
                      />
                      <Field
                        label="Latitude do destino"
                        keyboardType="numbers-and-punctuation"
                        value={stop.latitude}
                        onChangeText={(latitude) => editStop(stop.key, { latitude })}
                        placeholder="Ex.: -23.5505"
                        editable={!busy}
                      />
                      <Field
                        label="Longitude do destino"
                        keyboardType="numbers-and-punctuation"
                        value={stop.longitude}
                        onChangeText={(longitude) => editStop(stop.key, { longitude })}
                        placeholder="Ex.: -46.6333"
                        editable={!busy}
                      />
                      <Button
                        title="Usar localização deste aparelho"
                        secondary
                        busy={busy}
                        onPress={() => void gps(stop.key)}
                      />
                      {stops.length > 1 ? (
                        <Button
                          title="Remover destino"
                          secondary
                          disabled={busy}
                          onPress={() => {
                            invalidate();
                            setStops((previous) =>
                              previous.filter((value) => value.key !== stop.key),
                            );
                          }}
                        />
                      ) : null}
                    </Card>
                  ))}
                  <Button
                    title="+ Adicionar outro destino"
                    secondary
                    disabled={stops.length >= 20 || busy}
                    onPress={() => {
                      invalidate();
                      setStops((previous) => [...previous, emptyStop()]);
                    }}
                  />
                  <Button
                    title="Calcular cotação no servidor"
                    onPress={() => void quoteRequest()}
                    busy={busy}
                  />
                  {quote ? (
                    <Card>
                      <Text style={styles.overline}>Cotação antes de confirmar</Text>
                      <Text style={styles.title}>{money(quote.totalCents)}</Text>
                      <Text style={styles.muted}>
                        {stops.length} destino(s) · {Number(quote.distanceKm).toFixed(2)} km ·
                        validade {remainingSeconds(quote.expiresAt, now)}s
                      </Text>
                      <Notice text="O pagamento da entrega é feito diretamente ao entregador. A distância pode usar estimativa geográfica quando o provedor de rotas não estiver configurado." />
                      <Button
                        title="Confirmar e solicitar entregador"
                        busy={busy}
                        disabled={remainingSeconds(quote.expiresAt, now) === 0}
                        onPress={() =>
                          Alert.alert(
                            'Confirmar solicitação?',
                            `${stops.length} destino(s) por ${money(quote.totalCents)}. O valor será registrado no atendimento.`,
                            [
                              { text: 'Voltar', style: 'cancel' },
                              { text: 'Solicitar', onPress: () => void createRequest() },
                            ],
                          )
                        }
                      />
                    </Card>
                  ) : null}
                </>
              ) : tab === 'inicio' || tab === 'historico' ? (
                <>
                  {!current ? (
                    tab === 'historico' ? (
                      <HistoryPanel
                        deliveries={deliveries}
                        kind="establishment"
                        onSelect={(delivery) => setSelected(delivery.id)}
                      />
                    ) : (
                      <>
                        <Card>
                          <Text style={styles.overline}>Acompanhamento</Text>
                          <Text style={styles.title}>
                            {pending.length} em andamento nesta consulta
                          </Text>
                          <Text style={styles.muted}>
                            Consulta dos até 100 atendimentos mais recentes. Puxe para atualizar os
                            dados do servidor.
                          </Text>
                          <Button
                            title="Solicitar entregador"
                            onPress={() => setTab('solicitar')}
                          />
                        </Card>
                        {pending.length === 0 ? (
                          <Card>
                            <Text style={styles.heading}>
                              Nenhuma entrega pendente nesta consulta
                            </Text>
                            <Text style={styles.muted}>
                              Os atendimentos confirmados pelo servidor aparecerão nesta área.
                            </Text>
                          </Card>
                        ) : (
                          pending.map((delivery) => (
                            <Card key={delivery.id}>
                              <DeliveryInfo delivery={delivery} />
                              <Button
                                title="Ver atendimento"
                                secondary
                                onPress={() => setSelected(delivery.id)}
                              />
                            </Card>
                          ))
                        )}
                      </>
                    )
                  ) : (
                    <>
                      <Button
                        secondary
                        title="← Voltar para a lista"
                        onPress={() => setSelected(null)}
                      />
                      <Card>
                        <DeliveryInfo delivery={current} />
                        {current.courier ? (
                          <>
                            <Text style={styles.text}>Entregador: {current.courier.name}</Text>
                            {typeof current.courier.latitude === 'number' &&
                            typeof current.courier.longitude === 'number' &&
                            !finalStatuses.has(current.status) ? (
                              <Navigate
                                latitude={current.courier.latitude}
                                longitude={current.courier.longitude}
                                title="Ver localização autorizada no mapa"
                              />
                            ) : null}
                          </>
                        ) : (
                          <Notice text="Aguardando entregador elegível. Você pode continuar aguardando ou cancelar antes do aceite." />
                        )}
                        {['AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO', 'ENTREGADOR_CONCLUIU'].includes(
                          current.status,
                        ) ? (
                          <>
                            <Notice text="O entregador informou a conclusão. Confira todas as entregas antes de confirmar e liberá-lo." />
                            <Button
                              title={`Confirmar ${current.stops.length} entrega(s) e liberar entregador`}
                              busy={busy}
                              onPress={() =>
                                Alert.alert(
                                  'Está tudo certo com as entregas?',
                                  'Esta confirmação finaliza o atendimento e libera o entregador.',
                                  [
                                    { text: 'Conferir depois', style: 'cancel' },
                                    {
                                      text: 'Confirmar conclusão',
                                      onPress: () =>
                                        void run(async () => {
                                          await api(`/deliveries/${current.id}/confirm`, 'POST', {
                                            stopCount: current.stops.length,
                                          });
                                          await sync();
                                        }),
                                    },
                                  ],
                                )
                              }
                            />
                          </>
                        ) : null}
                        {!finalStatuses.has(current.status) ? (
                          current.status === 'CANCELAMENTO_SOLICITADO' ? (
                            <>
                              <Notice text="Há um cancelamento solicitado. Concorde apenas se desejar encerrar o atendimento. O servidor exige a aprovação da outra parte." />
                              <Button
                                title={
                                  current.cancellations?.[0]?.requestedByRole === 'ESTABLISHMENT'
                                    ? 'Aguardando confirmação do entregador'
                                    : 'Concordar com cancelamento'
                                }
                                disabled={
                                  current.cancellations?.[0]?.requestedByRole === 'ESTABLISHMENT'
                                }
                                danger
                                busy={busy}
                                onPress={() =>
                                  Alert.alert(
                                    'Aprovar cancelamento?',
                                    'A decisão será registrada no histórico.',
                                    [
                                      { text: 'Voltar', style: 'cancel' },
                                      {
                                        text: 'Aprovar',
                                        style: 'destructive',
                                        onPress: () =>
                                          void run(async () => {
                                            await api(
                                              `/deliveries/${current.id}/cancellation/approve`,
                                              'POST',
                                              {},
                                            );
                                            await sync();
                                          }),
                                      },
                                    ],
                                  )
                                }
                              />
                            </>
                          ) : (
                            <>
                              <Field
                                label="Motivo do cancelamento"
                                value={reason}
                                onChangeText={setReason}
                                multiline
                                maxLength={500}
                              />
                              <Button
                                title="Solicitar cancelamento"
                                secondary
                                busy={busy}
                                disabled={reason.trim().length < 5}
                                onPress={() =>
                                  Alert.alert(
                                    'Cancelar atendimento?',
                                    'Antes do aceite, o cancelamento é imediato. Após o aceite, o entregador precisará concordar.',
                                    [
                                      { text: 'Voltar', style: 'cancel' },
                                      {
                                        text: 'Solicitar',
                                        onPress: () =>
                                          void run(async () => {
                                            await api(
                                              `/deliveries/${current.id}/cancellation`,
                                              'POST',
                                              { reason: reason.trim() },
                                            );
                                            setReason('');
                                            await sync();
                                          }),
                                      },
                                    ],
                                  )
                                }
                              />
                            </>
                          )
                        ) : null}
                      </Card>
                      <Chat
                        key={current.id}
                        deliveryId={current.id}
                        canSend={!finalStatuses.has(current.status) && Boolean(current.courier)}
                      />
                    </>
                  )}
                </>
              ) : (
                <>
                  <Card>
                    <Text style={styles.heading}>{user.name}</Text>
                    <Text style={styles.muted}>
                      Perfil do estabelecimento. Para alterar dados cadastrais, equipe ou
                      permissões, fale com a administração.
                    </Text>
                    <Text selectable style={styles.muted}>
                      Servidor: {apiDestination()}
                    </Text>
                    <Button secondary title="Sincronizar agora" onPress={() => void sync()} />
                    <Button danger title="Sair da conta" onPress={() => void exit()} />
                  </Card>
                  <SupportCard audience="establishment" lastSyncAt={lastSyncAt} />
                  <Notice text="Solicitações e confirmações exigem conexão. Confira os endereços informados antes de solicitar. Os cadastros são feitos pela administração." />
                </>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      {user && !user.mustChangePassword ? (
        <View style={styles.tabs}>
          {[
            ['inicio', 'Início'],
            ['solicitar', 'Solicitar'],
            ['historico', 'Histórico'],
            ['conta', 'Conta'],
          ].map(([id, text]) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === id }}
              key={id}
              style={[styles.tab, tab === id && { backgroundColor: colors.green }]}
              onPress={() => {
                setTab(id);
                setSelected(null);
              }}
            >
              <Text style={[styles.tabText, tab === id && { color: colors.ink }]}>{text}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </SafeAreaView>
  );
}
