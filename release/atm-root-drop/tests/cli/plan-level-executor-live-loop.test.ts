import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from 'node:fs';
import { runBatch } from '../../packages/cli/src/commands/batch/implementation.ts';
import { planExecutorPhaseChain } from '../../packages/core/src/batch/plan-run-journal.ts';

const cwd = mkdtempSync(path.join(tmpdir(), 'atm-plan-live-loop-'));
mkdirSync(path.join(cwd, 'docs'), { recursive: true });
writeFileSync(path.join(cwd, 'docs', 'plan.md'), '# Plan\n\n- ATM-GOV-0198A\n- ATM-GOV-0198B\n', 'utf8');

const crashed = await runBatch([
  'execute-plan', '--cwd', cwd, '--actor', 'codex-live',
  '--plan', 'docs/plan.md', '--task', 'ATM-GOV-0198A', '--task', 'ATM-GOV-0198B',
  '--lane', 'lane-live-1', '--run-loop', '--ticket', 'execute', '--crash-after', 'commit', '--json'
]);
assert.equal(crashed.ok, true);
const crashedLoop = (crashed.evidence as any).loopReceipt;
assert.equal(crashedLoop.schemaId, 'atm.planExecutorLoopReceipt.v1');
assert.equal(crashedLoop.terminal, false);
assert.equal(crashedLoop.nextPhase, 'checkpoint');
assert.match(crashedLoop.recoveryCommand, /batch execute-plan/);
assert.equal(crashedLoop.completedPhases.includes('commit'), true);
assert.match(crashedLoop.sideEffectReceiptDigests.commit, /^sha256:/);

const batchId = (crashed.evidence as any).batchRun.batchId;
const runtimeRecordPath = path.join(cwd, '.atm', 'runtime', 'batch-runs', `${batchId}.json`);
const runtimeJournalPath = path.join(cwd, '.atm', 'runtime', 'batch-runs', `${batchId}.journal.jsonl`);
assert.equal(existsSync(runtimeRecordPath), true);
assert.equal(existsSync(runtimeJournalPath), true);

const resumed = await runBatch([
  'execute-plan', '--cwd', cwd, '--actor', 'codex-live',
  '--batch', batchId, '--run-loop', '--ticket', 'execute', '--json'
]);
assert.equal(resumed.ok, true);
const resumedLoop = (resumed.evidence as any).loopReceipt;
assert.equal(resumedLoop.terminal, true);
assert.equal(resumedLoop.nextPhase, null);
assert.deepEqual(resumedLoop.completedPhases, planExecutorPhaseChain);
assert.equal(resumedLoop.sideEffectReceiptDigests.commit, crashedLoop.sideEffectReceiptDigests.commit);
assert.equal(resumedLoop.sideEffectReceiptDigests.checkpoint.startsWith('sha256:'), true);
assert.equal(resumedLoop.observations.every((entry: any) => entry.schemaId === 'atm.telemetryObservation.v1'), true);
assert.equal(resumedLoop.observations.every((entry: any) => entry.producerId === 'plan-executor.phase'), true);

const journalLines = readFileSync(runtimeJournalPath, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
const commitEvents = journalLines.filter((event: any) => event.taskId === 'ATM-GOV-0198A' && event.phase === 'commit');
assert.equal(commitEvents.length, 1, 'commit side effect phase must be exactly once across crash/resume');

const queued = await runBatch([
  'execute-plan', '--cwd', cwd, '--actor', 'codex-live',
  '--task', 'ATM-GOV-0198Q', '--run-loop', '--ticket', 'queued', '--json'
]);
assert.equal(queued.ok, true);
const queuedLoop = (queued.evidence as any).loopReceipt;
const queuedBrokerObservation = queuedLoop.observations.find((entry: any) => entry.extensions?.phase === 'broker-ticketed');
const queuedComposeObservation = queuedLoop.observations.find((entry: any) => entry.extensions?.phase === 'composing');
assert.equal(queuedBrokerObservation.extensions.composeFirstState, 'queued-ticket');
assert.equal(queuedComposeObservation.extensions.composeFirstState, 'wakeup-compose');

const stale = await runBatch([
  'execute-plan', '--cwd', cwd, '--actor', 'codex-live',
  '--task', 'ATM-GOV-0198S', '--run-loop', '--ticket', 'stale-read-set', '--json'
]);
assert.equal(stale.ok, true);
const staleRevalidation = (stale.evidence as any).loopReceipt.observations.find((entry: any) => entry.extensions?.phase === 'semantic-revalidation');
assert.equal(staleRevalidation.extensions.composeFirstState, 'revalidated-after-stale-read-set');

console.log('plan-level executor live loop ok');
