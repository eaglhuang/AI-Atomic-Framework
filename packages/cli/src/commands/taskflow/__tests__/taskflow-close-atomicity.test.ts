import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runNext } from '../../next.ts';
import { runTaskflow } from '../../taskflow.ts';

async function withLaneCapability<T>(laneSessionId: string, callback: () => Promise<T>): Promise<T> {
  const previous = process.env.ATM_LANE_SESSION_ID;
  process.env.ATM_LANE_SESSION_ID = laneSessionId;
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.ATM_LANE_SESSION_ID;
    else process.env.ATM_LANE_SESSION_ID = previous;
  }
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeText(filePath: string, content: string) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function readIndexEntry(repoRoot: string, filePath: string): string {
  return execFileSync('git', ['ls-files', '-s', '--', filePath], { cwd: repoRoot, encoding: 'utf8' }).trim();
}

function initGitRepo(repoRoot: string) {
  mkdirSync(repoRoot, { recursive: true });
  execFileSync('git', ['init'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'ATM Fixture'], { cwd: repoRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'fixture@example.invalid'], { cwd: repoRoot, stdio: 'ignore' });
}

async function makeCloseAtomicityFixture(label: string) {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), `atm-taskflow-atomicity-${label}-`));
  const targetRepo = path.join(tempRoot, 'target');
  const planningRepo = path.join(tempRoot, 'planning');
  initGitRepo(targetRepo);
  initGitRepo(planningRepo);
  writeJson(path.join(targetRepo, 'package.json'), { name: `target-atomicity-${label}`, type: 'module' });
  writeJson(path.join(targetRepo, '.atm/config.json'), {
    schemaVersion: 'atm.config.v0.1',
    layoutVersion: 2,
    paths: { tasks: '.atm/history/tasks', taskEvents: '.atm/history/task-events' },
    taskLedger: { enabled: true, mode: 'auto', mirrorExternalTasks: true, requireCliTransitions: true, provider: 'atm-local' }
  });
  writeJson(path.join(targetRepo, '.atm/runtime/identity/default.json'), {
    actorId: 'validator',
    gitName: 'ATM Validator',
    gitEmail: 'validator@example.invalid',
    updatedAt: new Date().toISOString()
  });

  const taskId = `TASK-ATOMIC-${label.toUpperCase()}`;
  const planPath = path.join(planningRepo, 'docs', 'tasks', `${taskId}.task.md`);
  writeText(planPath, [
    '---',
    `task_id: ${taskId}`,
    'title: "Close atomicity fixture"',
    'status: running',
    '---',
    `# ${taskId}`
  ].join('\n'));

  writeJson(path.join(planningRepo, 'taskflow.profile.json'), {
    schemaId: 'taskflow.profile.v1',
    id: `atomicity-profile-${label}`,
    name: 'Atomicity Profile',
    repoLabel: 'Planning Repo',
    ownerRepo: 'planning',
    taskIdPrefix: 'TASK-ATOMIC',
    taskId: { format: 'TASK-ATOMIC-NNNN' },
    template: { defaultMarkdown: '# ${taskId} ${title}' },
    capabilities: { supportsDryRun: true, supportsWrite: false },
    delegation: {
      hint: 'hint',
      openerPath: 'tools/task-card-opener.js',
      policy: {
        allocateTaskId: { mode: 'host-opener', prefix: 'TASK-ATOMIC', format: 'TASK-ATOMIC-NNNN' },
        resolveCanonicalOutputPath: { mode: 'host-opener', pattern: 'docs/tasks/${taskId}.task.md', directory: 'docs/tasks' },
        rosterSyncPolicy: 'none',
        fallbackBehavior: { mode: 'template-only-fallback', reason: 'fallback' }
      },
      writerInvocation: { describeOnly: false, displayHint: 'node tools/task-card-opener.js --write --task ${taskId}' }
    }
  });

  const taskDoc = {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'Close atomicity fixture',
    status: 'ready',
    scopePaths: ['src/deliver.txt'],
    deliverables: ['src/deliver.txt'],
    targetAllowedFiles: ['src/deliver.txt'],
    planningRepo: 'planning',
    targetRepo: 'target',
    closureAuthority: 'target_repo',
    source: { planPath: planPath }
  };
  writeJson(path.join(targetRepo, '.atm/history/tasks', `${taskId}.json`), taskDoc);
  writeText(path.join(targetRepo, 'src/deliver.txt'), 'baseline\n');
  execFileSync('git', ['add', '.'], { cwd: targetRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'base target'], { cwd: targetRepo, stdio: 'ignore' });
  execFileSync('git', ['add', '.'], { cwd: planningRepo, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'base planning'], { cwd: planningRepo, stdio: 'ignore' });

  const claim = await runNext(['--cwd', targetRepo, '--claim', '--actor', 'validator', '--task', taskId, '--claim-intent', 'write']);
  assert.equal(claim.ok, true);
  const laneSessionId = (claim.evidence as { laneSession?: { laneSessionId?: unknown } }).laneSession?.laneSessionId;
  if (typeof laneSessionId !== 'string') throw new Error('claim must mint an owner lane capability');

  writeText(path.join(targetRepo, 'src/deliver.txt'), 'delivery content\n');
  writeJson(path.join(targetRepo, '.atm/history/evidence', `${taskId}.json`), {
    taskId,
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'close atomicity fixture evidence',
      producedBy: 'validator',
      evidenceFreshness: 'fresh',
      details: {
        validationPasses: ['typecheck', 'validate:cli'],
        commandRuns: [{
          command: 'npm run typecheck',
          exitCode: 0,
          stdoutSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
          stderrSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
        }]
      },
      createdAt: new Date().toISOString()
    }]
  });

  return {
    tempRoot,
    targetRepo,
    planningRepo,
    taskId,
    laneSessionId,
    profilePath: path.join(planningRepo, 'taskflow.profile.json'),
    planPath
  };
}

