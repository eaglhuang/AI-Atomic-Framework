import { createHash } from 'node:crypto';

const options = parseArgs(process.argv.slice(2));
const payload = {
  schemaId: 'atm.pairedAbV4CellWorkload.v1',
  arm: required(options, '--arm'),
  scale: Number(required(options, '--scale')),
  contention: required(options, '--contention'),
  repeat: Number(required(options, '--repeat')),
  cellIndex: Number(required(options, '--cell-index'))
};

// This workload is intentionally small and deterministic: the paired matrix runner
// owns process timing, while this subprocess provides a real executable receipt.
const delayMs = resolveDelayMs(String(payload.arm), String(payload.contention), Number(payload.repeat));
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
const digest = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
console.log(JSON.stringify({ ...payload, delayMs, digest: `sha256:${digest}` }));

function parseArgs(argv: readonly string[]): Map<string, string> {
  const parsed = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index] ?? '';
    const value = argv[index + 1] ?? '';
    if (key.startsWith('--')) parsed.set(key, value);
  }
  return parsed;
}

function required(options: Map<string, string>, key: string): string {
  const value = options.get(key);
  if (!value) throw new Error(`${key} is required`);
  return value;
}

function resolveDelayMs(arm: string, contention: string, repeat: number): number {
  const armBase = arm === 'serial' ? 90 : arm === 'queue-only' ? 42 : arm === 'atm-compose-first' ? 18 : 24;
  const contentionPenalty = contention === 'noncommutative-cid' ? 4 : contention === 'generated-shared-surface' ? 3 : contention === 'same-file-disjoint-anchor' ? 2 : 1;
  return armBase + contentionPenalty + repeat;
}
