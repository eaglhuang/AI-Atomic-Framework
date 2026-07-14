import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const atmEntry = path.join(repoRoot, 'packages/cli/src/atm.ts');

function fail(message: string): never {
  console.error(`[taskflow-status-migration-hint] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): void {
  if (!condition) fail(message);
}

const result = spawnSync(
  process.execPath,
  [
    '--strip-types',
    atmEntry,
    'taskflow',
    'close',
    '--task',
    'TASK-AAO-0190',
    '--status',
    'done',
    '--json'
  ],
  {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ATM_ACTOR_ID: 'cursor-grok-4.5' }
  }
);

const stdout = String(result.stdout ?? '');
const stderr = String(result.stderr ?? '');
const combined = `${stdout}\n${stderr}`;
let payload: Record<string, unknown> | null = null;
try {
  payload = JSON.parse(stdout || stderr);
} catch {
  payload = null;
}

assert(result.status === 2 || result.status === 1, `expected usage failure exit, got ${result.status}`);
assert(combined.includes('ATM_CLI_USAGE'), `expected ATM_CLI_USAGE in output:\n${combined}`);
assert(
  combined.includes('does not support --status') || combined.includes('tasks close --status'),
  `expected --status migration hint:\n${combined}`
);
assert(combined.includes('tasks close'), `expected low-level tasks close migration path:\n${combined}`);

const details = (payload?.messages as Array<{ data?: Record<string, unknown> }> | undefined)?.[0]?.data
  ?? (payload as { details?: Record<string, unknown> } | null)?.details
  ?? null;
if (details && typeof details === 'object') {
  const suggested = details.suggestedCommand;
  if (typeof suggested === 'string') {
    assert(suggested.includes('taskflow close'), `suggestedCommand should name taskflow close: ${suggested}`);
    assert(!suggested.includes('--status'), `suggested taskflow command must omit --status: ${suggested}`);
  }
}

console.log('taskflow-status-migration-hint: ok');
