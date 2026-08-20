import assert from 'node:assert/strict';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildResidueReconcileReport } from '../../residue.ts';
import { runNext } from '../../next.ts';
import { runTaskflow } from '../../taskflow.ts';
import { runTasksClaimLifecycle } from '../../tasks.ts';
import { runTasksClose } from '../../tasks/close-orchestrator.ts';

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

function initGitRepo(repoRoot: string) {
  mkdirSync(repoRoot, { recursive: true });
  git(repoRoot, ['init']);
  git(repoRoot, ['config', 'user.email', 'crash@example.invalid']);
  git(repoRoot, ['config', 'user.name', 'ATM Crash Matrix']);
}

async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
  const startedAt = Date.now();
  while (!existsSync(filePath)) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(`Timed out waiting for ${filePath}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

function terminateProcessTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    try {
      execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } catch {
      child.kill('SIGKILL');
    }
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    child.kill('SIGKILL');
  }
}

/**
 * Windows reports the process as exited before every descendant has released
 * its working-directory handle.  Teardown is not an assertion waiver: it has
 * a short, bounded barrier and rethrows the last filesystem error if the
 * process tree has not actually quiesced.
 */
async function removeFixtureWithRetry(target: string): Promise<void> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      rmSync(target, { recursive: true, force: true, maxRetries: 0 });
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw lastError;
}

async function makeKillAfterTargetCommitFixture() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-close-crash-kill-after-target-'));
  const targetRepo = path.join(tempRoot, 'target');
  const planningRepo = path.join(tempRoot, 'planning');
  initGitRepo(targetRepo);
  initGitRepo(planningRepo);
  writeJson(path.join(targetRepo, 'package.json'), { name: 'target-crash-matrix', type: 'module' });
  writeJson(path.join(targetRepo, '.atm/config.json'), {
    schemaVersion: 'atm.config.v0.1',
    layoutVersion: 2,
    paths: { tasks: '.atm/history/tasks', taskEvents: '.atm/history/task-events' },
    taskLedger: { enabled: true, mode: 'auto', mirrorExternalTasks: true, requireCliTransitions: true, provider: 'atm-local' }
  });
  writeJson(path.join(targetRepo, '.atm/runtime/identity/default.json'), {
    actorId: 'validator',
    gitName: 'ATM Crash Matrix',
    gitEmail: 'crash@example.invalid',
    updatedAt: new Date().toISOString()
  });

  const taskId = 'TASK-CRASH-KILL-AFTER-TARGET';
  const planPath = path.join(planningRepo, 'docs/tasks/TASK-CRASH-KILL-AFTER-TARGET.task.md');
  writeText(planPath, [
    '---',
    `task_id: ${taskId}`,
    'title: "Kill after target commit fixture"',
    'status: running',
    '---',
    `# ${taskId}`
  ].join('\n'));
  writeJson(path.join(planningRepo, 'taskflow.profile.json'), {
    schemaId: 'taskflow.profile.v1',
    id: 'crash-matrix-profile',
    name: 'Crash Matrix Profile',
    repoLabel: 'Planning Repo',
    ownerRepo: 'planning',
    taskIdPrefix: 'TASK-CRASH',
    taskId: { format: 'TASK-CRASH-NNNN' },
    template: { defaultMarkdown: '# ${taskId} ${title}' },
    capabilities: { supportsDryRun: true, supportsWrite: false },
    delegation: {
      hint: 'hint',
      openerPath: 'tools/task-card-opener.js',
      policy: {
        allocateTaskId: { mode: 'host-opener', prefix: 'TASK-CRASH', format: 'TASK-CRASH-NNNN' },
        resolveCanonicalOutputPath: { mode: 'host-opener', pattern: 'docs/tasks/${taskId}.task.md', directory: 'docs/tasks' },
        rosterSyncPolicy: 'none',
        fallbackBehavior: { mode: 'template-only-fallback', reason: 'fallback' }
      },
      writerInvocation: { describeOnly: false, displayHint: 'node tools/task-card-opener.js --write --task ${taskId}' }
    }
  });
  writeJson(path.join(targetRepo, '.atm/history/tasks', `${taskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title: 'Kill after target commit fixture',
    status: 'ready',
    scopePaths: ['src/deliver.txt'],
    deliverables: ['src/deliver.txt'],
    targetAllowedFiles: ['src/deliver.txt'],
    planningRepo: 'planning',
    targetRepo: 'target',
    closureAuthority: 'target_repo',
    source: { planPath }
  });
  writeText(path.join(targetRepo, 'src/deliver.txt'), 'baseline\n');
  git(targetRepo, ['add', '.']);
  git(targetRepo, ['commit', '-m', 'base target']);
  git(planningRepo, ['add', '.']);
  git(planningRepo, ['commit', '-m', 'base planning']);

  const claim = await runNext(['--cwd', targetRepo, '--claim', '--actor', 'validator', '--task', taskId, '--claim-intent', 'write']);
  assert.equal(claim.ok, true);
  const laneSessionId = (claim.evidence as { laneSession?: { laneSessionId?: unknown } }).laneSession?.laneSessionId;
  if (typeof laneSessionId !== 'string') throw new Error('claim must mint an owner lane capability');
  writeText(path.join(targetRepo, 'src/deliver.txt'), 'delivery after crash\n');
  writeJson(path.join(targetRepo, '.atm/history/evidence', `${taskId}.json`), {
    taskId,
    evidence: [{
      evidenceKind: 'validation',
      evidenceType: 'test',
      summary: 'kill-after-target crash fixture evidence',
      producedBy: 'validator',
      evidenceFreshness: 'fresh',
      details: {
        validationPasses: ['typecheck'],
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

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-close-crash-matrix-'));
git(repo, ['init']);
git(repo, ['config', 'user.email', 'crash@example.invalid']);
git(repo, ['config', 'user.name', 'ATM Crash Matrix']);
git(repo, ['commit', '--allow-empty', '-m', 'bootstrap']);

const abandonedTaskId = 'TASK-ABANDONED-0001';
writeJson(path.join(repo, `.atm/history/tasks/${abandonedTaskId}.json`), {
  workItemId: abandonedTaskId,
  status: 'abandoned'
});
writeJson(path.join(repo, `.atm/history/task-events/${abandonedTaskId}/audit.json`), {
  schemaId: 'atm.taskTransition.v1',
  taskId: abandonedTaskId,
  action: 'audit'
});
git(repo, ['add', `.atm/history/task-events/${abandonedTaskId}/audit.json`]);

const stagedReport = buildResidueReconcileReport(repo, true);
const stagedAudit = stagedReport.statusReport.entries.find((entry) =>
  entry.path === `.atm/history/task-events/${abandonedTaskId}/audit.json`
);
assert.equal(stagedAudit?.indexState, 'staged');
assert.equal(stagedAudit?.recommendedAction, 'manual-review', 'staged audit evidence must not be auto-cleaned');
assert.equal(
  existsSync(path.join(repo, `.atm/history/task-events/${abandonedTaskId}/audit.json`)),
  true,
  'staged audit evidence must remain on disk'
);

const runtimeResidue = path.join(repo, '.atm/runtime/broker-conflict-resolutions/BCR-crash.json');
writeJson(runtimeResidue, { schemaId: 'atm.brokerConflictResolution.v1' });
const runtimeReport = buildResidueReconcileReport(repo, true);
const runtimeAction = runtimeReport.actions.find((entry) => entry.path === '.atm/runtime/broker-conflict-resolutions/BCR-crash.json');
assert.equal(runtimeAction?.applied, true);
assert.equal(runtimeAction?.attempts, 1);
assert.equal(runtimeAction?.failureCode, null);
assert.equal(existsSync(runtimeResidue), false, 'safe runtime residue should be removed');

const residueSource = readFileSync(path.resolve('packages/cli/src/commands/residue.ts'), 'utf8');
assert.match(residueSource, /RESIDUE_REMOVE_MAX_ATTEMPTS\s*=\s*3/);
assert.match(residueSource, /EPERM/);
assert.match(residueSource, /EBUSY/);
assert.match(residueSource, /ENOTEMPTY/);

const stageFailureFixture = await makeKillAfterTargetCommitFixture();
try {
  const taskPath = path.join(stageFailureFixture.targetRepo, '.atm/history/tasks', `${stageFailureFixture.taskId}.json`);
  const eventDir = path.join(stageFailureFixture.targetRepo, '.atm/history/task-events', stageFailureFixture.taskId);
  const indexLockPath = path.join(stageFailureFixture.targetRepo, '.git/index.lock');
  const cachedBefore = git(stageFailureFixture.targetRepo, ['diff', '--cached', '--name-only']);
  const priorLaneSessionId = process.env.ATM_LANE_SESSION_ID;
  process.env.ATM_LANE_SESSION_ID = stageFailureFixture.laneSessionId;
  writeText(indexLockPath, '');
  try {
    await runTasksClose([
      '--cwd', stageFailureFixture.targetRepo,
      '--task', stageFailureFixture.taskId,
      '--actor', 'validator',
      '--status', 'done',
      '--json'
    ]);
    assert.fail('a close artifact staging failure must fail the entire close transaction');
  } catch (error) {
    assert.equal((error as { code?: unknown }).code, 'ATM_TASK_CLOSE_TRANSACTION_FAILED');
  } finally {
    if (priorLaneSessionId === undefined) delete process.env.ATM_LANE_SESSION_ID;
    else process.env.ATM_LANE_SESSION_ID = priorLaneSessionId;
    if (existsSync(indexLockPath)) unlinkSync(indexLockPath);
  }

  const taskAfterFailure = JSON.parse(readFileSync(taskPath, 'utf8')) as { status?: unknown; claim?: { state?: unknown } };
  assert.equal(taskAfterFailure.status, 'running', 'staging failure must restore the pre-close ledger status');
  assert.equal(taskAfterFailure.claim?.state, 'active', 'staging failure must not release the active claim');
  assert.equal(existsSync(path.join(stageFailureFixture.targetRepo, '.atm/history/evidence', `${stageFailureFixture.taskId}.closure-packet.json`)), false);
  const closeEvents = existsSync(eventDir)
    ? readdirSync(eventDir).filter((entry) => readFileSync(path.join(eventDir, entry), 'utf8').includes('"action": "close"'))
    : [];
  assert.deepEqual(closeEvents, [], 'staging failure must remove the uncommitted close transition event');
  assert.equal(git(stageFailureFixture.targetRepo, ['diff', '--cached', '--name-only']), cachedBefore, 'staging failure must not alter the live index');
} finally {
  await removeFixtureWithRetry(stageFailureFixture.tempRoot);
}

const killFixture = await makeKillAfterTargetCommitFixture();
try {
  const markerPath = path.join(killFixture.tempRoot, 'planning-hook-entered.txt');
  const hookDir = path.join(killFixture.planningRepo, '.githooks');
  mkdirSync(hookDir, { recursive: true });
  const markerForHook = markerPath.replace(/\\/g, '/');
  writeText(path.join(hookDir, 'pre-commit'), [
    '#!/bin/sh',
    `node -e "require('fs').writeFileSync(process.argv[1], 'entered\\\\n'); setTimeout(() => {}, 30000)" "${markerForHook}"`
  ].join('\n'));
  git(killFixture.planningRepo, ['config', 'core.hooksPath', '.githooks']);
  if (process.platform !== 'win32') {
    execFileSync('chmod', ['755', path.join(hookDir, 'pre-commit')]);
  }

  const driverPath = path.join(killFixture.tempRoot, 'close-driver.mjs');
  const taskflowPath = path.resolve('packages/cli/src/commands/taskflow.ts').replace(/\\/g, '/');
  writeText(driverPath, [
    `import { runTaskflow } from ${JSON.stringify(`file:///${taskflowPath}`)};`,
    'const [cwd, profile, taskId] = process.argv.slice(2);',
    'const result = await runTaskflow(["close", "--cwd", cwd, "--profile", profile, "--task", taskId, "--actor", "validator", "--write", "--json"]);',
    'process.stdout.write(`${JSON.stringify(result)}\\n`);',
    'process.exit(result.ok ? 0 : 1);'
  ].join('\n'));

  const child = spawn(process.execPath, ['--strip-types', driverPath, killFixture.targetRepo, killFixture.profilePath, killFixture.taskId], {
    cwd: path.resolve('.'),
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ATM_LANE_SESSION_ID: killFixture.laneSessionId }
  });
  let driverStdout = '';
  let driverStderr = '';
  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk: string) => { driverStdout += chunk; });
  child.stderr?.on('data', (chunk: string) => { driverStderr += chunk; });
  try {
    await waitForFile(markerPath, 20_000);
  } catch (error) {
    throw new Error([
      error instanceof Error ? error.message : String(error),
      `close-driver exitCode: ${child.exitCode ?? 'running'}`,
      `close-driver stdout:\n${driverStdout || '(empty)'}`,
      `close-driver stderr:\n${driverStderr || '(empty)'}`
    ].join('\n'));
  }
  const targetCommitAfterCrash = git(killFixture.targetRepo, ['rev-parse', 'HEAD']);
  assert.notEqual(
    targetCommitAfterCrash,
    git(killFixture.targetRepo, ['rev-parse', 'HEAD~1']),
    'target commit must exist before the injected kill'
  );
  terminateProcessTree(child);
  await new Promise((resolve) => child.once('exit', resolve));
  git(killFixture.planningRepo, ['config', '--unset', 'core.hooksPath']);

  const planningCardAfterKill = readFileSync(killFixture.planPath, 'utf8');
  const planningCardRelativePath = path.relative(killFixture.planningRepo, killFixture.planPath).replace(/\\/g, '/');
  const committedPlanningCardAfterKill = git(killFixture.planningRepo, ['show', `HEAD:${planningCardRelativePath}`]);
  assert.match(
    committedPlanningCardAfterKill,
    /status:\s*running/,
    'planning closeback must not be committed after the injected kill'
  );
  assert.match(
    planningCardAfterKill,
    /status:\s*done/,
    'planning closeback worktree may be dirty after the injected kill and must be converged by reconcile'
  );

  const targetHeadBeforeReconcile = git(killFixture.targetRepo, ['rev-parse', 'HEAD']);
  assert.match(
    planningCardAfterKill,
    /completed_by_agent:\s*["']?validator["']?/,
    `post-crash planning mirror must retain closeback actor metadata:\n${planningCardAfterKill}`
  );
  assert.match(
    planningCardAfterKill,
    /completed_at:\s*["']?[^\n]+/,
    `post-crash planning mirror must retain closeback time metadata:\n${planningCardAfterKill}`
  );
  const recordedDeliveryCommit = /delivery_commit:\s*["']?([0-9a-f]{40})["']?/i.exec(planningCardAfterKill)?.[1] ?? null;
  assert.ok(recordedDeliveryCommit, `post-crash planning mirror must retain an addressable delivery reference:\n${planningCardAfterKill}`);
  const deliveredContentBeforeReconcile = readFileSync(path.join(killFixture.targetRepo, 'src/deliver.txt'), 'utf8');
  const priorLaneSessionId = process.env.ATM_LANE_SESSION_ID;
  process.env.ATM_LANE_SESSION_ID = killFixture.laneSessionId;
  let reconcileResult;
  try {
    const renewedClaim = await runTasksClaimLifecycle('renew', [
      '--cwd', killFixture.targetRepo,
      '--actor', 'validator',
      '--task', killFixture.taskId,
      '--json'
    ]);
    assert.equal(
      renewedClaim.ok,
      true,
      `post-crash reconciliation must renew the fixture owner claim before writing: ${JSON.stringify(renewedClaim.evidence ?? renewedClaim)}`
    );
    reconcileResult = await runTaskflow([
      'close',
      '--cwd', killFixture.targetRepo,
      '--profile', killFixture.profilePath,
      '--task', killFixture.taskId,
      '--actor', 'validator',
      '--historical-delivery', recordedDeliveryCommit,
      '--write',
      '--json'
    ]);
  } finally {
    if (priorLaneSessionId === undefined) delete process.env.ATM_LANE_SESSION_ID;
    else process.env.ATM_LANE_SESSION_ID = priorLaneSessionId;
  }
  assert.equal(
    reconcileResult.ok,
    true,
    `kill-after-target commit should converge dirty planning closeback: ${JSON.stringify(reconcileResult.evidence?.closeWriteTransaction ?? reconcileResult.evidence, null, 2)}`
  );
  assert.equal(readFileSync(path.join(killFixture.targetRepo, 'src/deliver.txt'), 'utf8'), deliveredContentBeforeReconcile);
  assert.equal(git(killFixture.targetRepo, ['rev-parse', 'HEAD~1']), targetHeadBeforeReconcile);
  assert.match(
    git(killFixture.planningRepo, ['show', `HEAD:${planningCardRelativePath}`]),
    /status:\s*done/,
    'taskflow close can converge the dirty planning closeback without changing the target deliverable'
  );
} finally {
  await removeFixtureWithRetry(killFixture.tempRoot);
}

console.log('[taskflow-close-crash-matrix] ok');
