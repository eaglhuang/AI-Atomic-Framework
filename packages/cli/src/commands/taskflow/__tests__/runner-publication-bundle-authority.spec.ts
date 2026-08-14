import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deriveRunnerBuildOutputInventory } from '../../../../../core/src/broker/runner-build-output-inventory.ts';
import { buildTaskflowCommitBundle } from '../commit-bundle-assembly.ts';

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-runner-bundle-authority-'));
const targetRepo = path.join(root, 'target');
const planningRepo = path.join(root, 'planning');
const taskId = 'ATM-GOV-RUNNER-AUTHORITY-FIXTURE';
const planPath = path.join(planningRepo, 'docs', 'tasks', `${taskId}.task.md`);
for (const repo of [targetRepo, planningRepo]) {
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'ATM Validator'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'fixture bootstrap'], { cwd: repo, stdio: 'ignore' });
}

mkdirSync(path.dirname(planPath), { recursive: true });
writeFileSync(planPath, `# ${taskId}\n`, 'utf8');
writeJson(path.join(targetRepo, '.atm/history/tasks', `${taskId}.json`), {
  workItemId: taskId,
  deliverables: [],
  scopePaths: [],
  source: { planPath }
});

const ownedOutput = 'release/atm-onefile/atm.mjs';
const foreignOutput = 'release/foreign-lane/atm.mjs';
mkdirSync(path.dirname(path.join(targetRepo, ownedOutput)), { recursive: true });
mkdirSync(path.dirname(path.join(targetRepo, foreignOutput)), { recursive: true });
writeFileSync(path.join(targetRepo, ownedOutput), 'owned runner output\n', 'utf8');
writeFileSync(path.join(targetRepo, foreignOutput), 'foreign runner output\n', 'utf8');
const foreignBytes = execFileSync('git', ['hash-object', foreignOutput], { cwd: targetRepo, encoding: 'utf8' }).trim();

writeJson(path.join(targetRepo, '.atm/history/evidence', `${taskId}.runner-sync-receipt.json`), {
  schemaId: 'atm.runnerSyncReceipt.v1', taskId,
  linkedTaskIds: ['ATM-GOV-OTHER'],
  memberTaskIds: ['ATM-FRAMEWORK-TEMP-OTHER'],
  groupManifest: { memberTaskIds: ['ATM-FRAMEWORK-TEMP-OTHER'] },
  childAttribution: { complete: true, members: [{ taskId: 'ATM-FRAMEWORK-TEMP-OTHER' }] },
  outputInventory: deriveRunnerBuildOutputInventory({
    sealedSourceSha: 'a'.repeat(40), observedPaths: [foreignOutput], currentTaskId: 'ATM-FRAMEWORK-TEMP-OTHER',
    ownership: [{ path: foreignOutput, ownerTaskId: 'ATM-FRAMEWORK-TEMP-OTHER' }]
  })
});
const foreignBundle = buildTaskflowCommitBundle({ cwd: targetRepo, taskId, actorId: 'validator', commitMode: 'dry-run', planningMirrorPath: planPath, rosterIndexPath: null, planningAuthorityDeliveryOk: false });
assert.ok(!foreignBundle.targetRepo.stageFiles.includes(foreignOutput), 'foreign producer output must be excluded from a consumer close bundle');
assert.equal(execFileSync('git', ['hash-object', foreignOutput], { cwd: targetRepo, encoding: 'utf8' }).trim(), foreignBytes, 'foreign output must remain byte-preserved');

writeJson(path.join(targetRepo, '.atm/history/evidence', `${taskId}.runner-sync-receipt.json`), {
  schemaId: 'atm.runnerSyncReceipt.v1', taskId,
  linkedTaskIds: [taskId], memberTaskIds: [taskId], groupManifest: { memberTaskIds: [taskId] },
  childAttribution: { complete: true, members: [{ taskId }] },
  outputInventory: deriveRunnerBuildOutputInventory({
    sealedSourceSha: 'a'.repeat(40), observedPaths: [ownedOutput], currentTaskId: taskId,
    ownership: [{ path: ownedOutput, ownerTaskId: taskId }]
  })
});
const ownBundle = buildTaskflowCommitBundle({
  cwd: targetRepo, taskId, actorId: 'validator', commitMode: 'dry-run', planningMirrorPath: planPath,
  rosterIndexPath: null, planningAuthorityDeliveryOk: false, runnerPublicationFiles: [foreignOutput]
} as unknown as Parameters<typeof buildTaskflowCommitBundle>[0]);
assert.ok(ownBundle.targetRepo.stageFiles.includes(ownedOutput), 'the canonical own receipt output must be stageable');
assert.ok(!ownBundle.targetRepo.stageFiles.includes(foreignOutput), 'runtime caller injection cannot bypass the canonical receipt boundary');

console.log('[runner-publication-bundle-authority] ownership boundary assertions passed.');
