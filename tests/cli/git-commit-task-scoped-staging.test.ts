import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAtmGit } from '../../packages/cli/src/commands/git-governance.ts';

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
  const scopedFile = 'src/task-scoped-staging.ts';
  const sessionId = 'session-git-staging-0141';
  const leaseId = 'lease-git-staging-0141';
  writeJson(path.join(tempDir, '.atm/history/tasks', `${taskId}.json`), {
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
  });
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
  assert.ok(String(unstagedDetails.requiredCommand).includes('git'));
  assert.ok(String(unstagedDetails.requiredCommand).includes('add --'));

  const outsideFile = 'notes/out-of-scope.txt';
  mkdirSync(path.join(tempDir, 'notes'), { recursive: true });
  writeFileSync(path.join(tempDir, outsideFile), 'outside scope\n', 'utf8');
  const mixedCommit = expectCliError(
    runAtmGit([
      'commit',
      '--cwd', tempDir,
      '--actor', 'fixture-agent',
      '--task', taskId,
      '--session', sessionId,
      '--message', 'feat: mixed scope attempt',
      '--json'
    ]),
    'ATM_GIT_COMMIT_TASK_SCOPED_STAGING_AMBIGUOUS'
  );
  const mixedDetails = (await mixedCommit).details ?? {};
  assert.deepEqual(mixedDetails.inScopeDirtyFiles, [scopedFile]);
  assert.deepEqual(mixedDetails.outOfScopeDirtyFiles, [outsideFile]);
  assert.equal(mixedDetails.requiredCommand, undefined);

  runGit(tempDir, ['add', scopedFile]);
  const stagedCommit = await runAtmGit([
    'commit',
    '--cwd', tempDir,
    '--actor', 'fixture-agent',
    '--task', taskId,
    '--session', sessionId,
    '--message', 'feat: scoped deliverable',
    '--no-verify',
    '--json'
  ]);
  assert.equal(stagedCommit.ok, true);
  assert.equal(typeof stagedCommit.evidence?.commitSha, 'string');

  console.log('[git-commit-task-scoped-staging] ok');
} finally {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
