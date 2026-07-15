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
  execFileSync('git', ['commit', '--allow-empty', '-m', 'bootstrap'], { cwd: repo, stdio: 'ignore' });
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-commit-bundle-markdown-'));
const taskId = 'TASK-BUNDLE-MARKDOWN-0001';
const targetRepo = path.join(tempRoot, 'target');
const planningRepo = path.join(tempRoot, 'planning');
initGitRepo(targetRepo);
initGitRepo(planningRepo);

const planPath = path.join(planningRepo, 'docs/tasks/TASK-BUNDLE-MARKDOWN-0001.task.md');
writeText(planPath, '# TASK-BUNDLE-MARKDOWN-0001\n');
writeJson(path.join(targetRepo, '.atm/history/tasks/TASK-BUNDLE-MARKDOWN-0001.json'), {
  workItemId: taskId,
  deliverables: ['`src/code-span.ts`'],
  taskDirectionLock: {
    allowedFiles: ['src/code-span.ts']
  },
  source: { planPath }
});
writeText(path.join(targetRepo, 'src/code-span.ts'), 'export const codeSpan = true;\n');

const bundle = buildTaskflowCommitBundle({
  cwd: targetRepo,
  taskId,
  actorId: 'validator',
  commitMode: 'dry-run',
  planningMirrorPath: planPath,
  rosterIndexPath: null,
  planningAuthorityDeliveryOk: false
});

assert.equal(bundle.failClosed, false, 'markdown code-span deliverables must normalize to repo paths');
assert.ok(bundle.targetDeliveryFiles.includes('src/code-span.ts'));

console.log('ok: commit bundle markdown paths spec passed');
