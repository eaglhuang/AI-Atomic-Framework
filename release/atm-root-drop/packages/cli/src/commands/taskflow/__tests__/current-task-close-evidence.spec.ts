import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildCurrentTaskCloseEvidence,
  isCurrentTaskCloseEvidenceFile,
  listCurrentTaskCloseEvidenceFiles
} from '../current-task-close-evidence.ts';
import { buildTaskflowCommitBundle } from '../commit-bundle-assembly.ts';
import { buildHistoricalClosePreflight } from '../historical-close-preflight.ts';

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function initGitRepo(repo: string) {
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'ATM Validator'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'bootstrap'], { cwd: repo, stdio: 'ignore' });
}

const taskId = 'TASK-CLOSE-EVIDENCE-0001';
const evidence = buildCurrentTaskCloseEvidence(taskId);
assert.equal(evidence.schemaId, 'atm.taskflowCurrentCloseEvidence.v1');
assert.ok(evidence.supportedPaths.includes(`.atm/history/evidence/${taskId}.live-index-reconciliation.json`));
assert.equal(isCurrentTaskCloseEvidenceFile(taskId, `.atm/history/evidence/${taskId}.live-index-reconciliation.json`), true);
assert.equal(isCurrentTaskCloseEvidenceFile(taskId, `.atm/history/evidence/${taskId}.unrecognized.json`), false);
assert.equal(isCurrentTaskCloseEvidenceFile('TASK-OTHER-0001', `.atm/history/evidence/${taskId}.live-index-reconciliation.json`), false);

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-current-close-evidence-'));
const targetRepo = path.join(root, 'target');
const planningRepo = path.join(root, 'planning');
initGitRepo(targetRepo);
initGitRepo(planningRepo);
const gitHeadEvidencePath = '.atm/history/evidence/git-head.jsonl';
mkdirSync(path.join(targetRepo, '.atm', 'history', 'evidence'), { recursive: true });
writeFileSync(path.join(targetRepo, gitHeadEvidencePath), '{"baseline":true}\n', { encoding: 'utf8' });
execFileSync('git', ['add', '--', gitHeadEvidencePath], { cwd: targetRepo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'track git-head evidence'], { cwd: targetRepo, stdio: 'ignore' });
writeFileSync(path.join(targetRepo, gitHeadEvidencePath), '{"baseline":true}\n{"later":true}\n', { encoding: 'utf8' });
const planningPath = path.join(planningRepo, 'docs', 'tasks', `${taskId}.task.md`);
writeJson(path.join(targetRepo, '.atm', 'history', 'tasks', `${taskId}.json`), {
  workItemId: taskId,
  status: 'running',
  deliverables: ['src/value.ts'],
  scopePaths: ['src/value.ts'],
  source: { planPath: planningPath }
});
mkdirSync(path.join(targetRepo, 'src'), { recursive: true });
writeFileSync(path.join(targetRepo, 'src', 'value.ts'), 'export const value = true;\n', { encoding: 'utf8' });
const reconciliationPath = `.atm/history/evidence/${taskId}.live-index-reconciliation.json`;
writeJson(path.join(targetRepo, reconciliationPath), { schemaId: 'atm.liveIndexReconciliation.v1', taskId, clean: false });
const takeoverPath = `.atm/history/evidence/${taskId}.runner-publication-takeover.json`;
writeJson(path.join(targetRepo, takeoverPath), { schemaId: 'atm.runnerPublicationTakeoverPlan.v1', sealedSourceSha: 'fixture' });
assert.deepEqual(listCurrentTaskCloseEvidenceFiles(targetRepo, taskId), [reconciliationPath]);
writeJson(path.join(targetRepo, takeoverPath), { schemaId: 'atm.runnerPublicationTakeoverPlan.v1', taskId, sealedSourceSha: 'fixture' });
assert.deepEqual(listCurrentTaskCloseEvidenceFiles(targetRepo, taskId), [reconciliationPath, takeoverPath]);

const bundle = buildTaskflowCommitBundle({
  cwd: targetRepo,
  taskId,
  actorId: 'validator',
  commitMode: 'dry-run',
  planningMirrorPath: planningPath,
  rosterIndexPath: null,
  planningAuthorityDeliveryOk: false
});
assert.ok(bundle.targetRepo.stageFiles.includes(reconciliationPath), 'bundle must include supported current-task reconciliation evidence');
assert.ok(bundle.targetRepo.stageFiles.includes(takeoverPath), 'bundle must include semantically attributed takeover evidence');
execFileSync('git', ['add', '--', reconciliationPath], { cwd: targetRepo, stdio: 'ignore' });
const preflight = buildHistoricalClosePreflight({
  cwd: targetRepo,
  taskId,
  actorId: 'validator',
  taskDocument: { deliverables: ['src/value.ts'], scopePaths: ['src/value.ts'] },
  previewCommitBundle: { targetRepo: { repoRoot: targetRepo, stageFiles: bundle.targetRepo.stageFiles }, planningRepo: { repoRoot: null, stageFiles: [] } },
  historicalDeliveryRefs: [],
  waiverOutOfScopeDelivery: false,
  waiverReason: null
});
assert.equal(preflight.unexpectedNonBundleStaged.flatMap((entry) => entry.stagedFiles).includes(reconciliationPath), false, 'pre-close must not classify bundled current-task evidence as unexpected staged residue');
assert.ok(preflight.blockers.some((entry) => entry.id === 'governanceTrackedDirtyFiles'), 'default pre-close must keep dirty git-head evidence fail-closed');
const deferredPreflight = buildHistoricalClosePreflight({
  cwd: targetRepo,
  taskId,
  actorId: 'validator',
  taskDocument: { deliverables: ['src/value.ts'], scopePaths: ['src/value.ts'] },
  previewCommitBundle: { targetRepo: { repoRoot: targetRepo, stageFiles: bundle.targetRepo.stageFiles }, planningRepo: { repoRoot: null, stageFiles: [] } },
  historicalDeliveryRefs: [],
  deferGovernanceDirty: true,
  waiverOutOfScopeDelivery: false,
  waiverReason: null
});
assert.equal(deferredPreflight.blockers.some((entry) => entry.id === 'governanceTrackedDirtyFiles'), false, 'explicit governance deferral must park only deferrable git-head evidence');
assert.ok(deferredPreflight.dirtyGuard.advisoryTrackedDirtyFiles.includes(gitHeadEvidencePath), 'deferred git-head evidence must remain visible as advisory');
console.log('[current-task-close-evidence] ok');