const successFixture = await makeCloseAtomicityFixture('success');
const successClose = await withLaneCapability(successFixture.laneSessionId, () => runTaskflow([
  'close',
  '--cwd', successFixture.targetRepo,
  '--profile', successFixture.profilePath,
  '--task', successFixture.taskId,
  '--actor', 'validator',
  '--write',
  '--json'
])) as any;
assert.equal(successClose.ok, true, 'successful close write must report ok');
assert.equal(successClose.evidence.closeWriteTransaction.phase, 'committed');
assert.equal(successClose.evidence.closeWriteTransaction.ok, true);
const successTaskDoc = JSON.parse(readFileSync(path.join(successFixture.targetRepo, '.atm/history/tasks', `${successFixture.taskId}.json`), 'utf8'));
assert.equal(successTaskDoc.status, 'done');

const rollbackFixture = await makeCloseAtomicityFixture('rollback');
const foreignStagedPath = 'foreign/closure-receipt.json';
writeText(path.join(rollbackFixture.targetRepo, foreignStagedPath), '{"version":"before-close"}\n');
execFileSync('git', ['add', '--', foreignStagedPath], { cwd: rollbackFixture.targetRepo, stdio: 'ignore' });
const foreignIndexBeforeClose = readIndexEntry(rollbackFixture.targetRepo, foreignStagedPath);
const foreignWorktreeBeforeClose = readFileSync(path.join(rollbackFixture.targetRepo, foreignStagedPath), 'utf8');
const hookDir = path.join(rollbackFixture.planningRepo, '.githooks');
mkdirSync(hookDir, { recursive: true });
const hookPath = path.join(hookDir, 'pre-commit');
writeText(hookPath, '#!/bin/sh\nexit 1\n');
chmodSync(hookPath, 0o755);
execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: rollbackFixture.planningRepo, stdio: 'ignore' });
const rollbackClose = await withLaneCapability(rollbackFixture.laneSessionId, () => runTaskflow([
  'close',
  '--cwd', rollbackFixture.targetRepo,
  '--profile', rollbackFixture.profilePath,
  '--task', rollbackFixture.taskId,
  '--actor', 'validator',
  '--defer-foreign-state',
  '--write',
  '--json'
])) as any;
assert.equal(rollbackClose.ok, false, 'commit-bundle failure must fail closed at taskflow layer');
assert.equal(rollbackClose.evidence.closeWriteTransaction.phase, 'rolled_back');
assert.ok(rollbackClose.evidence.closeWriteTransaction.rolledBackArtifacts.length > 0);
const rollbackTaskDoc = JSON.parse(readFileSync(path.join(rollbackFixture.targetRepo, '.atm/history/tasks', `${rollbackFixture.taskId}.json`), 'utf8'));
assert.notEqual(rollbackTaskDoc.status, 'done', 'rolled-back close must not leave a done ledger behind');
assert.match(readFileSync(rollbackFixture.planPath, 'utf8'), /status:\s*running/, 'planning card closeback must roll back with the transaction');
assert.equal(readIndexEntry(rollbackFixture.targetRepo, foreignStagedPath), foreignIndexBeforeClose, 'rollback must restore every foreign staged mode/blob/path identity');
assert.equal(readFileSync(path.join(rollbackFixture.targetRepo, foreignStagedPath), 'utf8'), foreignWorktreeBeforeClose, 'rollback must not alter foreign worktree content');

for (const fixture of [successFixture, rollbackFixture]) {
  if (existsSync(fixture.tempRoot)) {
    rmSync(fixture.tempRoot, { recursive: true, force: true });
  }
}

console.log('[taskflow-close-atomicity] ok');
