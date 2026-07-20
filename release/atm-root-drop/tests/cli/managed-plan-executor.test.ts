import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runBatch } from '../../packages/cli/src/commands/batch/implementation.ts';
import { planExecutorPhaseChain } from '../../packages/core/src/batch/plan-run-journal.ts';

const cwd = mkdtempSync(path.join(tmpdir(), 'atm-managed-plan-executor-'));
mkdirSync(path.join(cwd, 'docs'), { recursive: true });
writeFileSync(path.join(cwd, 'docs', 'plan.md'), '# Plan\n\n- ATM-GOV-0222A\n- ATM-GOV-0222B\n', 'utf8');

const crashed = await runBatch([
  'execute-plan', '--cwd', cwd, '--actor', 'codex-managed',
  '--plan', 'docs/plan.md', '--task', 'ATM-GOV-0222A', '--task', 'ATM-GOV-0222B',
  '--lane', 'lane-managed-1', '--run-loop', '--crash-after', 'commit', '--json'
]);
assert.equal(crashed.ok, true);
const batchId = (crashed.evidence as any).batchRun.batchId;
const crashedLoop = (crashed.evidence as any).loopReceipt;
assert.equal(crashedLoop.terminal, false);
assert.equal(crashedLoop.nextPhase, 'checkpoint');
assert.match(crashedLoop.sideEffectReceiptDigests.commit, /^sha256:/);

const resumed = await runBatch([
  'execute-plan', '--cwd', cwd, '--actor', 'codex-managed',
  '--batch', batchId, '--run-loop', '--json'
]);
assert.equal(resumed.ok, true);
const resumedLoop = (resumed.evidence as any).loopReceipt;
assert.equal(resumedLoop.terminal, true);
assert.deepEqual(resumedLoop.completedPhases, planExecutorPhaseChain);
assert.equal(resumedLoop.sideEffectReceiptDigests.commit, crashedLoop.sideEffectReceiptDigests.commit);
assert.match(resumedLoop.sideEffectReceiptDigests.checkpoint, /^sha256:/);
assert.match(resumedLoop.sideEffectReceiptDigests.closeback, /^sha256:/);

const recordPath = path.join(cwd, '.atm', 'runtime', 'batch-runs', `${batchId}.json`);
const journalPath = path.join(cwd, '.atm', 'runtime', 'batch-runs', `${batchId}.journal.jsonl`);
assert.equal(existsSync(recordPath), true);
assert.equal(existsSync(journalPath), true);
const journalEvents = readFileSync(journalPath, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
for (const phase of ['broker-ticketed', 'commit', 'checkpoint', 'closeback']) {
  const events = journalEvents.filter((event: any) => event.taskId === 'ATM-GOV-0222A' && event.phase === phase);
  assert.equal(events.length, 1, `${phase} must be exactly-once across crash/resume`);
}
assert.equal(journalEvents.every((event: any) => event.tokenUsage?.source), true);

const resumedAgain = await runBatch([
  'execute-plan', '--cwd', cwd, '--actor', 'codex-managed',
  '--batch', batchId, '--run-loop', '--json'
]);
assert.equal(resumedAgain.ok, true);
assert.equal((resumedAgain.evidence as any).decision.decision, 'next-command');
assert.equal((resumedAgain.evidence as any).decision.currentTaskId, 'ATM-GOV-0222B');
const journalAfterCompletedResume = readFileSync(journalPath, 'utf8').trim().split(/\r?\n/).map((line) => JSON.parse(line));
for (const phase of ['broker-ticketed', 'commit', 'checkpoint', 'closeback']) {
  const events = journalAfterCompletedResume.filter((event: any) => event.taskId === 'ATM-GOV-0222A' && event.phase === phase);
  assert.equal(events.length, 1, `${phase} must stay exactly-once after completed resume`);
}

console.log('managed plan executor ok');
