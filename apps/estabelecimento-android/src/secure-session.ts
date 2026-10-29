import * as SecureStore from 'expo-secure-store';
import { randomUUID } from 'expo-crypto';
const KEY = 'ligeirinho.session.v1';
const CHUNK = 450; // At most 1,800 UTF-8 bytes, including four-byte code points.
const MAX_CHUNKS = 128;
let writing: Promise<void> = Promise.resolve();
type Manifest = { version: 2; id: string; count: number };
function manifest(value: string | null): Manifest | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed?.version === 2 &&
      typeof parsed.id === 'string' &&
      /^[a-z0-9-]{1,60}$/.test(parsed.id) &&
      Number.isInteger(parsed.count) &&
      parsed.count > 0 &&
      parsed.count <= MAX_CHUNKS
      ? parsed
      : null;
  } catch {
    return null;
  }
}
const part = (entry: Manifest, index: number) => `${KEY}.chunks.${entry.id}.${index}`;
async function remove(entry: Manifest | null) {
  if (entry)
    await Promise.allSettled(
      Array.from({ length: entry.count }, (_, index) =>
        SecureStore.deleteItemAsync(part(entry, index)),
      ),
    );
}
function serialize(operation: () => Promise<void>) {
  const pending = writing.then(operation, operation);
  writing = pending.catch(() => {});
  return pending;
}
export async function readSecureSession(): Promise<string | null> {
  await writing;
  const value = await SecureStore.getItemAsync(KEY);
  const entry = manifest(value);
  if (!entry) return value; // Read the previous, single-record legacy format.
  const values = await Promise.all(
    Array.from({ length: entry.count }, (_, index) => SecureStore.getItemAsync(part(entry, index))),
  );
  if (values.some((chunk) => chunk === null))
    throw new Error('Sessão salva incompleta. Entre novamente.');
  return values.join('');
}
export function writeSecureSession(value: string | null): Promise<void> {
  return serialize(async () => {
    const previous = manifest(await SecureStore.getItemAsync(KEY));
    if (value === null) {
      // Remove the authoritative pointer first, so interrupted cleanup cannot restore a session.
      await SecureStore.deleteItemAsync(KEY);
      await remove(previous);
      return;
    }
    if (!value.length || value.length > CHUNK * MAX_CHUNKS)
      throw new Error('Sessão muito grande para armazenamento seguro.');
    const characters = Array.from(value);
    const entry: Manifest = {
      version: 2,
      id: randomUUID(),
      count: Math.ceil(characters.length / CHUNK),
    };
    try {
      for (let index = 0; index < entry.count; index++)
        await SecureStore.setItemAsync(
          part(entry, index),
          characters.slice(index * CHUNK, (index + 1) * CHUNK).join(''),
        );
      // Publish only after all chunks exist. Provider refresh tokens never enter AsyncStorage.
      await SecureStore.setItemAsync(KEY, JSON.stringify(entry));
    } catch (error) {
      await remove(entry);
      throw error;
    }
    await remove(previous);
  });
}
