import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTaskflowCommitBundle } from '../commit-bundle-assembly.ts';

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

console.log('ok: commit bundle assembly spec passed');
