import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildTaskflowCommitBundle,
  finalizeTaskflowCommitBundle
} from '../commit-bundle-assembly.ts';

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath: string, text: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, text, 'utf8');
}

function git(cwd: string, args: readonly string[]) {
  return execFileSync('git', [...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function initGitRepo(repo: string) {
  mkdirSync(repo, { recursive: true });
  git(repo, ['init']);
  git(repo, ['config', 'user.email', 'seal@example.invalid']);
  git(repo, ['config', 'user.name', 'ATM Seal Test']);
  git(repo, ['commit', '--allow-empty', '-m', 'bootstrap']);
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-seal-and-commit-'));
const targetRepo = path.join(tempRoot, 'target');
const planningRepo = path.join(tempRoot, 'planning');
const taskId = 'TASK-SEAL-0001';
initGitRepo(targetRepo);
initGitRepo(planningRepo);

const planPath = path.join(planningRepo, 'docs/tasks/TASK-SEAL-0001.task.md');
writeText(planPath, `---\ntask_id: ${taskId}\nstatus: running\n---\n# ${taskId}\n`);
git(planningRepo, ['add', 'docs/tasks/TASK-SEAL-0001.task.md']);
git(planningRepo, ['commit', '-m', 'add planning card']);
const planningHeadBeforeClose = git(planningRepo, ['rev-parse', 'HEAD']);
writeText(planPath, `---\ntask_id: ${taskId}\nstatus: done\ndelivery_commit: "historical-delivery-sha"\n---\n# ${taskId}\n`);

writeJson(path.join(targetRepo, `.atm/history/tasks/${taskId}.json`), {
  workItemId: taskId,
  title: `${taskId} fixture`,
  status: 'done',
  deliverables: ['src/app.ts'],
  scopePaths: ['src/app.ts'],
  targetAllowedFiles: ['src/app.ts'],
  source: { planPath }
});
writeJson(path.join(targetRepo, `.atm/history/evidence/${taskId}.json`), {
  schemaId: 'atm.taskEvidence.v1',
  taskId,
  evidence: []
});
writeJson(path.join(targetRepo, `.atm/history/evidence/${taskId}.closure-packet.json`), {
  schemaId: 'atm.closurePacket.v1',
  taskId,
  targetCommit: 'historical-delivery-sha'
});
writeJson(path.join(targetRepo, `.atm/history/task-events/${taskId}/close.json`), {
  schemaId: 'atm.taskTransition.v1',
  taskId,
  transitionId: 'close',
  action: 'close'
});
writeText(path.join(targetRepo, 'src/app.ts'), 'export const sealed = true;\n');
const targetHeadBeforeClose = git(targetRepo, ['rev-parse', 'HEAD']);
process.env.ATM_GIT_NAME = 'ATM Seal Test';
process.env.ATM_GIT_EMAIL = 'seal@example.invalid';

const bundle = buildTaskflowCommitBundle({
  cwd: targetRepo,
  taskId,
  actorId: 'seal-tester',
  commitMode: 'auto-commit',
  planningMirrorPath: planPath,
  rosterIndexPath: null,
  historicalDeliveryRefs: ['historical-delivery-sha'],
  historicalBatchRef: 'batch-seal-1',
  planningAuthorityDeliveryOk: false,
  backendResult: {
    evidence: {
      taskPath: `.atm/history/tasks/${taskId}.json`,
      closurePacketPath: `.atm/history/evidence/${taskId}.closure-packet.json`,
      transitionPath: `.atm/history/task-events/${taskId}/close.json`
    }
  }
});

assert.ok(bundle.targetRepo.stageFiles.includes(`.atm/history/evidence/${taskId}.seal-and-commit.json`));
const finalized = await finalizeTaskflowCommitBundle({
  bundle,
  actorId: 'seal-tester',
  taskId
});

assert.equal(finalized.failClosed, false);
assert.equal(finalized.targetRepo.status, 'committed');
assert.equal(finalized.planningRepo.status, 'committed');

const manifestPath = path.join(targetRepo, `.atm/history/evidence/${taskId}.seal-and-commit.json`);
assert.equal(existsSync(manifestPath), true, 'seal manifest must be written before commit');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>;
assert.equal(manifest.schemaId, 'atm.taskflowSealAndCommitReceipt.v1');
assert.equal(manifest.taskId, taskId);
assert.equal(manifest.targetHeadBeforeCommit, targetHeadBeforeClose);
assert.equal(manifest.planningHeadBeforeCommit, planningHeadBeforeClose);
assert.deepEqual(manifest.historicalDeliveryRefs, ['historical-delivery-sha']);
assert.equal(manifest.historicalBatchRef, 'batch-seal-1');
assert.equal(manifest.sealDigest, finalized.sealAndCommitReceipt.sealDigest);

const targetCommitMessage = git(targetRepo, ['log', '-1', '--pretty=%B']);
assert.match(targetCommitMessage, new RegExp(`ATM-Seal-Digest: ${String(manifest.sealDigest).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
assert.match(targetCommitMessage, /ATM-Payload-Digest: sha256:/);
assert.match(targetCommitMessage, /ATM-Evidence-Digest: sha256:/);
assert.match(targetCommitMessage, new RegExp(`ATM-Seal-Manifest: \\.atm/history/evidence/${taskId}\\.seal-and-commit\\.json`));

const committedFiles = git(targetRepo, ['show', '--pretty=format:', '--name-only', 'HEAD', '--'])
  .split(/\r?\n/)
  .filter(Boolean);
assert.ok(committedFiles.includes(`.atm/history/evidence/${taskId}.seal-and-commit.json`), 'target commit must include the seal manifest');
