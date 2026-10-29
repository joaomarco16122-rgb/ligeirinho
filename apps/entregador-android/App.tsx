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
import * as Location from 'expo-location';
import { api, apiDestination, logout, restore, serverNow } from './src/api';
import { HistoryPanel } from './src/history-panel';
import { SupportCard } from './src/support-card';
import { Chat, DeliveryInfo, errorText, Login, Navigate, PasswordChange } from './src/components';
import {
  finalStatuses,
  label,
  nextProgress,
  remainingSeconds,
  type Delivery,
  type Offer,
  type User,
} from './src/domain';
import { Button, Card, colors, Field, Notice, Pill, styles } from './src/ui';

type Profile = { id: string; status: string; online: boolean; locationAt?: string };
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
  const [tab, setTab] = useState('trabalho');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [active, setActive] = useState(
    AppState.currentState !== 'background' && AppState.currentState !== 'inactive',
  );
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const foregroundSync = useRef<() => Promise<void>>(async () => {});
  const [reason, setReason] = useState('');
  const syncing = useRef(false);
  const userRef = useRef(user);
  userRef.current = user;
  useEffect(() => {
    restore('COURIER')
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
      const [p, d, o] = await Promise.all([
        api<Profile>('/courier/me'),
        api<Delivery[]>('/deliveries'),
        api<Offer[]>('/courier/offers'),
      ]);
      if (userRef.current?.id !== user.id) return;
      setProfile(p);
      setDeliveries(d);
      setOffers(o);
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
    const interval = setInterval(() => void sync(), 2500);
    return () => clearInterval(interval);
  }, [sync, active]);
  useEffect(() => {
    const timer = setInterval(() => setNow(serverNow()), 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (
      !user ||
      user.mustChangePassword ||
      !profile ||
      (!profile.online && profile.status !== 'BUSY') ||
      !active
    )
      return;
    let watch: Location.LocationSubscription | undefined;
    let canceled = false;
    (async () => {
      const permission = await Location.getForegroundPermissionsAsync();
      if (permission.status !== 'granted') {
        setError('Permita a localização para manter sua elegibilidade.');
        return;
      }
      const subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 15 },
        (position) => {
          if (!canceled)
            void api('/courier/location', 'POST', {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            }).catch((e) => setError(errorText(e)));
        },
      );
      if (canceled) subscription.remove();
      else watch = subscription;
    })().catch((e) => setError(errorText(e)));
    return () => {
      canceled = true;
      watch?.remove();
    };
  }, [user, profile?.online, profile?.status, active]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await action();
      await sync();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function availability() {
    await run(async () => {
      const online = !profile?.online;
      if (online) {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted')
          throw new Error(
            'A localização é necessária para receber ofertas. Você pode continuar offline.',
          );
        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });
        await api('/courier/availability', 'POST', {
          online: true,
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      } else {
        await api('/courier/availability', 'POST', { online: false });
      }
    });
  }
  const current = deliveries.find((delivery) => !finalStatuses.has(delivery.status));
  const offer = offers.find((value) => remainingSeconds(value.expiresAt, now) > 0);
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
    setProfile(null);
    setDeliveries([]);
    setOffers([]);
    setReason('');
    setError('');
    setTab('trabalho');
  }
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.brand}>Ligeirinho</Text>
        <Text style={{ color: '#c8d3c7', fontSize: 12, marginTop: 4 }}>ENTREGADOR · ANDROID</Text>
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
              <Login role="COURIER" onLogin={setUser} />
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
                {tab === 'trabalho'
                  ? 'Vamos nessa?'
                  : tab === 'historico'
                    ? 'Seus atendimentos'
                    : 'Sua conta'}
              </Text>
              {error ? (
                <Notice
                  error
                  text={`${error} Nenhuma ação foi confirmada sem resposta do servidor.`}
                />
              ) : null}
              {tab === 'trabalho' ? (
                <>
                  <Card>
                    <View style={styles.row}>
                      <Pill
                        text={profile ? label(profile.status) : 'Sincronizando disponibilidade'}
                      />
                      <Text style={styles.muted}>{profile?.online ? 'Online' : 'Offline'}</Text>
                    </View>
                    <Text style={styles.muted}>
                      Localização compartilhada com o aplicativo aberto enquanto você estiver online
                      ou em atendimento. Ficar offline impede novas ofertas; o acompanhamento da
                      entrega ativa continua. Em segundo plano, você pode deixar de receber ofertas.
                    </Text>
                    <Button
                      title={
                        profile?.online ? 'Ficar offline' : 'Ficar online e permitir localização'
                      }
                      onPress={availability}
                      busy={busy}
                      disabled={!profile}
                    />
                  </Card>
                  {offer ? (
                    <Card>
                      <Text style={styles.overline}>Nova oferta · decisão no servidor</Text>
                      <Text style={styles.timer}>{remainingSeconds(offer.expiresAt, now)}s</Text>
                      <DeliveryInfo delivery={offer.delivery} />
                      <Button
                        title="Aceitar atendimento"
                        busy={busy}
                        onPress={() =>
                          void run(() => api(`/courier/offers/${offer.id}/accept`, 'POST', {}))
                        }
                      />
                      <Button
                        title="Recusar oferta"
                        secondary
                        busy={busy}
                        onPress={() =>
                          void run(() => api(`/courier/offers/${offer.id}/reject`, 'POST', {}))
                        }
                      />
                    </Card>
                  ) : null}
                  {current ? (
                    <>
                      <Card>
                        <DeliveryInfo delivery={current} />
                        {nextProgress(current.status) ? (
                          <Button
                            title={nextProgress(current.status)!.text}
                            busy={busy}
                            onPress={() => {
                              const next = nextProgress(current.status)!;
                              if (next.status === 'AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO')
                                Alert.alert(
                                  'Todas as entregas foram realizadas?',
                                  'A loja ainda deverá confirmar. Você continuará ocupado até a confirmação.',
                                  [
                                    { text: 'Voltar', style: 'cancel' },
                                    {
                                      text: 'Concluí as entregas',
                                      onPress: () =>
                                        void run(() =>
                                          api(`/deliveries/${current.id}/progress`, 'PATCH', {
                                            status: next.status,
                                          }),
                                        ),
                                    },
                                  ],
                                );
                              else
                                void run(() =>
                                  api(`/deliveries/${current.id}/progress`, 'PATCH', {
                                    status: next.status,
                                  }),
                                );
                            }}
                          />
                        ) : null}
                        {current.status === 'AGUARDANDO_CONFIRMACAO_ESTABELECIMENTO' ? (
                          <Notice text="Você concluiu sua parte. Aguarde a confirmação da loja; não será liberado automaticamente pelo tempo decorrido." />
                        ) : null}
                        {current.status === 'ACEITO' || current.status === 'A_CAMINHO_COLETA' ? (
                          <Navigate
                            latitude={current.establishment.latitude}
                            longitude={current.establishment.longitude}
                            title="Navegar até a coleta"
                          />
                        ) : (
                          current.stops.map((stop, index) => (
                            <Navigate
                              key={index}
                              latitude={stop.latitude}
                              longitude={stop.longitude}
                              title={`Navegar até o destino ${index + 1}`}
                            />
                          ))
                        )}
                        {current.status === 'CANCELAMENTO_SOLICITADO' ? (
                          <>
                            <Notice text="O cancelamento depende do acordo entre as partes. Confirme somente se estiver de acordo com a solicitação da outra parte." />
                            <Button
                              title={
                                current.cancellations?.[0]?.requestedByRole === 'COURIER'
                                  ? 'Aguardando a confirmação da loja'
                                  : 'Concordo com o cancelamento'
                              }
                              disabled={current.cancellations?.[0]?.requestedByRole === 'COURIER'}
                              danger
                              busy={busy}
                              onPress={() =>
                                Alert.alert(
                                  'Aprovar cancelamento?',
                                  'O servidor verificará a outra parte e registrará a decisão.',
                                  [
                                    { text: 'Voltar', style: 'cancel' },
                                    {
                                      text: 'Aprovar',
                                      style: 'destructive',
                                      onPress: () =>
                                        void run(() =>
                                          api(
                                            `/deliveries/${current.id}/cancellation/approve`,
                                            'POST',
                                            {},
                                          ),
                                        ),
                                    },
                                  ],
                                )
                              }
                            />
                          </>
                        ) : (
                          <>
                            <Field
                              label="Motivo para solicitar cancelamento"
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
                                  'Solicitar cancelamento?',
                                  'A loja precisará concordar. O atendimento continua sob sua responsabilidade até confirmação.',
                                  [
                                    { text: 'Voltar', style: 'cancel' },
                                    {
                                      text: 'Solicitar',
                                      onPress: () =>
                                        void run(() =>
                                          api(`/deliveries/${current.id}/cancellation`, 'POST', {
                                            reason: reason.trim(),
                                          }),
                                        ),
                                    },
                                  ],
                                )
                              }
                            />
                          </>
                        )}
                      </Card>
                      <Chat
                        key={current.id}
                        deliveryId={current.id}
                        canSend={!finalStatuses.has(current.status) && Boolean(current.courier)}
                      />
                    </>
                  ) : !offer ? (
                    <Card>
                      <Text style={styles.heading}>Tudo em dia por aqui</Text>
                      <Text style={styles.muted}>
                        {profile?.online
                          ? 'Quando houver um atendimento elegível, a oferta aparecerá aqui. Mantenha o aplicativo aberto.'
                          : 'Fique online para começar a receber ofertas.'}
                      </Text>
                    </Card>
                  ) : null}
                </>
              ) : tab === 'historico' ? (
                <HistoryPanel deliveries={deliveries} kind="courier" />
              ) : (
                <>
                  <Card>
                    <Text style={styles.heading}>{user.name}</Text>
                    <Text style={styles.muted}>
                      Perfil de entregador. Cadastro e suporte são gerenciados pela administração.
                    </Text>
                    <Text selectable style={styles.muted}>
                      Servidor: {apiDestination()}
                    </Text>
                    <Button secondary title="Sincronizar agora" onPress={() => void sync()} />
                    <Button danger title="Sair da conta" onPress={() => void exit()} />
                  </Card>
                  <SupportCard
                    audience="courier"
                    lastSyncAt={lastSyncAt}
                    status={current?.status ?? profile?.status}
                  />
                  <Notice text="Mantenha o aplicativo aberto para acompanhar ofertas e atualizações. Localização em segundo plano e notificações de oferta ainda não estão disponíveis nesta versão." />
                </>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
      {user && !user.mustChangePassword ? (
        <View style={styles.tabs}>
          {[
            ['trabalho', 'Trabalho'],
            ['historico', 'Histórico'],
            ['conta', 'Conta'],
          ].map(([id, text]) => (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: tab === id }}
              key={id}
              style={[styles.tab, tab === id && { backgroundColor: colors.green }]}
              onPress={() => setTab(id)}
            >
              <Text style={[styles.tabText, tab === id && { color: colors.ink }]}>{text}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </SafeAreaView>
  );
}
