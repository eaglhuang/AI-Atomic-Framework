import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { resolveTaskScopedCommitBundle, runAtmGit } from '../../packages/cli/src/commands/git-governance.ts';
import { inspectGitIndexOwnership } from '../../packages/cli/src/commands/git-index-ownership.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempDir = path.resolve(root, '.atm-temp-test-git-commit-task-scoped-staging');
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const branchCommitQueueSchema = JSON.parse(readFileSync(path.join(root, 'schemas', 'governance', 'branch-commit-queue.schema.json'), 'utf8'));
const validateBranchCommitQueue = ajv.compile(branchCommitQueueSchema);

function assertBranchCommitQueueSchema(value: unknown, label: string) {
  assert.ok(validateBranchCommitQueue(value), `${label} must match branch commit queue schema: ${JSON.stringify(validateBranchCommitQueue.errors)}`);
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function runGit(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function expectCliError(promise: Promise<unknown>, code: string | readonly string[]) {
  const allowedCodes = Array.isArray(code) ? code : [code];
  return promise.then(
    () => {
      throw new Error(`expected ${allowedCodes.join(' or ')}`);
    },
    (error: unknown) => {
      const actualCode = (error as { code?: string }).code ?? '';
      assert.ok(allowedCodes.includes(actualCode), `expected ${allowedCodes.join(' or ')}, got ${actualCode}`);
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
  const foreignActiveTaskId = 'TASK-FOREIGN-ACTIVE-0002';
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

  writeJson(path.join(tempDir, '.atm/runtime/locks/TASK-UNRELATED-LOCK.lock.json'), {
    schemaId: 'atm.governanceScopeLock',
    specVersion: '0.1.0',
    workItemId: 'TASK-UNRELATED-LOCK',
    lockedBy: 'other-agent',
    actorId: 'other-agent',
    leaseId: 'lease-unrelated-lock',
    lockedAt: '2026-06-18T00:00:00.000Z',
    heartbeatAt: '2026-06-18T00:00:00.000Z',
    ttlSeconds: 999999999,
    status: 'active',
    files: ['src/unrelated.ts'],
    taskDirectionLock: {
      schemaId: 'atm.taskDirectionLock.v1',
      specVersion: '0.1.0',
      taskId: 'TASK-UNRELATED-LOCK',
      allowedFiles: ['src/unrelated.ts'],
      planningReadOnlyPaths: [],
      planningMirrorPaths: [],
      allowPlanningMirror: false,
      actorId: 'other-agent',
      createdAt: '2026-06-18T00:00:00.000Z',
      status: 'active'
    }
  });

  runGit(tempDir, ['add', '.atm/runtime/locks/TASK-UNRELATED-LOCK.lock.json']);
  runGit(tempDir, ['commit', '-m', 'chore: add unrelated active direction lock fixture']);

  const importedTaskId = 'TASK-OPEN-0001';
  writeJson(path.join(tempDir, '.atm/history/tasks', `${importedTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: importedTaskId,
    title: 'imported planned task fixture',
    status: 'planned',
    source: {
      planPath: 'docs/tasks/TASK-OPEN-0001.task.md',
      sectionTitle: importedTaskId,
      headingLine: 1,
      hash: 'imported-planned-task-fixture'
    }
  });
  writeJson(path.join(tempDir, '.atm/history/task-events', importedTaskId, '2026-06-18T00-00-00-000Z-import-fixture.json'), {
    schemaId: 'atm.taskTransition.v1',
    taskId: importedTaskId,
    transitionId: '2026-06-18T00-00-00-000Z-import-fixture',
    action: 'import',
    actorId: 'fixture-agent',
    createdAt: '2026-06-18T00:00:00.000Z',
    fromStatus: null,
    toStatus: 'planned',
    command: 'node atm.mjs tasks import --from docs/tasks/TASK-OPEN-0001.task.md --write --json'
  });
  runGit(tempDir, ['add', `.atm/history/tasks/${importedTaskId}.json`, `.atm/history/task-events/${importedTaskId}`]);
  const importCommit = await runAtmGit([
    'commit',
    '--cwd', tempDir,
    '--actor', 'fixture-agent',
    '--task', importedTaskId,
    '--message', 'chore(task): import planned task fixture',
    '--json'
  ]);
  assert.equal(importCommit.ok, true, 'ATM git wrapper must commit task import bundles without claiming the new planned task');
  assert.equal(typeof importCommit.evidence?.commitSha, 'string');
  assert.equal((importCommit.evidence as any).branchCommitQueue?.serializedBy, 'branch-commit-queue');
  assert.equal((importCommit.evidence as any).branchCommitQueue?.retryableRaceCode, 'ATM_GIT_COMMIT_BRANCH_QUEUE_RACE');
  assert.equal((importCommit.evidence as any).branchCommitQueue?.headShaAtCommitStart, (importCommit.evidence as any).branchCommitQueue?.headShaAtAcquire);
  assertBranchCommitQueueSchema((importCommit.evidence as any).branchCommitQueue, 'import commit branch queue evidence');
  assert.equal(runGit(tempDir, ['show', '--name-only', '--format=', 'HEAD']).includes('.atm/history/evidence/git-head.jsonl'), true, 'task-scoped ledger-boundary commit must include git-head evidence in the same commit');

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
    ['ATM_GIT_COMMIT_TASK_SCOPED_STAGING_REQUIRED', 'ATM_GIT_COMMIT_TASK_SCOPED_STAGING_AMBIGUOUS']
  );
  const sharedDetails = (await sharedWorktreeCommit).details ?? {};
  assert.deepEqual(sharedDetails.inScopeDirtyFiles, [scopedFile]);
  if (Array.isArray(sharedDetails.skippedExternalDirtyFiles)) {
    assert.deepEqual(sharedDetails.skippedExternalDirtyFiles, [outsideFile]);
  } else {
    assert.deepEqual(sharedDetails.outOfScopeStagedFiles, [outsideFile]);
  }

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
  assert.equal((dryRun.evidence as any).commitBundle.stagingStrategy, 'explicit-pathspec-git-add');
  assert.deepEqual((dryRun.evidence as any).commitBundle.stagingCommand, ['git', 'add', '-A', '-f', '--', scopedFile]);
  assert.equal(
    ((dryRun.evidence as any).commitBundle.stagingCommand as string[]).includes('--pathspec-from-file=-'),
    false,
    'ATM auto-stage must not use stdin pathspec staging'
  );
  assert.deepEqual((dryRun.evidence as any).commitBundle.stageFiles, [scopedFile]);
  assert.deepEqual((dryRun.evidence as any).commitBundle.commitFiles, [scopedFile]);
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
  assert.equal((autoStageCommit.evidence as any).branchCommitQueue?.serializedBy, 'branch-commit-queue');
  assert.equal((autoStageCommit.evidence as any).branchCommitQueue?.taskId, taskId);
  assert.equal((autoStageCommit.evidence as any).branchCommitQueue?.headShaAtCommitStart, (autoStageCommit.evidence as any).branchCommitQueue?.headShaAtAcquire);
  assertBranchCommitQueueSchema((autoStageCommit.evidence as any).branchCommitQueue, 'auto-stage commit branch queue evidence');
  assert.ok(String((autoStageCommit.evidence as any).copyableCommitCommand).includes('ATM-Task'));
  rmSync(path.join(tempDir, outsideFile), { force: true });

  // ATM-BUG-2026-07-13-177: framework temp-claim commits must not absorb ordinary-unowned staged files.
  const frameworkClaimedFile = 'docs/framework-claimed.md';
  const frameworkForeignStagedFile = 'packages/cli/src/commands/tasks/__tests__/import-orchestrator.spec.ts';
  writeJson(path.join(tempDir, '.atm/runtime/locks/ATM-FRAMEWORK-TEMP-fixture-agent.lock.json'), {
    schemaId: 'atm.governanceScopeLock',
    specVersion: '0.1.0',
    workItemId: 'ATM-FRAMEWORK-TEMP-fixture-agent',
    lockedBy: 'fixture-agent',
    actorId: 'fixture-agent',
    leaseId: 'lease-framework-fixture',
    lockedAt: '2026-07-13T00:00:00.000Z',
    heartbeatAt: '2026-07-13T00:00:00.000Z',
    ttlSeconds: 999999999,
    status: 'active',
    files: [frameworkClaimedFile]
  });
  mkdirSync(path.join(tempDir, path.dirname(frameworkClaimedFile)), { recursive: true });
  mkdirSync(path.join(tempDir, path.dirname(frameworkForeignStagedFile)), { recursive: true });
  writeFileSync(path.join(tempDir, frameworkClaimedFile), '# framework claim\n', 'utf8');
  writeFileSync(path.join(tempDir, frameworkForeignStagedFile), 'export const frameworkForeignStaged = true;\n', 'utf8');
  runGit(tempDir, ['add', frameworkClaimedFile, frameworkForeignStagedFile]);
  const frameworkAmbiguous = expectCliError(
    runAtmGit([
      'commit',
      '--cwd', tempDir,
      '--actor', 'fixture-agent',
      '--message', 'docs: framework claim without defer',
      '--auto-stage',
      '--json'
    ]),
    'ATM_GIT_COMMIT_FRAMEWORK_STAGING_AMBIGUOUS'
  );
  const frameworkAmbiguousDetails = (await frameworkAmbiguous).details ?? {};
  assert.ok(String(frameworkAmbiguousDetails.requiredCommand).includes('--defer-foreign-staged'));
  assert.ok(
    Array.isArray(frameworkAmbiguousDetails.outOfScopeStagedFiles)
    && frameworkAmbiguousDetails.outOfScopeStagedFiles.includes(frameworkForeignStagedFile)
  );
  const frameworkCommit = await runAtmGit([
    'commit',
    '--cwd', tempDir,
    '--actor', 'fixture-agent',
    '--message', 'docs: framework scoped claim',
    '--auto-stage',
    '--defer-foreign-staged',
    '--json'
  ]);
  assert.equal(frameworkCommit.ok, true);
  const frameworkClaimHead = runGit(tempDir, ['show', '--name-only', '--format=', 'HEAD']);
  assert.equal(frameworkClaimHead.includes(frameworkClaimedFile), true, 'framework claim file must be included');
  assert.equal(frameworkClaimHead.includes(frameworkForeignStagedFile), false, 'framework claim commits must exclude ordinary out-of-claim staged files');
  assert.equal(runGit(tempDir, ['diff', '--cached', '--name-only']).includes(frameworkForeignStagedFile), true, 'framework claim commits must leave out-of-claim staged files staged for their owner');
  runGit(tempDir, ['restore', '--staged', '--', frameworkForeignStagedFile]);
  rmSync(path.join(tempDir, frameworkForeignStagedFile), { force: true });
  rmSync(path.join(tempDir, '.atm/runtime/locks/ATM-FRAMEWORK-TEMP-fixture-agent.lock.json'), { force: true });

  // ATM-BUG-2026-07-14-182: unstaged out-of-claim release mirrors must not be absorbed.
  const narrowSkillClaimFile = '.cursor/rules/skills/atm-governance-router/SKILL.md';
  const unstagedReleaseMirror = 'release/atm-root-drop/packages/cli/src/commands/git-governance.ts';
  writeJson(path.join(tempDir, '.atm/runtime/locks/ATM-FRAMEWORK-TEMP-fixture-agent.lock.json'), {
    schemaId: 'atm.governanceScopeLock',
    specVersion: '0.1.0',
    workItemId: 'ATM-FRAMEWORK-TEMP-fixture-agent',
    lockedBy: 'fixture-agent',
    actorId: 'fixture-agent',
    leaseId: 'lease-framework-release-mirror',
    lockedAt: '2026-07-14T00:00:00.000Z',
    heartbeatAt: '2026-07-14T00:00:00.000Z',
    ttlSeconds: 999999999,
    status: 'active',
    files: [narrowSkillClaimFile]
  });
  mkdirSync(path.join(tempDir, path.dirname(narrowSkillClaimFile)), { recursive: true });
  mkdirSync(path.join(tempDir, path.dirname(unstagedReleaseMirror)), { recursive: true });
  writeFileSync(path.join(tempDir, narrowSkillClaimFile), '# narrow skill claim\n', 'utf8');
  writeFileSync(path.join(tempDir, unstagedReleaseMirror), 'export const foreignReleaseMirror = true;\n', 'utf8');
  runGit(tempDir, ['add', unstagedReleaseMirror]);
  runGit(tempDir, ['commit', '-m', 'chore: seed tracked release mirror fixture']);
  writeFileSync(path.join(tempDir, unstagedReleaseMirror), 'export const foreignReleaseMirror = "dirty";\n', 'utf8');
  const releaseMirrorCommit = await runAtmGit([
    'commit',
    '--cwd', tempDir,
    '--actor', 'fixture-agent',
    '--message', 'docs: narrow skill claim without release mirror absorption',
    '--auto-stage',
    '--defer-foreign-staged',
    '--json'
  ]);
  assert.equal(releaseMirrorCommit.ok, true);
  const releaseMirrorHead = runGit(tempDir, ['show', '--name-only', '--format=', 'HEAD']);
  assert.equal(releaseMirrorHead.includes(narrowSkillClaimFile), true, 'claimed skill mirror must be included');
  assert.equal(releaseMirrorHead.includes(unstagedReleaseMirror), false, 'unstaged out-of-claim release mirror must stay out of framework claim commit');
  assert.equal(runGit(tempDir, ['diff', '--name-only', '--', unstagedReleaseMirror]).trim().length > 0, true, 'unstaged release mirror dirt must remain in the worktree');
  runGit(tempDir, ['restore', '--worktree', '--', unstagedReleaseMirror]);
  rmSync(path.join(tempDir, '.atm/runtime/locks/ATM-FRAMEWORK-TEMP-fixture-agent.lock.json'), { force: true });

  writeFileSync(path.join(tempDir, scopedFile), 'export const taskScopedStaging = "queue";\n', 'utf8');
  const branchRef = runGit(tempDir, ['symbolic-ref', '-q', 'HEAD']).trim();
  const branchQueueLockPath = path.join(tempDir, '.atm/runtime/locks', `git-commit-queue-${branchRef.replace(/[^A-Za-z0-9._-]+/g, '-')}.lock`);
  mkdirSync(branchQueueLockPath, { recursive: true });
  const busyLockRecord = {
    schemaId: 'atm.branchCommitQueueLock.v1',
    specVersion: '0.1.0',
    actorId: 'other-agent',
    taskId,
    branchRef,
    branchName: branchRef.replace(/^refs\/heads\//, ''),
    headShaAtAcquire: runGit(tempDir, ['rev-parse', '--verify', 'HEAD']).trim(),
    createdAt: '2026-06-18T00:00:00.000Z'
  };
  assertBranchCommitQueueSchema(busyLockRecord, 'busy branch queue lock record');
  writeJson(path.join(branchQueueLockPath, 'record.json'), busyLockRecord);
  const queueBusy = expectCliError(
    runAtmGit([
      'commit',
      '--cwd', tempDir,
      '--actor', 'fixture-agent',
      '--task', taskId,
      '--session', sessionId,
      '--message', 'feat: branch queue busy',
      '--auto-stage',
      '--json'
    ]),
    'ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY'
  );
  const queueBusyDetails = (await queueBusy).details ?? {};
  assert.equal(queueBusyDetails.retryable, true);
  assert.ok(String(queueBusyDetails.lockPath).includes('git-commit-queue-refs-heads-'));
  rmSync(branchQueueLockPath, { recursive: true, force: true });

  writeFileSync(path.join(tempDir, scopedFile), 'export const taskScopedStaging = "again";\n', 'utf8');
  const foreignEvidence = `.atm/history/evidence/${foreignTaskId}.json`;
  writeJson(path.join(tempDir, foreignEvidence), { taskId: foreignTaskId, evidence: [] });
  runGit(tempDir, ['add', foreignEvidence]);
  const foreignIsolatedCommit = await runAtmGit([
    'commit',
    '--cwd', tempDir,
    '--actor', 'fixture-agent',
    '--task', taskId,
    '--session', sessionId,
    '--message', 'feat: foreign staged bundle',
    '--auto-stage',
    '--json'
  ]);
  assert.equal(foreignIsolatedCommit.ok, true);
  assert.equal(runGit(tempDir, ['show', '--stat', '--oneline', 'HEAD']).includes(foreignEvidence), false);
  assert.equal(runGit(tempDir, ['diff', '--cached', '--name-only']).includes(foreignEvidence), true);
  runGit(tempDir, ['restore', '--staged', '--', foreignEvidence]);

  writeFileSync(path.join(tempDir, scopedFile), 'export const taskScopedStaging = "ordinary-unowned-staged";\n', 'utf8');
  const ordinaryUnownedStagedFile = 'packages/cli/src/commands/tasks/__tests__/import-orchestrator.spec.ts';
  mkdirSync(path.join(tempDir, path.dirname(ordinaryUnownedStagedFile)), { recursive: true });
  writeFileSync(path.join(tempDir, ordinaryUnownedStagedFile), 'export const unrelatedStagedResidue = true;\n', 'utf8');
  runGit(tempDir, ['add', ordinaryUnownedStagedFile]);
  const ordinaryUnownedCommit = await runAtmGit([
    'commit',
    '--cwd', tempDir,
    '--actor', 'fixture-agent',
    '--task', taskId,
    '--session', sessionId,
    '--message', 'feat: exclude ordinary unowned staged residue',
    '--auto-stage',
    '--defer-foreign-staged',
    '--json'
  ]);
  assert.equal(ordinaryUnownedCommit.ok, true);
  const ordinaryUnownedHead = runGit(tempDir, ['show', '--name-only', '--format=', 'HEAD']);
  assert.equal(ordinaryUnownedHead.includes(ordinaryUnownedStagedFile), false, 'ordinary-unowned staged files must stay out of scoped commits even with --defer-foreign-staged');
  assert.equal(runGit(tempDir, ['diff', '--cached', '--name-only']).includes(ordinaryUnownedStagedFile), true, 'ordinary-unowned staged files must remain staged for the original owner after scoped commit');
  runGit(tempDir, ['restore', '--staged', '--', ordinaryUnownedStagedFile]);
  rmSync(path.join(tempDir, ordinaryUnownedStagedFile), { force: true });

  writeFileSync(path.join(tempDir, scopedFile), 'export const taskScopedStaging = "defer";\n', 'utf8');
  runGit(tempDir, ['add', scopedFile]);
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
  assert.equal(bundle.deferredForeignStagedSnapshot, null, 'foreign staged evidence that is already excluded from the scoped commit does not require a deferral snapshot');
  assert.deepEqual(bundle.commitFiles, [scopedFile]);
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
  if (bundle.deferredForeignStagedSnapshot) {
    assert.equal(existsSync(path.join(tempDir, bundle.deferredForeignStagedSnapshot)), false, 'git commit must auto-clean deferred foreign staged snapshots after use');
  }

  writeFileSync(path.join(tempDir, scopedFile), 'export const taskScopedStaging = "defer-governance";\n', 'utf8');
  const foreignBundleManifest = `.atm/history/evidence/${foreignTaskId}.bundle-manifest.json`;
  const foreignClosurePacket = `.atm/history/evidence/${foreignTaskId}.closure-packet.json`;
  const foreignTaskEvent = `.atm/history/task-events/${foreignTaskId}/2026-06-29T08-35-06-977Z-close-fixture.json`;
  writeJson(path.join(tempDir, foreignBundleManifest), { taskId: foreignTaskId, taskEventPaths: [foreignTaskEvent] });
  runGit(tempDir, ['add', foreignBundleManifest]);
  const deferredGovernanceBundle = resolveTaskScopedCommitBundle({
    cwd: tempDir,
    taskId,
    taskDocument,
    apply: false,
    autoStage: false,
    deferForeignStaged: true,
    message: 'feat: defer foreign governance staged',
    actorId: 'fixture-agent',
    trailers: [`ATM-Actor: fixture-agent`, `ATM-Task: ${taskId}`]
  });
  assert.equal(deferredGovernanceBundle.ok, true, 'dry-run must tolerate deferrable foreign bundle-manifest residue');
  assert.equal(deferredGovernanceBundle.deferredForeignStagedSnapshot, null, 'dry-run must not mutate the index or create a deferred snapshot');
  const deferredGovernanceCommit = await runAtmGit([
    'commit',
    '--cwd', tempDir,
    '--actor', 'fixture-agent',
    '--task', taskId,
    '--session', sessionId,
    '--message', 'feat: defer foreign governance staged',
    '--auto-stage',
    '--defer-foreign-staged',
    '--json'
  ]);
  assert.equal(deferredGovernanceCommit.ok, true, 'deferred foreign governance residue must not re-block apply-mode commit');
  const deferredGovernanceHead = runGit(tempDir, ['show', '--name-only', '--format=', 'HEAD']);
  assert.equal(deferredGovernanceHead.includes(foreignBundleManifest), false, 'foreign governance bundle must stay out of the current commit');
  assert.equal(deferredGovernanceHead.includes(foreignClosurePacket), false, 'foreign closure packet must stay out of the current commit');
  assert.equal(deferredGovernanceHead.includes(foreignTaskEvent), false, 'foreign close event must stay out of the current commit');
  assert.equal(existsSync(path.join(tempDir, foreignBundleManifest)), true, 'deferred foreign governance files must remain available for the owning task');
  rmSync(path.join(tempDir, foreignBundleManifest), { force: true });
  rmSync(path.join(tempDir, foreignClosurePacket), { force: true });
  rmSync(path.join(tempDir, foreignTaskEvent), { force: true });

  writeFileSync(path.join(tempDir, scopedFile), 'export const taskScopedStaging = "defer-governance-dirty";\n', 'utf8');
  writeJson(path.join(tempDir, foreignBundleManifest), { taskId: foreignTaskId, taskEventPaths: [foreignTaskEvent] });
  writeJson(path.join(tempDir, foreignClosurePacket), { taskId: foreignTaskId });
  writeJson(path.join(tempDir, foreignTaskEvent), { taskId: foreignTaskId, action: 'close' });
  const deferredDirtyGovernanceBundle = resolveTaskScopedCommitBundle({
    cwd: tempDir,
    taskId,
    taskDocument,
    apply: false,
    autoStage: false,
    deferForeignStaged: true,
    message: 'feat: defer foreign governance dirty',
    actorId: 'fixture-agent',
    trailers: [`ATM-Actor: fixture-agent`, `ATM-Task: ${taskId}`]
  });
  assert.equal(deferredDirtyGovernanceBundle.ok, true, 'dry-run must tolerate deferrable dirty foreign governance residue');
  assert.equal(deferredDirtyGovernanceBundle.blockedCode, null, 'deferrable dirty foreign governance residue must not block');
  assert.ok(
    deferredDirtyGovernanceBundle.governanceBundleWarnings.some((entry) => entry.includes('Deferred foreign generated governance residue')),
    'deferrable dirty foreign governance residue must leave an explicit warning'
  );
  rmSync(path.join(tempDir, foreignBundleManifest), { force: true });
  rmSync(path.join(tempDir, foreignClosurePacket), { force: true });
  rmSync(path.join(tempDir, foreignTaskEvent), { force: true });

  writeFileSync(path.join(tempDir, scopedFile), 'export const taskScopedStaging = "residue-safe";\n', 'utf8');
  const gitHeadResiduePath = path.join(tempDir, '.atm/history/evidence/git-head.jsonl');
  writeFileSync(gitHeadResiduePath, '{"fixture":true}\n', 'utf8');
  const safeResidueCommit = await runAtmGit([
    'commit',
    '--cwd', tempDir,
    '--actor', 'fixture-agent',
    '--task', taskId,
    '--session', sessionId,
    '--message', 'feat: auto clean safe residue',
    '--auto-stage',
    '--json'
  ]);
  assert.equal(safeResidueCommit.ok, true);
  assert.equal(readFileSync(gitHeadResiduePath, 'utf8').includes('{"fixture":true}'), false, 'safe generated git-head residue must be replaced before commit completes');

  writeFileSync(path.join(tempDir, scopedFile), 'export const taskScopedStaging = "residue-blocked";\n', 'utf8');
  const foreignResiduePath = path.join(tempDir, '.atm/runtime/snapshots/foreign-staged-TASK-OTHER-9999-1781880000000.json');
  writeJson(foreignResiduePath, { taskId: 'TASK-OTHER-9999', files: ['src/other.ts'] });
  const foreignResidueCommit = await runAtmGit([
    'commit',
    '--cwd', tempDir,
    '--actor', 'fixture-agent',
    '--task', taskId,
    '--session', sessionId,
    '--message', 'feat: auto clean foreign residue snapshot',
    '--auto-stage',
    '--json'
  ]);
  assert.equal(foreignResidueCommit.ok, true);
  assert.equal(existsSync(foreignResiduePath), false, 'machine-generated foreign staged snapshots must be auto-cleaned');

  const userResiduePath = path.join(tempDir, 'notes/manual-user-dirty.txt');
  writeFileSync(userResiduePath, 'keep me\n', 'utf8');
  writeFileSync(path.join(tempDir, scopedFile), 'export const taskScopedStaging = "user-dirty";\n', 'utf8');
  const userDirtyCommit = await runAtmGit([
    'commit',
    '--cwd', tempDir,
    '--actor', 'fixture-agent',
    '--task', taskId,
    '--session', sessionId,
    '--message', 'feat: preserve user dirty file',
    '--auto-stage',
    '--json'
  ]);
  assert.equal(userDirtyCommit.ok, true);
  assert.equal(existsSync(userResiduePath), true, 'user-authored dirty files must never be auto-cleaned');
  rmSync(userResiduePath, { force: true });

  writeFileSync(path.join(tempDir, scopedFile), 'export const taskScopedStaging = "runtime-noise";\n', 'utf8');
  const runtimeSnapshotPath = path.join(tempDir, '.atm/runtime/snapshots/close-window-foreign-staged-TASK-OTHER-9999-1781880000001.json');
  writeJson(runtimeSnapshotPath, { taskId: 'TASK-OTHER-9999', files: ['src/other.ts'] });
  const teamRunPath = path.join(tempDir, '.atm/runtime/team-runs/team-foreign.json');
  writeJson(teamRunPath, { taskId: 'TASK-OTHER-9999', teamRunId: 'team-foreign', status: 'active' });
  const transientScratchPath = path.join(tempDir, '.atm/_close-runtime-noise.json');
  writeJson(transientScratchPath, { fixture: true });
  const runtimeNoiseCommit = await runAtmGit([
    'commit',
    '--cwd', tempDir,
    '--actor', 'fixture-agent',
    '--task', taskId,
    '--session', sessionId,
    '--message', 'feat: ignore runtime residue',
    '--auto-stage',
    '--json'
  ]);
  assert.equal(runtimeNoiseCommit.ok, true);
  assert.equal(runGit(tempDir, ['show', '--name-only', '--format=', 'HEAD']).includes('.atm/runtime/snapshots/close-window-foreign-staged-TASK-OTHER-9999-1781880000001.json'), false, 'runtime snapshots outside the task bundle must not be committed');
  assert.equal(existsSync(teamRunPath), true, 'foreign team-run runtime records must not block the current task commit');
  assert.equal(existsSync(transientScratchPath), true, 'atm scratch json residue should be ignored by task-scoped commit gating');
  assert.equal(runGit(tempDir, ['show', '--stat', '--oneline', 'HEAD']).includes(scopedFile), true);

  writeFileSync(path.join(tempDir, scopedFile), 'export const taskScopedStaging = "isolated";\n', 'utf8');
  const unrelatedStagedFile = 'src/unrelated.ts';
  writeFileSync(path.join(tempDir, unrelatedStagedFile), 'export const unrelated = true;\n', 'utf8');
  runGit(tempDir, ['add', unrelatedStagedFile]);
  const isolatedCommit = await runAtmGit([
    'commit',
    '--cwd', tempDir,
    '--actor', 'fixture-agent',
    '--task', taskId,
    '--session', sessionId,
    '--message', 'feat: isolated task bundle commit',
    '--auto-stage',
    '--json'
  ]);
  assert.equal(isolatedCommit.ok, true);
  assert.equal(runGit(tempDir, ['show', '--stat', '--oneline', 'HEAD']).includes(scopedFile), true);
  assert.equal(runGit(tempDir, ['show', '--stat', '--oneline', 'HEAD']).includes(unrelatedStagedFile), false);
  assert.equal(runGit(tempDir, ['diff', '--cached', '--name-only']).includes(unrelatedStagedFile), true);

  runGit(tempDir, ['restore', '--staged', '--', unrelatedStagedFile]);
  const foreignActiveFile = 'src/foreign-active.ts';
  mkdirSync(path.join(tempDir, path.dirname(foreignActiveFile)), { recursive: true });
  writeFileSync(path.join(tempDir, foreignActiveFile), 'export const foreignActive = true;\n', 'utf8');
  writeJson(path.join(tempDir, `.atm/history/tasks/${foreignActiveTaskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: foreignActiveTaskId,
    status: 'running',
    claim: {
      actorId: 'other-agent',
      leaseId: 'lease-foreign-active',
      state: 'active',
      files: [foreignActiveFile]
    }
  });
  writeJson(path.join(tempDir, `.atm/runtime/locks/${foreignActiveTaskId}.lock.json`), {
    schemaId: 'atm.governanceScopeLock',
    specVersion: '0.1.0',
    workItemId: foreignActiveTaskId,
    lockedBy: 'other-agent',
    actorId: 'other-agent',
    leaseId: 'lease-foreign-active',
    lockedAt: '2026-06-18T00:00:00.000Z',
    heartbeatAt: '2026-06-18T00:00:00.000Z',
    ttlSeconds: 999999999,
    status: 'active',
    files: [foreignActiveFile],
    taskDirectionLock: {
      schemaId: 'atm.taskDirectionLock.v1',
      specVersion: '0.1.0',
      taskId: foreignActiveTaskId,
      batchId: null,
      scopeKey: null,
      queueId: null,
      queueIndex: null,
      allowedFiles: [foreignActiveFile],
      planningReadOnlyPaths: [],
      planningMirrorPaths: [],
      allowPlanningMirror: false,
      promptHash: null,
      actorId: 'other-agent',
      createdAt: '2026-06-18T00:00:00.000Z',
      status: 'active'
    }
  });
  runGit(tempDir, ['add', foreignActiveFile]);
  const ownership = inspectGitIndexOwnership({ cwd: tempDir, taskId, stagedFiles: [foreignActiveFile] });
  assert.equal(ownership.indexLane.status, 'blocked-foreign-active-staged');
  assert.equal(ownership.foreignActiveStaged[0]?.ownerTaskId, foreignActiveTaskId);
  assert.equal(ownership.foreignActiveStaged[0]?.ownerActorId, 'other-agent');
  const foreignActiveBundle = resolveTaskScopedCommitBundle({
    cwd: tempDir,
    taskId,
    taskDocument,
    apply: false,
    autoStage: false,
    deferForeignStaged: true,
    message: 'feat: refuse foreign active defer',
    actorId: 'fixture-agent',
    trailers: []
  });
  assert.equal(foreignActiveBundle.ok, false);
  assert.equal(foreignActiveBundle.blockedCode, 'ATM_INDEX_FOREIGN_ACTIVE_STAGED');
  assert.equal(foreignActiveBundle.gitIndexOwnership.indexLane.status, 'blocked-foreign-active-staged');
  const stageOverrideLease = await runAtmGit([
    'lease',
    'stage-override',
    '--cwd', tempDir,
    '--actor', 'fixture-agent',
    '--task', taskId,
    '--paths', foreignActiveFile,
    '--reason', 'Human approved fixture-only staged index lease.',
    '--json'
  ]) as any;
  assert.equal(stageOverrideLease.ok, true);
  assert.equal(stageOverrideLease.evidence.lease.chatTextAccepted, false);
  assert.equal(stageOverrideLease.evidence.lease.kind, 'stage-override');
  assert.equal(existsSync(path.join(tempDir, stageOverrideLease.evidence.leasePath)), true);

  console.log('[git-commit-task-scoped-staging] ok');
} finally {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
