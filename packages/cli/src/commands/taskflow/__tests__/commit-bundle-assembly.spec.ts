import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTaskflowCommitBundle, finalizeTaskflowCommitBundle } from '../commit-bundle-assembly.ts';

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath: string, text: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, text, 'utf8');
}

function initGitRepo(repo: string) {
  mkdirSync(repo, { recursive: true });
  execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'ATM Validator'], { cwd: repo, stdio: 'ignore' });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'bootstrap'], { cwd: repo, stdio: 'ignore' });
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-commit-bundle-'));
const targetRepo = path.join(tempRoot, 'target');
const planningRepo = path.join(tempRoot, 'planning');
initGitRepo(targetRepo);
initGitRepo(planningRepo);
const planPath = path.join(planningRepo, 'docs/tasks/TASK-BUNDLE-0001.task.md');
writeText(planPath, '# TASK-BUNDLE-0001\n');
writeJson(path.join(targetRepo, '.atm/history/tasks/TASK-BUNDLE-0001.json'), {
  workItemId: 'TASK-BUNDLE-0001',
  deliverables: ['src/app.ts'],
  scopePaths: ['src/app.ts'],
  source: { planPath }
});
writeText(path.join(targetRepo, 'src/app.ts'), 'export const value = 1;\n');

const bundle = buildTaskflowCommitBundle({
  cwd: targetRepo,
  taskId: 'TASK-BUNDLE-0001',
  actorId: 'validator',
  commitMode: 'dry-run',
  planningMirrorPath: planPath,
  rosterIndexPath: null,
  planningAuthorityDeliveryOk: false
});

assert.equal(bundle.targetRepo.commitMessage, 'chore(taskflow): close TASK-BUNDLE-0001 target governance bundle');
assert.equal(bundle.planningRepo.commitMessage, 'docs(taskflow): close TASK-BUNDLE-0001 planning bundle');
assert.ok(bundle.targetDeliveryFiles.includes('src/app.ts'));

const autoCommitTaskId = 'TASK-BUNDLE-0002';
const autoTargetRepo = path.join(tempRoot, 'target-auto');
const autoPlanningRepo = path.join(tempRoot, 'planning-auto');
initGitRepo(autoTargetRepo);
initGitRepo(autoPlanningRepo);
const autoPlanPath = path.join(autoPlanningRepo, 'docs/tasks/TASK-BUNDLE-0002.task.md');
writeText(autoPlanPath, `---\ntask_id: ${autoCommitTaskId}\nstatus: planned\n---\n# ${autoCommitTaskId}\n`);
writeJson(path.join(autoTargetRepo, '.atm/history/tasks/TASK-BUNDLE-0002.json'), {
  workItemId: autoCommitTaskId,
  title: `${autoCommitTaskId} fixture`,
  status: 'running',
  claim: {
    actorId: 'validator',
    leaseId: 'lease-bundle-0002',
    state: 'active'
  },
  deliverables: ['src/app.ts'],
  scopePaths: ['src/app.ts'],
  source: { planPath: autoPlanPath }
});
writeJson(path.join(autoTargetRepo, '.atm/history/evidence/TASK-BUNDLE-0002.json'), {
  taskId: autoCommitTaskId,
  schemaId: 'atm.taskEvidence.v1'
});
writeJson(path.join(autoTargetRepo, '.atm/history/evidence/TASK-BUNDLE-0002.closure-packet.json'), {
  taskId: autoCommitTaskId,
  schemaId: 'atm.closurePacket.v1'
});
writeText(path.join(autoTargetRepo, 'src/app.ts'), 'export const value = 2;\n');
mkdirSync(path.join(autoTargetRepo, '.atm', 'runtime', 'sessions'), { recursive: true });
writeJson(path.join(autoTargetRepo, '.atm', 'runtime', 'sessions', 'session-bundle-0002.json'), {
  schemaId: 'atm.actorWorkSession.v1',
  specVersion: '0.1.0',
  sessionId: 'session-bundle-0002',
  actorId: 'validator',
  taskId: autoCommitTaskId,
  claimLeaseId: 'lease-bundle-0002',
  status: 'active',
  createdAt: '2026-06-20T00:00:00.000Z',
  updatedAt: '2026-06-20T00:00:00.000Z',
  heartbeatAt: '2026-06-20T00:00:00.000Z',
  taskPath: `.atm/history/tasks/${autoCommitTaskId}.json`,
  sourcePrompt: null,
  batchId: null,
  guidanceSessionId: null,
  editor: 'codex',
  gitName: 'ATM Validator',
  gitEmail: 'validator@example.invalid'
});
writeText(path.join(autoTargetRepo, 'scratch/foreign.txt'), 'foreign staged WIP\n');
execFileSync('git', ['add', 'scratch/foreign.txt'], { cwd: autoTargetRepo, stdio: 'ignore' });
process.env.ATM_GIT_NAME = 'ATM Validator';
process.env.ATM_GIT_EMAIL = 'validator@example.invalid';
const autoBundle = buildTaskflowCommitBundle({
  cwd: autoTargetRepo,
  taskId: autoCommitTaskId,
  actorId: 'validator',
  commitMode: 'auto-commit',
  planningMirrorPath: autoPlanPath,
  rosterIndexPath: null,
  planningAuthorityDeliveryOk: false
});
const autoFinal = await finalizeTaskflowCommitBundle({
  bundle: autoBundle,
  actorId: 'validator',
  taskId: autoCommitTaskId
});
assert.equal(autoFinal.failClosed, false, 'auto-commit bundle must complete even when other staged work exists');
assert.equal(autoFinal.targetRepo.status, 'committed');
assert.ok(autoFinal.targetRepo.commitSha, 'auto-commit must record a target commit SHA');
const autoTargetStaged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd: autoTargetRepo, encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
assert.ok(autoTargetStaged.includes('scratch/foreign.txt'), 'parallel foreign staged work must remain staged');
assert.ok(autoTargetStaged.includes('src/app.ts'), 'task bundle files must remain represented in the close lane');
assert.equal(
  execFileSync('git', ['log', '-1', '--pretty=%s'], { cwd: autoTargetRepo, encoding: 'utf8' }).trim(),
  `chore(taskflow): close ${autoCommitTaskId} target governance bundle`
);

console.log('ok: commit bundle assembly spec passed');
