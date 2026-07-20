import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runBatch } from '../../packages/cli/src/commands/batch/implementation.ts';

const cwd = mkdtempSync(path.join(tmpdir(), 'atm-plan-executor-'));
mkdirSync(path.join(cwd, 'docs'), { recursive: true });
writeFileSync(path.join(cwd, 'docs', 'plan.md'), '# Plan\n\n- ATM-GOV-0189\n- ATM-GOV-0190\n', 'utf8');

const started = await runBatch([
  'execute-plan', '--cwd', cwd, '--actor', 'codex-test',
  '--plan', 'docs/plan.md', '--task', 'ATM-GOV-0189', '--task', 'ATM-GOV-0190',
  '--lane', 'lane-executor-1', '--waited-ms', '25', '--json'
]);
assert.equal(started.ok, true);
const startEvidence = started.evidence as any;
assert.equal(startEvidence.action, 'execute-plan');
assert.equal(startEvidence.decision.schemaId, 'atm.planExecutorDecisionReceipt.v1');
assert.equal(startEvidence.decision.decision, 'next-command');
assert.equal(startEvidence.decision.currentTaskId, 'ATM-GOV-0189');
assert.match(startEvidence.decision.nextCommand, /next --claim/);
assert.equal(startEvidence.decision.windowDecision.source, 'runtime-journal-summary');
assert.equal(startEvidence.decision.dataPolicy.rawRuntimeStore, '.atm/runtime/batch-runs/**');
assert.equal(startEvidence.decision.dataPolicy.gitTrackedEvidence, 'digest-only');
assert.equal(startEvidence.decision.dataPolicy.rawLogsCommitted, false);
assert.match(startEvidence.decision.decisionDigest, /^sha256:/);

const batchRun = startEvidence.batchRun;
const runtimeRecordPath = path.join(cwd, '.atm', 'runtime', 'batch-runs', `${batchRun.batchId}.json`);
const runtimeJournalPath = path.join(cwd, batchRun.journalPath);
assert.equal(existsSync(runtimeRecordPath), true, 'execute-plan must keep the durable run record in gitignored runtime');
assert.equal(existsSync(runtimeJournalPath), true, 'execute-plan must keep raw journal JSONL in gitignored runtime');
assert.equal(readFileSync(runtimeJournalPath, 'utf8').trim().split(/\r?\n/).length, 2);

const resumed = await runBatch([
  'execute-plan', '--cwd', cwd, '--actor', 'codex-test',
  '--batch', batchRun.batchId, '--json'
]);
assert.equal(resumed.ok, true);
assert.equal((resumed.evidence as any).decision.currentTaskId, 'ATM-GOV-0190');
assert.match((resumed.evidence as any).decision.recoveryCommand, /batch execute-plan/);

const paused = await runBatch([
  'execute-plan', '--cwd', cwd, '--actor', 'codex-test',
  '--batch', batchRun.batchId, '--pause', '--json'
]);
assert.equal(paused.ok, true);
assert.equal((paused.evidence as any).decision.decision, 'paused');
assert.equal((paused.evidence as any).decision.windowDecision.serialFallback, true);
assert.match((paused.evidence as any).decision.recoveryCommand, /batch execute-plan/);

const cancelled = await runBatch([
  'execute-plan', '--cwd', cwd, '--actor', 'codex-test',
  '--batch', batchRun.batchId, '--cancel', '--json'
]);
assert.equal(cancelled.ok, false);
assert.equal((cancelled.evidence as any).decision.decision, 'cancelled');
assert.equal((cancelled.evidence as any).decision.windowDecision.cancelled, true);

const circuit = await runBatch([
  'execute-plan', '--cwd', cwd, '--actor', 'codex-test',
  '--task', 'ATM-GOV-0191', '--auto-batch', 'off', '--json'
]);
assert.equal(circuit.ok, false);
assert.equal((circuit.evidence as any).decision.decision, 'circuit-open');
assert.equal((circuit.evidence as any).decision.windowDecision.circuitOpen, true);
assert.equal((circuit.evidence as any).decision.windowDecision.serialFallback, true);

console.log('plan-level executor recovery ok');
