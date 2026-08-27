/**
 * `.git/index.lock` contention is a wait condition on an irreducible write
 * window, not an outcome.
 *
 * Live-index reconciliation reads through throwaway indexes and mutates the
 * shared index one path at a time, so the window a competing Git process has to
 * yield is milliseconds wide. Treating the first collision as terminal is what
 * turns a landed commit into standing reconciliation debt, and that debt
 * compounds: every later governed commit then reconciles against an index still
 * behind HEAD.
 *
 * The retry is safe precisely because the write it guards is idempotent — an
 * `update-index` against an already-computed HEAD entry reproduces byte-identical
 * state on a repeat. Nothing here removes a foreign lock, waits unboundedly, or
 * converts an exhausted retry into success: the caller still sees the original
 * error and decides what it means.
 */

export interface LiveIndexLockRetryPolicy {
  readonly attempts?: number;
  readonly delayMs?: number;
  /** Injected by tests so retry behaviour is deterministic without real waiting. */
  readonly sleep?: (milliseconds: number) => void;
}

export const DEFAULT_LIVE_INDEX_LOCK_RETRY_ATTEMPTS = 6;
export const DEFAULT_LIVE_INDEX_LOCK_RETRY_DELAY_MS = 120;
export const LIVE_INDEX_LOCK_RETRY_ATTEMPTS_ENV = 'ATM_LIVE_INDEX_LOCK_RETRY_ATTEMPTS';
export const LIVE_INDEX_LOCK_RETRY_DELAY_ENV = 'ATM_LIVE_INDEX_LOCK_RETRY_DELAY_MS';

function readPositiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function sleepSynchronously(milliseconds: number): void {
  if (milliseconds <= 0) return;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

/**
 * Recognise index-lock contention narrowly.
 *
 * Every other Git failure keeps its existing terminal meaning, so the retry
 * cannot widen what reconciliation tolerates. Git reports this condition on
 * stderr, which the reconciliation call sites capture onto the thrown error.
 */
export function isIndexLockContention(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const candidate = error as { message?: unknown; stderr?: unknown; stdout?: unknown };
  const text = [candidate.message, candidate.stderr, candidate.stdout]
    .map((part) => (typeof part === 'string' ? part : Buffer.isBuffer(part) ? part.toString('utf8') : ''))
    .join('\n')
    .toLowerCase();
  if (!text.includes('index.lock')) return false;
  return text.includes('file exists')
    || text.includes('unable to create')
    || text.includes('another git process');
}

/**
 * Run one idempotent live-index write, yielding to a competing Git process for a
 * bounded number of attempts. An exhausted retry rethrows the original error.
 */
export function withIndexLockRetry<T>(action: () => T, retry: LiveIndexLockRetryPolicy = {}): T {
  const attempts = Math.max(
    1,
    retry.attempts
      ?? readPositiveIntegerEnv(LIVE_INDEX_LOCK_RETRY_ATTEMPTS_ENV, DEFAULT_LIVE_INDEX_LOCK_RETRY_ATTEMPTS)
  );
  const delayMs = retry.delayMs
    ?? readPositiveIntegerEnv(LIVE_INDEX_LOCK_RETRY_DELAY_ENV, DEFAULT_LIVE_INDEX_LOCK_RETRY_DELAY_MS);
  const sleep = retry.sleep ?? sleepSynchronously;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return action();
    } catch (error) {
      if (attempt >= attempts || !isIndexLockContention(error)) throw error;
      sleep(delayMs * attempt);
    }
  }
}
