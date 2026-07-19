import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runBatch } from '../../packages/cli/src/commands/batch/implementation.ts';

const cwd = mkdtempSync(path.join(tmpdir(), 'atm-plan-batchrun-'));
mkdirSync(path.join(cwd, 'docs'), { recursive: true });
writeFileSync(path.join(cwd, 'docs', 'plan.md'), '# Plan\n\n- ATM-GOV-0183\n- ATM-GOV-0184\n', 'utf8');

const start = await runBatch([
  'plan-start', '--cwd', cwd, '--actor', 'codex-test',
  '--plan', 'docs/plan.md', '--task', 'ATM-GOV-0183', '--task', 'ATM-GOV-0184',
  '--lane', 'lane-test-1', '--json'
]);
assert.equal(start.ok, true);
const batchRun = (start.evidence as any).batchRun;
assert.equal(batchRun.schemaId, 'atm.batchRun.v1');
assert.equal(batchRun.specVersion, '0.2');
assert.deepEqual(batchRun.taskIds, ['ATM-GOV-0183', 'ATM-GOV-0184']);
assert.equal(batchRun.eventCount, 1);
assert.match(batchRun.planDigest, /^sha256:/);

const event = await runBatch([
  'plan-journal', '--cwd', cwd, '--actor', 'codex-test', '--batch', batchRun.batchId,
  '--task', 'ATM-GOV-0183', '--kind', 'shadow.claim', '--lane', 'lane-test-1',
  '--waited-ms', '42', '--input-tokens', '100', '--output-tokens', '20',
  '--cache-read-tokens', '5', '--token-source', 'manual', '--idempotency-key', 'claim-0183', '--json'
]);
assert.equal(event.ok, true);
const appended = (event.evidence as any).event;
assert.equal(appended.schemaId, 'atm.batchRunJournalEvent.v1');
assert.equal(appended.waitedMs, 42);
assert.equal(appended.tokenUsage.source, 'manual');
assert.equal(appended.tokenUsage.inputTokens, 100);
assert.equal((event.evidence as any).batchRun.eventCount, 2);

const duplicate = await runBatch([
  'plan-journal', '--cwd', cwd, '--actor', 'codex-test', '--batch', batchRun.batchId,
  '--kind', 'shadow.claim', '--idempotency-key', 'claim-0183', '--json'
]);
assert.equal((duplicate.evidence as any).duplicate, true);
assert.equal((duplicate.evidence as any).batchRun.eventCount, 2);

const journalPath = path.join(cwd, (event.evidence as any).batchRun.journalPath);
assert.equal(readFileSync(journalPath, 'utf8').trim().split(/\r?\n/).length, 2);
console.log('durable plan batchrun shadow journal ok');
