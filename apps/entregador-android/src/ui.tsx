import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
export const colors = {
  ink: '#14282b',
  muted: '#5c706f',
  green: '#d5f264',
  bg: '#f5f6f0',
  line: '#dde3d7',
  red: '#aa3333',
  white: '#ffffff',
};
export const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: 22, paddingTop: 18, paddingBottom: 22, backgroundColor: colors.ink },
  brand: { color: colors.green, fontSize: 27, fontWeight: '900', letterSpacing: -1 },
  overline: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 2,
    color: colors.muted,
    textTransform: 'uppercase',
  },
  title: { fontSize: 28, fontWeight: '800', color: colors.ink, letterSpacing: -0.7 },
  heading: { fontSize: 19, fontWeight: '800', color: colors.ink },
  text: { color: colors.ink, fontSize: 15, lineHeight: 23 },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 20 },
  content: { padding: 20, gap: 16, paddingBottom: 40 },
  card: {
    padding: 18,
    backgroundColor: colors.white,
    borderRadius: 20,
    borderColor: colors.line,
    borderWidth: 1,
    gap: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  input: {
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#bac8bc',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: colors.ink,
    minHeight: 50,
  },
  button: {
    backgroundColor: colors.ink,
    borderRadius: 13,
    paddingHorizontal: 18,
    paddingVertical: 15,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: { color: colors.white, fontSize: 15, fontWeight: '800', textAlign: 'center' },
  notice: {
    borderRadius: 12,
    padding: 14,
    backgroundColor: '#fff3dc',
    borderWidth: 1,
    borderColor: '#e8cf9c',
  },
  error: {
    borderRadius: 12,
    padding: 14,
    backgroundColor: '#fff0ed',
    borderWidth: 1,
    borderColor: '#efc4bb',
  },
  pill: {
    backgroundColor: '#edf2e4',
    borderRadius: 40,
    paddingHorizontal: 12,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  tabs: {
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    padding: 8,
    flexDirection: 'row',
  },
  tab: { flex: 1, paddingVertical: 13, alignItems: 'center', borderRadius: 12 },
  tabText: { color: colors.muted, fontWeight: '700', fontSize: 12 },
  separator: { height: 1, backgroundColor: colors.line },
  timer: { fontSize: 58, fontWeight: '900', color: colors.ink, textAlign: 'center' },
  field: { gap: 7 },
  label: { fontSize: 13, fontWeight: '700', color: colors.ink },
});
export function Card({ children }: React.PropsWithChildren) {
  return <View style={styles.card}>{children}</View>;
}
export function Button({
  title,
  onPress,
  secondary = false,
  danger = false,
  disabled = false,
  busy = false,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  danger?: boolean;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={({ pressed }) => [
        styles.button,
        secondary && { backgroundColor: '#eaf0e1' },
        danger && { backgroundColor: colors.red },
        (disabled || busy) && { opacity: 0.45 },
        pressed && { opacity: 0.7 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={secondary ? colors.ink : colors.white} />
      ) : (
        <Text style={[styles.buttonText, secondary && { color: colors.ink }]}>{title}</Text>
      )}
    </Pressable>
  );
}
export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor="#71837d"
        style={styles.input}
        {...props}
      />
    </View>
  );
}
export function Notice({ text, error = false }: { text: string; error?: boolean }) {
  return (
    <View accessibilityLiveRegion="polite" style={error ? styles.error : styles.notice}>
      <Text style={[styles.muted, error && { color: colors.red }]}>{text}</Text>
    </View>
  );
}
export function Pill({ text }: { text: string }) {
  return (
    <View style={styles.pill}>
      <Text style={[styles.muted, { fontWeight: '700' }]}>{text}</Text>
    </View>
  );
}
