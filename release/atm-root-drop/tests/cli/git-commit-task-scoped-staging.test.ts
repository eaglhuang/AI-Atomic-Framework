import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTaskScopedCommitBundle, runAtmGit } from '../../packages/cli/src/commands/git-governance.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempDir = path.resolve(root, '.atm-temp-test-git-commit-task-scoped-staging');

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function runGit(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function expectCliError(promise: Promise<unknown>, code: string) {
  return promise.then(
    () => {
      throw new Error(`expected ${code}`);
    },
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, code);
      return error as { details?: Record<string, unknown> };
    }
  );
}

try {
  rmSync(tempDir, { recursive: true, force: true });
  mkdirSync(tempDir, { recursive: true });
  runGit(tempDir, ['init']);
  runGit(tempDir, ['config', 'user.name', 'fixture-agent']);
  runGit(tempDir, ['config', 'user.email', 'fixture-agent@example.com']);

  writeJson(path.join(tempDir, '.atm/config.json'), {
    schemaVersion: 'atm.config.v0.1',
    layoutVersion: 2,
    paths: { tasks: '.atm/history/tasks', taskEvents: '.atm/history/task-events' },
    taskLedger: { enabled: true, mode: 'auto', mirrorExternalTasks: true, requireCliTransitions: true, provider: 'atm-local' }
  });
  writeJson(path.join(tempDir, '.atm/runtime/identity/default.json'), {
    schemaId: 'atm.identityDefault.v1',
    specVersion: '0.1.0',
    actorId: 'fixture-agent',
    gitName: 'fixture-agent',
    gitEmail: 'fixture-agent@example.com',
    updatedAt: '2026-06-11T00:00:00.000Z'
  });

  const taskId = 'TASK-GIT-STAGING-0141';
  const foreignTaskId = 'TASK-FOREIGN-0001';
  const scopedFile = 'src/task-scoped-staging.ts';
  const sessionId = 'session-git-staging-0141';
  const leaseId = 'lease-git-staging-0141';
  const taskDocument = {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'git commit task-scoped staging fixture',
    status: 'running',
    owner: 'fixture-agent',
    scopePaths: [scopedFile],
    deliverables: [scopedFile],
    claim: {
      actorId: 'fixture-agent',
      leaseId,
      state: 'active',
      files: [scopedFile]
    }
  };
  writeJson(path.join(tempDir, '.atm/history/tasks', `${taskId}.json`), taskDocument);
  writeJson(path.join(tempDir, '.atm/runtime/sessions', `${sessionId}.json`), {
    schemaId: 'atm.actorWorkSession.v1',
    specVersion: '0.1.0',
    sessionId,
    actorId: 'fixture-agent',
    taskId,
    claimLeaseId: leaseId,
    status: 'active',
    createdAt: '2026-06-11T00:00:00.000Z',
    updatedAt: '2026-06-11T00:00:00.000Z'
  });

  mkdirSync(path.join(tempDir, path.dirname(scopedFile)), { recursive: true });
  writeFileSync(path.join(tempDir, scopedFile), 'export const taskScopedStaging = true;\n', 'utf8');
  runGit(tempDir, ['add', '.atm']);
  runGit(tempDir, ['commit', '-m', 'chore: bootstrap staging fixture']);

  const unstagedCommit = expectCliError(
    runAtmGit([
      'commit',
      '--cwd', tempDir,
      '--actor', 'fixture-agent',
      '--task', taskId,
      '--session', sessionId,
      '--message', 'feat: scoped deliverable',
      '--json'
    ]),
    'ATM_GIT_COMMIT_TASK_SCOPED_STAGING_REQUIRED'
  );
  const unstagedDetails = (await unstagedCommit).details ?? {};
  assert.ok(Array.isArray(unstagedDetails.inScopeDirtyFiles) && (unstagedDetails.inScopeDirtyFiles as string[]).includes(scopedFile));
  assert.ok(String(unstagedDetails.requiredCommand).includes(scopedFile));
  assert.ok(String(unstagedDetails.copyableCommitCommand).includes('-m'));

  const outsideFile = 'notes/out-of-scope.txt';
  mkdirSync(path.join(tempDir, 'notes'), { recursive: true });
  writeFileSync(path.join(tempDir, outsideFile), 'outside scope\n', 'utf8');
  const sharedWorktreeCommit = expectCliError(
    runAtmGit([
      'commit',
      '--cwd', tempDir,
      '--actor', 'fixture-agent',
      '--task', taskId,
      '--session', sessionId,
      '--message', 'feat: shared worktree dirty only',
      '--json'
    ]),
    'ATM_GIT_COMMIT_TASK_SCOPED_STAGING_REQUIRED'
  );
  const sharedDetails = (await sharedWorktreeCommit).details ?? {};
  assert.deepEqual(sharedDetails.inScopeDirtyFiles, [scopedFile]);
  assert.deepEqual(sharedDetails.skippedExternalDirtyFiles, [outsideFile]);

  const dryRun = await runAtmGit([
    'commit',
    '--cwd', tempDir,
    '--actor', 'fixture-agent',
    '--task', taskId,
    '--session', sessionId,
    '--message', 'feat: scoped deliverable',
    '--dry-run',
    '--auto-stage',
    '--json'
  ]);
  assert.equal(dryRun.ok, true);
  assert.equal((dryRun.evidence as any).commitBundle.schemaId, 'atm.taskScopedCommitBundle.v1');
  assert.deepEqual((dryRun.evidence as any).commitBundle.stageFiles, [scopedFile]);
  assert.deepEqual((dryRun.evidence as any).commitBundle.skippedExternalDirtyFiles, [outsideFile]);

  const autoStageCommit = await runAtmGit([
    'commit',
    '--cwd', tempDir,
    '--actor', 'fixture-agent',
    '--task', taskId,
    '--session', sessionId,
    '--message', 'feat: scoped deliverable',
    '--auto-stage',
    '--json'
  ]);
  assert.equal(autoStageCommit.ok, true);
  assert.equal(typeof autoStageCommit.evidence?.commitSha, 'string');
  assert.ok(String((autoStageCommit.evidence as any).copyableCommitCommand).includes('ATM-Task'));

  writeFileSync(path.join(tempDir, scopedFile), 'export const taskScopedStaging = "again";\n', 'utf8');
  const foreignEvidence = `.atm/history/evidence/${foreignTaskId}.json`;
  writeJson(path.join(tempDir, foreignEvidence), { taskId: foreignTaskId, evidence: [] });
  runGit(tempDir, ['add', foreignEvidence]);
  const foreignBlocked = expectCliError(
    runAtmGit([
      'commit',
      '--cwd', tempDir,
      '--actor', 'fixture-agent',
      '--task', taskId,
      '--session', sessionId,
      '--message', 'feat: foreign staged bundle',
      '--auto-stage',
      '--json'
    ]),
    'ATM_GIT_COMMIT_FOREIGN_STAGED_TASKS'
  );
  const foreignDetails = (await foreignBlocked).details ?? {};
  assert.ok(Array.isArray(foreignDetails.unexpectedStagedTasks));

  const bundle = resolveTaskScopedCommitBundle({
    cwd: tempDir,
    taskId,
    taskDocument,
    apply: true,
    autoStage: false,
    deferForeignStaged: true,
    message: 'feat: defer foreign staged',
    actorId: 'fixture-agent',
    trailers: [`ATM-Actor: fixture-agent`, `ATM-Task: ${taskId}`]
  });
  assert.equal(bundle.ok, true);
  assert.ok(bundle.deferredForeignStagedSnapshot);
  assert.equal(readFileSync(path.join(tempDir, foreignEvidence), 'utf8').includes(foreignTaskId), true);

  const deferredCommit = await runAtmGit([
    'commit',
    '--cwd', tempDir,
    '--actor', 'fixture-agent',
    '--task', taskId,
    '--session', sessionId,
    '--message', 'feat: after defer foreign staged',
    '--auto-stage',
    '--defer-foreign-staged',
    '--json'
  ]);
  assert.equal(deferredCommit.ok, true);

  console.log('[git-commit-task-scoped-staging] ok');
} finally {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
