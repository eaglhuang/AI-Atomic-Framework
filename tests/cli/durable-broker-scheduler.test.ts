import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createEmptyWaveBrokerSchedulerDocument,
  enqueueWaveBrokerTicket,
  planWaveBrokerBatch,
  transitionWaveBrokerTicket
} from '../../packages/core/src/broker/wave-broker-scheduler.ts';
import { runBroker } from '../../packages/cli/src/commands/broker.ts';

const now = '2026-07-18T00:00:00.000Z';
let document = createEmptyWaveBrokerSchedulerDocument(now);

const first = enqueueWaveBrokerTicket(document, {
  waveId: 'wave-a',
  taskId: 'ATM-GOV-0201',
  surfaceKind: 'commit',
  surfaceFamily: 'cli',
  payloadDigest: 'sha256:first',
  now
});
document = first.document;
const replay = enqueueWaveBrokerTicket(document, {
  waveId: 'wave-a',
  taskId: 'ATM-GOV-0201',
  surfaceKind: 'commit',
  surfaceFamily: 'cli',
  payloadDigest: 'sha256:first',
  now
});
assert.equal(replay.replayed, true, 'same wave/task/surface/payload digest replays ticket');
assert.equal(document.tickets.length, 1, 'replay does not duplicate ticket');

const transitioned = transitionWaveBrokerTicket(first.ticket, 'head', '2026-07-18T00:00:01.000Z');
assert.equal(transitioned.state, 'head', 'ticket state transitions to head');
assert.throws(() => transitionWaveBrokerTicket(transitioned, 'queued'), /invalid wave broker ticket transition/, 'invalid transitions fail closed');

document = enqueueWaveBrokerTicket(document, {
  waveId: 'wave-a',
  taskId: 'ATM-GOV-0202',
  surfaceKind: 'commit',
  surfaceFamily: 'cli',
  payloadDigest: 'sha256:second',
  now
}).document;
const ready = planWaveBrokerBatch({
  document,
  waveId: 'wave-a',
  surfaceKind: 'commit',
  surfaceFamily: 'cli',
  expectedTaskIds: ['ATM-GOV-0201', 'ATM-GOV-0202'],
  now: '2026-07-18T00:00:02.000Z'
});
assert.equal(ready.verdict, 'batch-ready', 'same-wave compatible tickets batch');
assert.deepEqual(ready.missingTaskIds, [], 'ready batch has no missing tasks');

const crossWave = enqueueWaveBrokerTicket(document, {
  waveId: 'wave-b',
  taskId: 'ATM-GOV-0203',
  surfaceKind: 'commit',
  surfaceFamily: 'cli',
  payloadDigest: 'sha256:third',
  now
}).document;
const incompatible = planWaveBrokerBatch({ document: crossWave, surfaceKind: 'commit' });
assert.equal(incompatible.verdict, 'serial-fallback', 'cross-wave tickets are not absorbed into one batch');

const waiting = planWaveBrokerBatch({
  document,
  waveId: 'wave-a',
  surfaceKind: 'commit',
  surfaceFamily: 'cli',
  expectedTaskIds: ['ATM-GOV-0201', 'ATM-GOV-0202', 'ATM-GOV-0209'],
  collectionTimeoutMs: 120000,
  now: '2026-07-18T00:00:30.000Z'
});
assert.equal(waiting.verdict, 'waiting', 'missing expected ticket waits before timeout');
assert.deepEqual(waiting.missingTaskIds, ['ATM-GOV-0209']);

const fallback = planWaveBrokerBatch({
  document,
  waveId: 'wave-a',
  surfaceKind: 'commit',
  surfaceFamily: 'cli',
  expectedTaskIds: ['ATM-GOV-0201', 'ATM-GOV-0202', 'ATM-GOV-0209'],
  collectionTimeoutMs: 1000,
  now: '2026-07-18T00:00:30.000Z'
});
assert.equal(fallback.verdict, 'serial-fallback', 'timeout returns reseal or serial fallback');
assert.equal(fallback.reason, 'reseal-or-serial-fallback');

const cwd = mkdtempSync(path.join(tmpdir(), 'atm-wave-broker-scheduler-'));
await runBroker([
  'schedule',
  'enqueue',
  '--cwd',
  cwd,
  '--task',
  'ATM-GOV-0301',
  '--wave',
  'wave-cli',
  '--surface-kind',
  'projection',
  '--surface-family',
  'atom-map',
  '--payload-digest',
  'sha256:cli'
]);
const schedulerPath = path.join(cwd, '.atm/runtime/wave-broker-scheduler.json');
const persisted = JSON.parse(readFileSync(schedulerPath, 'utf8'));
assert.equal(persisted.tickets.length, 1, 'CLI schedule enqueue writes durable ticket store');
assert.equal(persisted.tickets[0].waveId, 'wave-cli');

const cliPlan = await runBroker([
  'schedule',
  'plan',
  '--cwd',
  cwd,
  '--wave',
  'wave-cli',
  '--surface-kind',
  'projection',
  '--surface-family',
  'atom-map',
  '--expected-task',
  'ATM-GOV-0301'
]);
const cliPlanEvidence = cliPlan.evidence as { readonly decision: { readonly verdict: string } };
assert.equal(cliPlanEvidence.decision.verdict, 'serial-fallback', 'single CLI ticket degrades to serial fallback');

console.log('[durable-broker-scheduler.test] ok');
