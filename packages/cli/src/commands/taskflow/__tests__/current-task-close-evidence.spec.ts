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
assert.deepEqual(listCurrentTaskCloseEvidenceFiles(targetRepo, taskId), [reconciliationPath]);

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
console.log('[current-task-close-evidence] ok');
