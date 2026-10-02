import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPublicCli } from '../../packages/cli/src/atm-public.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-public-telemetry-'));
const previous = process.cwd();
try {
  process.chdir(root);
  const io = { stdout: { write() {} }, stderr: { write() {} } } as any;
  const exitCode = await runPublicCli(['tasks', 'unsupported-action', '--actor', 'test-actor', '--task', 'TEST-001', '--json'], io);
  assert.notEqual(exitCode, 0);
  const dir = path.join(root, '.atm/runtime/telemetry/gate-events');
  const files = readdirSync(dir, { recursive: true }).filter(file => String(file).endsWith('.jsonl'));
  const events = files.flatMap(file => readFileSync(path.join(dir, String(file)), 'utf8').trim().split('\n').map(line => JSON.parse(line)));
  const command = events.filter(event => event.command === 'tasks' && event.workloadId === 'cli-command:tasks');
  assert.equal(command.length, 1, 'public command emits one command-level event');
  assert.equal(command[0].result, 'block');
  assert.match(command[0].errorCode, /^ATM_/);
  assert.equal(command[0].actorId, 'test-actor');
  assert.equal(command[0].taskId, 'TEST-001');
  assert.ok(command[0].durationMs > 0);
  assert.equal(command[0].failureEnvelopeRef, null, 'no fabricated failure envelope');
  console.log('[public-command-gate-telemetry] ok');
} finally {
  process.chdir(previous);
  rmSync(root, { recursive: true, force: true });
}
