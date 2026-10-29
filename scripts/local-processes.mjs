import { readFileSync } from 'node:fs';

export function startTicksFromStat(stat) {
  const boundary = stat.lastIndexOf(') ');
  if (boundary < 0) throw new Error('Identidade de processo inválida.');
  const ticks = stat
    .slice(boundary + 2)
    .trim()
    .split(/\s+/)[19];
  if (!/^\d+$/.test(ticks || '')) throw new Error('Identidade de processo inválida.');
  return ticks;
}
export function identify(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  try {
    return {
      pid,
      startTicks: startTicksFromStat(readFileSync(`/proc/${pid}/stat`, 'utf8')),
      bootId: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
    };
  } catch {
    return null;
  }
}
export function isOwned(record) {
  if (!record || typeof record.startTicks !== 'string') return false;
  const current = identify(record.pid);
  return !!current && current.startTicks === record.startTicks && current.bootId === record.bootId;
}
export async function stopOwned(record, timeoutMs = 10000) {
  if (!isOwned(record)) return false;
  // Each registered child starts a new process group. Never signal a reused PID.
  try {
    process.kill(-record.pid, 'SIGTERM');
  } catch (error) {
    if (error.code === 'ESRCH') return false;
    throw error;
  }
  const deadline = Date.now() + timeoutMs;
  while (isOwned(record) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  if (isOwned(record)) process.kill(-record.pid, 'SIGKILL');
  return true;
}
export async function waitHealthy(
  url,
  { timeoutMs = 20000, json = false, alive = () => true } = {},
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!alive()) throw new Error('O serviço encerrou antes de ficar saudável.');
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000), redirect: 'error' });
      if (response.ok) {
        if (!json) return true;
        const payload = await response.json();
        if (payload.status === 'ok' && payload.database === 'ready' && payload.redis === 'ready')
          return true;
      }
    } catch {
      /* readiness is retried within the bounded deadline */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('O serviço não respondeu à verificação funcional no prazo.');
}
