import React, { useMemo, useState } from 'react';
import { Alert, Pressable, Share, Text, View } from 'react-native';
import type { Delivery } from './domain';
import { money } from './domain';
import { DeliveryInfo, errorText } from './components';
import {
  calendarDate,
  filterHistory,
  historyCsv,
  periodRange,
  summarizeFinalized,
  type HistoryStatus,
  type Period,
} from './history';
import { Button, Card, colors, Field, Notice, styles } from './ui';

const periods: [Period, string][] = [
  ['day', 'Hoje'],
  ['week', 'Esta semana'],
  ['month', 'Este mês'],
  ['year', 'Este ano'],
  ['custom', 'Personalizado'],
  ['all', 'Todo o lote'],
];
const statuses: [HistoryStatus, string][] = [
  ['ALL', 'Todos'],
  ['FINALIZADO', 'Finalizados'],
  ['CANCELADO', 'Cancelados'],
  ['ACTIVE', 'Em andamento'],
  ['AWAITING_CONFIRMATION', 'Aguardando confirmação'],
];
const readableDate = (key: string) => key.split('-').reverse().join('/');

function Choice<T extends string>({
  value,
  choices,
  onChange,
  label,
}: {
  value: T;
  choices: [T, string][];
  onChange: (next: T) => void;
  label: string;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.row}>
        {choices.map(([key, text]) => (
          <Pressable
            key={key}
            accessibilityRole="radio"
            accessibilityState={{ checked: key === value }}
            accessibilityLabel={`${label}: ${text}`}
            onPress={() => onChange(key)}
            style={({ pressed }) => [
              styles.pill,
              { paddingVertical: 12, backgroundColor: key === value ? colors.green : '#edf2e4' },
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text style={[styles.muted, { color: colors.ink, fontWeight: '700' }]}>{text}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function HistoryPanel({
  deliveries,
  kind,
  onSelect,
}: {
  deliveries: Delivery[];
  kind: 'courier' | 'establishment';
  onSelect?: (delivery: Delivery) => void;
}) {
  const now = Date.now();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const today = calendarDate(now, timeZone) ?? new Date(now).toISOString().slice(0, 10);
  const [period, setPeriod] = useState<Period>('month');
  const [status, setStatus] = useState<HistoryStatus>(kind === 'courier' ? 'FINALIZADO' : 'ALL');
  const [customStart, setCustomStart] = useState(() => readableDate(today.slice(0, 8) + '01'));
  const [customEnd, setCustomEnd] = useState(() => readableDate(today));
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState('');
  const selection = useMemo(() => {
    try {
      const range = periodRange(period, Date.now(), timeZone, customStart, customEnd);
      return { range, error: '' };
    } catch (error) {
      return { range: null, error: errorText(error) };
    }
  }, [period, today, timeZone, customStart, customEnd]);
  const filtered = useMemo(
    () => (selection.range ? filterHistory(deliveries, selection.range, status, timeZone) : []),
    [deliveries, selection.range, status, timeZone],
  );
  const summary = summarizeFinalized(filtered);
  async function share() {
    if (!selection.range || filtered.length === 0) return;
    setSharing(true);
    setShareError('');
    try {
      await Share.share({
        title: 'Relatório Ligeirinho — CSV',
        message: historyCsv(filtered),
      });
    } catch (error) {
      setShareError(errorText(error));
    } finally {
      setSharing(false);
    }
  }
  return (
    <>
      <Card>
        <Text style={styles.heading}>
          {kind === 'courier' ? 'Ganhos e histórico' : 'Filtrar histórico'}
        </Text>
        <Choice label="Período" value={period} choices={periods} onChange={setPeriod} />
        {period === 'custom' ? (
          <>
            <Field
              label="Data inicial (DD/MM/AAAA)"
              placeholder="Ex.: 01/10/2026"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              value={customStart}
              onChangeText={setCustomStart}
            />
            <Field
              label="Data final (DD/MM/AAAA)"
              placeholder="Ex.: 31/10/2026"
              keyboardType="numbers-and-punctuation"
              maxLength={10}
              value={customEnd}
              onChangeText={setCustomEnd}
            />
          </>
        ) : null}
        <Choice label="Situação" value={status} choices={statuses} onChange={setStatus} />
        {selection.error ? (
          <Notice error text={selection.error} />
        ) : (
          <Text style={styles.muted}>
            {selection.range?.start && selection.range.end
              ? `${readableDate(selection.range.start)} a ${readableDate(selection.range.end)}`
              : 'Todos os registros deste lote'}
            {' · '}horário do aparelho ({timeZone}). Finalizados e cancelados usam a data de
            encerramento; atendimentos em andamento usam a data da solicitação.
          </Text>
        )}
      </Card>
      <Notice
        text={`Lote atual: ${deliveries.length} de até 100 atendimentos recentes. Períodos anteriores podem estar incompletos. Os filtros e a exportação abrangem somente este lote.`}
      />
      {selection.range ? (
        <>
          <Card>
            <Text style={styles.overline}>
              {kind === 'courier'
                ? 'Ganhos registrados dos finalizados exibidos'
                : 'Valores dos finalizados exibidos'}
            </Text>
            {summary.invalidAmountCount ? (
              <Notice
                error
                text="Há registros com valor inválido neste resultado. O total ficará oculto até a conferência pela administração."
              />
            ) : (
              <Text style={styles.title}>{money(summary.totalCents)}</Text>
            )}
            <Text style={styles.muted}>
              {summary.count} atendimento(s) finalizado(s) · {summary.stopCount} destino(s). Valores
              registrados não comprovam pagamento. Combine a quitação diretamente entre loja e
              entregador.
            </Text>
            <Text style={styles.muted}>
              {filtered.length} atendimento(s) correspondem aos filtros.
            </Text>
            <Button
              secondary
              title="Compartilhar CSV como texto"
              busy={sharing}
              disabled={filtered.length === 0 || summary.invalidAmountCount > 0}
              onPress={() =>
                Alert.alert(
                  'Compartilhar relatório?',
                  'Você escolherá o aplicativo de destino. O CSV inclui identificadores, estabelecimento, situação, data e valores deste resultado. Confira com quem compartilhará esses dados.',
                  [
                    { text: 'Voltar', style: 'cancel' },
                    { text: 'Escolher aplicativo', onPress: () => void share() },
                  ],
                )
              }
            />
            {shareError ? <Notice error text={shareError} /> : null}
          </Card>
          {filtered.length ? (
            filtered.map((delivery) => (
              <Card key={delivery.id}>
                <DeliveryInfo delivery={delivery} />
                {Number.isFinite(Date.parse(delivery.completedAt || delivery.createdAt || '')) ? (
                  <Text style={styles.muted}>
                    {delivery.completedAt ? 'Encerrado' : 'Solicitado'} em{' '}
                    {new Date(delivery.completedAt || delivery.createdAt!).toLocaleString('pt-BR')}
                  </Text>
                ) : null}
                {onSelect ? (
                  <Button secondary title="Ver atendimento" onPress={() => onSelect(delivery)} />
                ) : null}
              </Card>
            ))
          ) : (
            <Card>
              <Text style={styles.heading}>Nenhum atendimento neste resultado</Text>
              <Text style={styles.muted}>
                Altere o período ou a situação. Você também pode puxar a tela para consultar
                novamente o servidor.
              </Text>
            </Card>
          )}
        </>
      ) : (
        <Text style={styles.muted}>Ajuste as datas para consultar valores e atendimentos.</Text>
      )}
    </>
  );
}
