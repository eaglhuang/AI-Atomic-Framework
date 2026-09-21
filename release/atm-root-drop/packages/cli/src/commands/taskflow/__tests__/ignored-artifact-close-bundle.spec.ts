import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTaskflowCommitBundle } from '../commit-bundle-assembly.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-ignored-close-bundle-'));
try {
  const planPath = path.join(root, 'docs/tasks/TASK-IGNORED-ARTIFACT.task.md');
  const artifactPath = 'artifacts/generated/final-verdict.json';
  mkdirSync(path.dirname(planPath), { recursive: true });
  writeFileSync(planPath, '# TASK-IGNORED-ARTIFACT\n', 'utf8');
  writeFileSync(path.join(root, '.gitignore'), 'artifacts/generated/\n', 'utf8');
  mkdirSync(path.join(root, '.atm/history/tasks'), { recursive: true });
  writeFileSync(path.join(root, '.atm/history/tasks/TASK-IGNORED-ARTIFACT.json'), `${JSON.stringify({
    workItemId: 'TASK-IGNORED-ARTIFACT',
    deliverables: [artifactPath],
    scopePaths: [artifactPath],
    source: { planPath }
  })}\n`, 'utf8');
  mkdirSync(path.join(root, path.dirname(artifactPath)), { recursive: true });
  writeFileSync(path.join(root, artifactPath), '{"ok":true}\n', 'utf8');
  execFileSync('git', ['init'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'ATM Validator'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['add', '-f', '.gitignore', 'docs', '.atm'], { cwd: root, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'bootstrap'], { cwd: root, stdio: 'ignore' });
  const bundle = buildTaskflowCommitBundle({
    cwd: root,
    taskId: 'TASK-IGNORED-ARTIFACT',
    actorId: 'validator',
    commitMode: 'dry-run',
    planningMirrorPath: planPath,
    rosterIndexPath: null,
    planningAuthorityDeliveryOk: false
  });
  assert.ok(bundle.targetDeliveryFiles.includes(artifactPath), 'declared ignored artifact must enter taskflow delivery files');
  assert.ok(bundle.targetRepo.stageFiles.includes(artifactPath), 'declared ignored artifact must enter the governed stage bundle');
  console.log('[ignored-artifact-close-bundle] ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
