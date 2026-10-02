import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPublicCli } from '../../packages/cli/src/atm-public.ts';
import { selectEligibleRuntimeEvents } from '../../packages/core/src/telemetry/observed-coverage.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-public-telemetry-'));
const previous = process.cwd();
const previousNodeEnv = process.env.NODE_ENV;
try {
  process.env.NODE_ENV = 'test';
  process.chdir(root);
  const io = { stdout: { write() {} }, stderr: { write() {} } } as any;
  assert.notEqual(await runPublicCli(['unsupported-command', '--dry-run', '--json'], io), 0);
  assert.deepEqual(readdirSync(root), [], 'dry-run errors must not persist telemetry or mutate target');
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
  assert.equal(command[0].source, 'fixture');
  assert.equal(command[0].reasonClass, command[0].errorCode);
  assert.equal(selectEligibleRuntimeEvents(command).events.length, 0, 'declared tests cannot count as production coverage');
  assert.notEqual(await runPublicCli(['unsupported-command', '--json'], io), 0);
  const allEvents = readdirSync(dir, { recursive: true }).filter(file => String(file).endsWith('.jsonl'))
    .flatMap(file => readFileSync(path.join(dir, String(file)), 'utf8').trim().split('\n').map(line => JSON.parse(line)));
  const early = allEvents.filter(event => event.command === 'unsupported-command');
  assert.equal(early.length, 1, 'early refusal is recorded once');
  assert.equal(early[0].errorCode, 'ATM_CLI_UNKNOWN_COMMAND');
  assert.equal(early[0].taskId, null);
  assert.equal(early[0].source, 'fixture');
  console.log('[public-command-gate-telemetry] ok');
} finally {
  process.chdir(previous);
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  rmSync(root, { recursive: true, force: true });
}
