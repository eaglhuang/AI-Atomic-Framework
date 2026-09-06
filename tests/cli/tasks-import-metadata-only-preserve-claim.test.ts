import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { applyMetadataOnlyImport } from '../../packages/cli/src/commands/tasks/import-orchestrator.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-metadata-import-'));
try {
  mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
  const task = {
    workItemId: 'ATM-GOV-0414', status: 'running', title: 'preserve', validators: ['old'],
    scopePaths: ['packages/owned.ts'], deliverables: ['packages/owned.ts'], dependencies: ['ATM-GOV-0273'],
    claim: { state: 'active', actorId: 'codex-captain', laneId: 'lane-test', sessionId: 'session-test', leaseId: 'lease-test' },
    source: { planPath: 'docs/plan.md', planningSourceSeal: { planningCommitSha: null, contentDigest: 'old' } },
    evidence: { required: 'test' }, rollback: { strategy: 'revert' }, atomizationImpact: { atomCid: 'cid:test' }
  };
  writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', 'ATM-GOV-0414.json'), `${JSON.stringify(task, null, 2)}\n`);
  const receipt = applyMetadataOnlyImport({
    cwd, taskId: 'ATM-GOV-0414', actorId: 'codex-captain', importedValidators: ['new'],
    importedPlanningSourceSeal: { planningCommitSha: 'abc', contentDigest: 'new' }, command: 'test metadata-only import'
  });
  const updated = JSON.parse(readFileSync(path.join(cwd, '.atm', 'history', 'tasks', 'ATM-GOV-0414.json'), 'utf8'));
  assert.deepEqual(updated.validators, ['new']);
  assert.equal(updated.status, 'running');
  assert.deepEqual(updated.claim, task.claim);
  assert.deepEqual(updated.scopePaths, task.scopePaths);
  assert.deepEqual(updated.evidence, task.evidence);
  assert.deepEqual(updated.source.planPath, task.source.planPath);
  assert.deepEqual(receipt.changedKeys, ['validators', 'source.planningSourceSeal']);
  assert.equal(receipt.laneId, 'lane-test');
  assert.equal(receipt.sessionId, 'session-test');
  const beforeWrongOwner = readFileSync(path.join(cwd, '.atm', 'history', 'tasks', 'ATM-GOV-0414.json'), 'utf8');
  assert.throws(() => applyMetadataOnlyImport({ cwd, taskId: 'ATM-GOV-0414', actorId: 'other', importedValidators: ['bad'], importedPlanningSourceSeal: { bad: true }, command: 'test' }), (error: unknown) => (error as { code?: string }).code === 'ATM_TASK_METADATA_ONLY_IMPORT_OWNER_MISMATCH');
  assert.equal(readFileSync(path.join(cwd, '.atm', 'history', 'tasks', 'ATM-GOV-0414.json'), 'utf8'), beforeWrongOwner);
} finally { rmSync(cwd, { recursive: true, force: true }); }

console.log('tasks-import-metadata-only-preserve-claim: ok');
