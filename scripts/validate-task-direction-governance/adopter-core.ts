import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import {
  assert,
  assertGovernanceLockAllowedFilesAreSsot,
  buildTaskSelfAllowPaths,
  fail,
  fixtureStep,
  initializeGit,
  makeAdopterRepo,
  readActiveTaskDirectionLocks,
  runBatch,
  runGit,
  runHook,
  runIntegrationHookInvocationInProcess,
  runLock,
  runNext,
  runTasks,
  writeEvidence,
  writeJson,
  writeLedgerTask
} from './context.ts';

/**
 * TASK-AAO-0062 regression:
 * tasks claim ?Ｗ??lock 蝝????embed taskDirectionLock嚗?
 * 雿踹? tasks close ?臭誑?? direction lock 瑼Ｘ??
 */
export async function validateTasksClaimDirectionLockConsistency(tempRoot: string) {
  const repo = makeAdopterRepo(tempRoot, 'adopter-tasks-claim-consistency');
  initializeGit(repo);
  const claim = await runTasks(['claim', '--cwd', repo, '--task', 'TASK-ADOPT-0001', '--actor', 'adopter-agent', '--files', 'src/one.ts', '--json']);
  assert(claim.ok === true, 'tasks claim consistency: tasks claim must succeed');

  const lockPath = path.join(repo, '.atm', 'runtime', 'locks', 'TASK-ADOPT-0001.lock.json');
  assert(existsSync(lockPath), 'tasks claim consistency: locks file must exist after tasks claim');
  const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
  assert(parsed.taskDirectionLock !== undefined, 'tasks claim consistency: locks file must embed taskDirectionLock');

  // 靽格撖西釭 deliverable 隞仿? close ?? deliverable ?瑼?
  writeFileSync(path.join(repo, 'src', 'one.ts'), 'export const one = 99;\n', 'utf8');

  const close = await runTasks(['close', '--cwd', repo, '--task', 'TASK-ADOPT-0001', '--actor', 'adopter-agent', '--status', 'done', '--json']);
  assert(close.ok === true, `tasks claim consistency: tasks close must succeed. Got: ${JSON.stringify(close.messages)}`);
}

/** ?曉祝頝臬???
 */
export async function validateTaskSelfAllowOnClaim(tempRoot: string) {
  const repo = makeAdopterRepo(tempRoot, 'adopter-self-allow');
  initializeGit(repo);
  const prompt = 'TASK-ADOPT-0001';
  const claim = await runNext(['--cwd', repo, '--claim', '--actor', 'adopter-agent', '--prompt', prompt]);
  assert(claim.ok === true, 'self-allow regression: next --claim must succeed');
  assertGovernanceLockAllowedFilesAreSsot(repo, 'TASK-ADOPT-0001');

  // 1. 霈??canonical allowedFiles
  const lockPath = path.join(repo, '.atm', 'runtime', 'locks', 'TASK-ADOPT-0001.lock.json');
  assert(existsSync(lockPath), 'self-allow regression: governance lock must exist after claim');
  const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
  const embedded = (parsed as { taskDirectionLock?: { allowedFiles?: unknown } }).taskDirectionLock;
  const allowedFiles = Array.isArray(embedded?.allowedFiles)
    ? (embedded!.allowedFiles as string[]).map((entry) => entry.replace(/\\/g, '/'))
    : null;
  assert(allowedFiles !== null, 'self-allow regression: taskDirectionLock.allowedFiles must be an array');

  // 2. 銝? canonical governance 頝臬?敹?摮
  const selfAllow = buildTaskSelfAllowPaths('TASK-ADOPT-0001');
  for (const govPath of selfAllow) {
    assert(
      allowedFiles.some((entry) => entry === govPath || entry.replace(/\\/g, '/') === govPath),
      `self-allow regression: allowedFiles must contain canonical governance path "${govPath}" after claim. Got: ${JSON.stringify(allowedFiles)}`
    );
  }

  // 3. 銝?閮望??.atm/history/** 雿?曉祝頝臬?
  assert(
    !allowedFiles.some((entry) => entry === '.atm/history/**' || entry === '.atm/history'),
    `self-allow regression: allowedFiles must NOT contain broadened ".atm/history/**" or ".atm/history". Got: ${JSON.stringify(allowedFiles)}`
  );
}

export async function validateAaoThroughputAgentJourney(tempRoot: string) {
  const repo = makeAdopterRepo(tempRoot, 'adopter-aao-throughput-journey');
  initializeGit(repo);
  const prompt = 'TASK-ADOPT-0001 TASK-ADOPT-0002 all task cards';
  const claim = await runNext(['--cwd', repo, '--claim', '--actor', 'adopter-agent', '--prompt', prompt]);
  assert(claim.ok === true, 'AAO throughput journey must claim the first queue head');
  assertGovernanceLockAllowedFilesAreSsot(repo, 'TASK-ADOPT-0001');
  const batchId = (claim.evidence.batchRun as any)?.batchId;
  assert(typeof batchId === 'string' && batchId.length > 0, 'AAO throughput journey must create a batchId');

  const compactBeforeWork = await runBatch(['current', '--cwd', repo, '--batch', batchId, '--compact', '--json']);
  const currentBeforeWork = compactBeforeWork.evidence.current as any;
  assert(currentBeforeWork?.schemaId === 'atm.batchCurrent.v1', 'AAO throughput journey must expose compact batch current schema');
  assert(currentBeforeWork.currentTaskId === 'TASK-ADOPT-0001', 'compact current must show the queue head before work');
  assert(Array.isArray(currentBeforeWork.allowedFiles) && currentBeforeWork.allowedFiles.includes('src/one.ts'), 'compact current must include queue-head allowedFiles');
  assert((compactBeforeWork.evidence as any).batchRun === undefined, 'compact current must omit full batchRun payload');
  assert((compactBeforeWork.evidence as any).taskQueue === undefined, 'compact current must omit full taskQueue payload');

  const preWriteDrift = runIntegrationHookInvocationInProcess([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'src/two.ts'
  ]);
  assert(preWriteDrift.ok === false, 'AAO throughput journey must block a pre-write edit outside queue-head deliverables');
  assert(preWriteDrift.messages.some((entry) => entry.code === 'ATM_TOOL_SCOPE_DRIFT_BLOCKED'), 'pre-write drift must return the dedicated scope blocker');

  writeFileSync(path.join(repo, 'src', 'one.ts'), 'export const one = 47;\n', 'utf8');
  const checkpoint = await runBatch(['checkpoint', '--cwd', repo, '--actor', 'adopter-agent', '--batch', batchId, '--hold', '--json']);
  assert(checkpoint.ok === true, 'AAO throughput journey checkpoint --hold must close the delivered queue head');
  assert((checkpoint.evidence as any).held === true, 'AAO throughput journey must hold before claiming the next task');
  assert((checkpoint.evidence as any).nextClaim === null, 'checkpoint --hold must not auto-claim the next task');
  assert(!readActiveTaskDirectionLocks(repo).some((lock) => lock.taskId === 'TASK-ADOPT-0002'), 'checkpoint --hold must leave the next task unclaimed until resume');

  const compactAfterCheckpoint = await runBatch(['current', '--cwd', repo, '--batch', batchId, '--compact', '--json']);
  const currentAfterCheckpoint = compactAfterCheckpoint.evidence.current as any;
  assert(currentAfterCheckpoint.held === true, 'compact current must show held state after checkpoint --hold');
  assert(currentAfterCheckpoint.commitInstruction?.timing === 'after-checkpoint', 'held status must expose after-checkpoint commit instruction. Got: ' + JSON.stringify(currentAfterCheckpoint));
  assert((currentAfterCheckpoint.commitInstruction?.files ?? []).some((entry: string) => entry.includes('TASK-ADOPT-0001')), 'commit instruction must reference the just-checkpointed task governance files');
  assert(String(currentAfterCheckpoint.commands?.resume ?? '').includes(`--batch ${batchId}`), 'compact current must provide a batch-specific resume command');

  runGit(repo, ['add',
    'src/one.ts',
    '.atm/history/tasks/TASK-ADOPT-0001.json',
    '.atm/history/evidence/TASK-ADOPT-0001.json',
    '.atm/history/task-events/TASK-ADOPT-0001'
  ]);
  // 璅⊥ `node atm.mjs git commit` 閮剖???attribution env vars嚗?
  // pre-commit hook ?菜葫??staged task 瑼???閬?????瘙?ATM wrapper
  process.env.ATM_COMMIT_ACTOR_ID = 'adopter-agent';
  process.env.ATM_COMMIT_TASK_ID = 'TASK-ADOPT-0001';
  process.env.GIT_AUTHOR_NAME = 'ATM Test';
  process.env.GIT_AUTHOR_EMAIL = 'atm-test@example.invalid';
  let preCommit: ReturnType<typeof runHook>;
  try {
    preCommit = runHook(['pre-commit', '--cwd', repo]);
  } finally {
    delete process.env.ATM_COMMIT_ACTOR_ID;
    delete process.env.ATM_COMMIT_TASK_ID;
    delete process.env.GIT_AUTHOR_NAME;
    delete process.env.GIT_AUTHOR_EMAIL;
  }
  assert(preCommit.ok === true, `checkpoint commit window must pass after checkpoint --hold. Got: ${JSON.stringify((preCommit.evidence as any)?.blockingFindings ?? preCommit.messages ?? [])}`);
  const preCommitFindings = ((preCommit.evidence as any).blockingFindings ?? []) as Array<Record<string, any>>;
  assert(!preCommitFindings.some((entry) => entry.code === 'ATM_PROTECTED_STATE_BATCH_COMMIT_BEFORE_CHECKPOINT'), 'held checkpoint commit window must not expose ATM_PROTECTED_STATE_BATCH_COMMIT_BEFORE_CHECKPOINT');
  runGit(repo, ['reset', '--', '.']);
  runGit(repo, ['checkout', '--', '.']);

  const resume = await runBatch(['resume', '--cwd', repo, '--actor', 'adopter-agent', '--batch', batchId, '--json']);
  assert(resume.ok === true, 'AAO throughput journey must resume the held batch');
  assert(readActiveTaskDirectionLocks(repo).some((lock) => lock.taskId === 'TASK-ADOPT-0002'), 'batch resume must claim the next queue head after held checkpoint state');
}

export async function validateBatchCheckpointHold(tempRoot: string) {
  const repo = makeAdopterRepo(tempRoot, 'adopter-batch-hold');
  initializeGit(repo);
  const prompt = 'TASK-ADOPT-0001 TASK-ADOPT-0002 all task cards';
  const claim = await runNext(['--cwd', repo, '--claim', '--actor', 'adopter-agent', '--prompt', prompt]);
  assert(claim.ok === true, 'batch hold fixture must claim queue head');
  const batchId = (claim.evidence.batchRun as any)?.batchId;
  assert(typeof batchId === 'string' && batchId.length > 0, 'batch hold fixture must create a batchId');

  writeFileSync(path.join(repo, 'src', 'one.ts'), 'export const one = 3;\n', 'utf8');
  const checkpoint = await runBatch(['checkpoint', '--cwd', repo, '--actor', 'adopter-agent', '--batch', batchId, '--hold', '--json']);
  assert(checkpoint.ok === true, 'batch checkpoint --hold must close the current task');
  assert((checkpoint.evidence as any).held === true, 'batch checkpoint --hold evidence must mark the checkpoint as held');
  assert((checkpoint.evidence as any).nextClaim === null, 'batch checkpoint --hold must not auto-claim the next task');
  assert(!readActiveTaskDirectionLocks(repo).some((lock) => lock.taskId === 'TASK-ADOPT-0002'), 'batch checkpoint --hold must not create the next task direction lock');

  const status = await runBatch(['current', '--cwd', repo, '--batch', batchId, '--compact', '--json']);
  const current = status.evidence.current as any;
  assert(current.held === true, 'batch current --compact must expose the held state');
  assert(current.hold?.afterTaskId === 'TASK-ADOPT-0001', 'held state must record the task that was just checkpointed');
  assert(String(current.resumeCommand ?? '').includes('batch resume'), 'held status must include an exact batch resume command');
  assert(current.commitInstruction?.timing === 'after-checkpoint', 'held status must expose after-checkpoint commit instruction. Got: ' + JSON.stringify(current));

  const resume = await runBatch(['resume', '--cwd', repo, '--actor', 'adopter-agent', '--batch', batchId, '--json']);
  assert(resume.ok === true, 'batch resume must succeed after checkpoint --hold');
  assert((resume.evidence as any).after?.hold === null, 'batch resume must clear the held state');
  assert(readActiveTaskDirectionLocks(repo).some((lock) => lock.taskId === 'TASK-ADOPT-0002'), 'batch resume must claim the next queue head through next');
}

export async function validateAdopterGoverned(tempRoot: string) {
  const repo = makeAdopterRepo(tempRoot, 'adopter-governed');
  initializeGit(repo);
  const prompt = 'TASK-ADOPT-0001 TASK-ADOPT-0002 all task cards';

  fixtureStep('adopter-governed route');
  const route = await runNext(['--cwd', repo, '--prompt', prompt]);
  assert(route.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_QUEUE_READY'), 'adopter prompt must resolve to a scoped task queue');
  assert((route.evidence.taskQueue as any)?.schemaId === 'atm.taskQueuePreview.v1', 'adopter prompt route must stay read-only and only expose atm.taskQueuePreview.v1');
  assert((route.evidence.nextAction as any).queueHeadTaskId === 'TASK-ADOPT-0001', 'adopter queue head must be first task');

  const beforeClaim = runIntegrationHookInvocationInProcess([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'src/one.ts'
  ]);
  assert(beforeClaim.ok === false, 'adopter prompt-scoped edit must be blocked before claim');
  assert(beforeClaim.messages.some((entry) => entry.code === 'ATM_TASK_DIRECTION_LOCK_REQUIRED'), 'adopter pre-tool block must require a direction lock');

  fixtureStep('adopter-governed claim');
  const claim = await runNext(['--cwd', repo, '--claim', '--actor', 'adopter-agent', '--prompt', prompt]);
  assert(claim.ok === true, 'adopter next --claim must claim queue head');
  assert((claim.evidence.taskDirectionLock as any)?.taskId === 'TASK-ADOPT-0001', 'adopter claim must create direction lock for queue head');
  assertGovernanceLockAllowedFilesAreSsot(repo, 'TASK-ADOPT-0001');
  const adopterBatchId = (claim.evidence.batchRun as any)?.batchId;
  assert(typeof adopterBatchId === 'string' && adopterBatchId.length > 0, 'adopter claim must create a batchId for checkpoint status');

  const inScope = runIntegrationHookInvocationInProcess([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'src/one.ts'
  ]);
  assert(inScope.ok === true, 'adopter in-scope edit must pass after direction lock');
  const claimLaneSessionId = (claim.evidence.laneSession as any)?.laneSessionId;
  const previousLaneSessionId = process.env.ATM_LANE_SESSION_ID;
  if (typeof claimLaneSessionId === 'string' && claimLaneSessionId.length > 0) {
    process.env.ATM_LANE_SESSION_ID = claimLaneSessionId;
  }
  try {
    await runTasks(['release', '--cwd', repo, '--task', 'TASK-ADOPT-0001', '--actor', 'adopter-agent', '--reason', 'validator fixture re-claim regression', '--json']);
  } finally {
    if (previousLaneSessionId === undefined) {
      delete process.env.ATM_LANE_SESSION_ID;
    } else {
      process.env.ATM_LANE_SESSION_ID = previousLaneSessionId;
    }
  }
  const reclaimed = await runNext(['--cwd', repo, '--claim', '--actor', 'adopter-agent', '--prompt', prompt]);
  assert(reclaimed.ok === true, 'next --claim must re-claim a previously released governance lock');
  const reclaimedLocks = readActiveTaskDirectionLocks(repo);
  assert(reclaimedLocks.some((lock) => lock.taskId === 'TASK-ADOPT-0001'), 're-claimed released lock must be visible as an active direction lock');

  const outOfScope = runIntegrationHookInvocationInProcess([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'src/two.ts'
  ]);
  assert(outOfScope.ok === false, 'adopter queue must block edits to the next task before queue head closes');
  assert(outOfScope.messages.some((entry) => entry.code === 'ATM_TOOL_SCOPE_DRIFT_BLOCKED'), 'adopter out-of-scope edit must report scope drift');

  fixtureStep('adopter-cross-repo setup');
  const crossRepo = makeAdopterRepo(tempRoot, 'adopter-cross-repo');
  writeLedgerTask(crossRepo, 'TASK-CROSS-PLAN-0001', 'Cross planning mirror task', 'src/one.ts', {
    scopePaths: [
      'src/one.ts',
      'docs/ai_atomic_framework/atm-agent-first-operability/tasks/TASK-CROSS-PLAN-0001.task.md'
    ],
    sourcePlanPath: '../3KLife/docs/ai_atomic_framework/atm-agent-first-operability/ATM Agent-First ?舀?雿批???急.md'
  });
  writeEvidence(crossRepo, 'TASK-CROSS-PLAN-0001');
  initializeGit(crossRepo);
  fixtureStep('adopter-cross-repo claim');
  const crossClaim = await runNext(['--cwd', crossRepo, '--claim', '--actor', 'adopter-agent', '--prompt', 'TASK-CROSS-PLAN-0001']);
  assert(crossClaim.ok === true, 'cross planning fixture must claim successfully');
  const mirrorBlock = runIntegrationHookInvocationInProcess([
    'pre-tool',
    '--cwd', crossRepo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', 'TASK-CROSS-PLAN-0001',
    '--files', 'docs/ai_atomic_framework/atm-agent-first-operability/tasks/TASK-CROSS-PLAN-0001.task.md'
  ]);
  assert(mirrorBlock.ok === false, 'cross planning mirror edit must be blocked');
  assert(mirrorBlock.messages.some((entry) => entry.code === 'ATM_PLANNING_MIRROR_BLOCKED'), 'cross planning mirror edit must report the planning mirror blocker');
  initializeGit(crossRepo);
  mkdirSync(path.join(crossRepo, 'docs', 'ai_atomic_framework', 'atm-agent-first-operability', 'tasks'), { recursive: true });
  writeFileSync(path.join(crossRepo, 'docs', 'ai_atomic_framework', 'atm-agent-first-operability', 'tasks', 'TASK-CROSS-PLAN-0001.task.md'), '# mirror\n', 'utf8');
  runGit(crossRepo, ['add', 'docs/ai_atomic_framework/atm-agent-first-operability/tasks/TASK-CROSS-PLAN-0001.task.md']);
  const preCommitMirror = runHook(['pre-commit', '--cwd', crossRepo]);
  assert(preCommitMirror.ok === false, 'pre-commit must block staged planning mirror files');
  assert(((preCommitMirror.evidence as any).planningMirrorDriftFiles ?? []).includes('docs/ai_atomic_framework/atm-agent-first-operability/tasks/TASK-CROSS-PLAN-0001.task.md'), 'pre-commit evidence must report planning mirror drift files');

  const staticEvidenceBlock = runIntegrationHookInvocationInProcess([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'atomic_workbench/evidence/TASK-ADOPT-0001.json'
  ]);
  assert(staticEvidenceBlock.ok === false, 'adopter queue must block direct static evidence artifact edits');
  assert(staticEvidenceBlock.messages.some((entry) => entry.code === 'ATM_STATIC_EVIDENCE_IMPERSONATION_BLOCKED'), 'adopter static evidence edit must report impersonation block');

  const runtimeLockEditBlock = runIntegrationHookInvocationInProcess([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', '.atm/runtime/locks/TASK-ADOPT-0001.lock.json'
  ]);
  assert(runtimeLockEditBlock.ok === false, 'adopter queue must block manual runtime lock edits');
  assert(runtimeLockEditBlock.messages.some((entry) => entry.code === 'ATM_RUNTIME_LOCK_MANUAL_EDIT_BLOCKED'), 'manual runtime lock edits must report the dedicated blocker');

  fixtureStep('adopter-scope-expansion setup');
  const scopeExpansionRepo = makeAdopterRepo(tempRoot, 'adopter-scope-expansion');
  writeLedgerTask(scopeExpansionRepo, 'TASK-EXPAND-0005', 'Generated fixture exclusion boundaries', 'src/one.ts');
  writeEvidence(scopeExpansionRepo, 'TASK-EXPAND-0005');
  initializeGit(scopeExpansionRepo);
  mkdirSync(path.join(scopeExpansionRepo, 'atomic_workbench', 'atomization-coverage'), { recursive: true });
  writeFileSync(path.join(scopeExpansionRepo, 'atomic_workbench', 'atomization-coverage', 'exclusion-inventory.json'), '{}\n', 'utf8');
  // 敹???stage嚗??TASK-AAO-0011 銋? scope expansion guard ?芸? staged/modified-tracked 瑼?雿
  runGit(scopeExpansionRepo, ['add', 'atomic_workbench/atomization-coverage/exclusion-inventory.json']);
  let scopeExpansionBlocked = false;
  try {
    await runNext(['--cwd', scopeExpansionRepo, '--claim', '--actor', 'adopter-agent', '--prompt', 'TASK-EXPAND-0005']);
  } catch (error) {
    scopeExpansionBlocked = (error as { code?: string }).code === 'ATM_TASK_SCOPE_EXPANSION_REQUIRED';
  }
  assert(scopeExpansionBlocked, 'next --claim must require task scope expansion for deliverable-like pending files outside allowedFiles');

  try {
    await runTasks(['close', '--cwd', repo, '--task', 'TASK-ADOPT-0002', '--actor', 'adopter-agent', '--status', 'done']);
    fail('adopter queue must not allow closing the second task before queue head');
  } catch (error) {
    assert(
      (error as any).code === 'ATM_TASK_CLOSE_ACTIVE_CLAIM_REQUIRED'
      || (error as any).code === 'ATM_TASK_QUEUE_HEAD_REQUIRED'
      || (error as any).code === 'ATM_BATCH_CHECKPOINT_REQUIRED',
      'adopter queue must reject premature close'
    );
  }

  fixtureStep('adopter-governed checkpoint');
  writeFileSync(path.join(repo, 'src', 'one.ts'), 'export const one = 2;\n', 'utf8');
  await runBatch(['checkpoint', '--cwd', repo, '--actor', 'adopter-agent', '--batch', adopterBatchId, '--json']);
  const checkpointWindowStatus = await runBatch(['current', '--cwd', repo, '--batch', adopterBatchId, '--compact', '--json']);
  const checkpointCurrent = checkpointWindowStatus.evidence.current as any;
  assert(checkpointCurrent?.currentTaskId === 'TASK-ADOPT-0002', 'batch current --compact must advance to TASK-ADOPT-0002 after checkpoint. Got: ' + JSON.stringify(checkpointCurrent));
  assert(checkpointCurrent?.commitInstruction?.timing === 'after-checkpoint', 'batch current --compact must expose after-checkpoint commit instruction. Got: ' + JSON.stringify(checkpointCurrent));
  assert((checkpointCurrent?.commitInstruction?.files ?? []).some((entry: string) => entry.includes('TASK-ADOPT-0001')), 'post-checkpoint commit instruction must reference the pending commit task. Got: ' + JSON.stringify(checkpointCurrent));
  const afterFirstClose = await runNext(['--cwd', repo, '--prompt', prompt]);
  assert((afterFirstClose.evidence.nextAction as any).queueHeadTaskId === 'TASK-ADOPT-0002', 'adopter queue must advance to second task after closing first');
  runGit(repo, ['add',
    'src/one.ts',
    '.atm/history/tasks/TASK-ADOPT-0001.json',
    '.atm/history/evidence/TASK-ADOPT-0001.json',
    '.atm/history/task-events/TASK-ADOPT-0001'
  ]);
  let checkpointCommit: ReturnType<typeof runHook>;
  process.env.ATM_COMMIT_ACTOR_ID = 'adopter-agent';
  process.env.ATM_COMMIT_TASK_ID = 'TASK-ADOPT-0001';
  process.env.GIT_AUTHOR_NAME = 'ATM Test';
  process.env.GIT_AUTHOR_EMAIL = 'atm-test@example.invalid';
  try {
    checkpointCommit = runHook(['pre-commit', '--cwd', repo]);
  } finally {
    delete process.env.ATM_COMMIT_ACTOR_ID;
    delete process.env.ATM_COMMIT_TASK_ID;
    delete process.env.GIT_AUTHOR_NAME;
    delete process.env.GIT_AUTHOR_EMAIL;
  }
  assert(checkpointCommit.ok === true, `batch checkpoint commit must pass even after the direction lock advances to the next queue head. Got: ${JSON.stringify((checkpointCommit.evidence as any)?.blockingFindings ?? checkpointCommit.messages ?? [])}`);
  assert(((checkpointCommit.evidence as any).directionLockDriftFiles ?? []).length === 0, 'checkpointed task deliverables must not be reported as drift against the next task lock');

  fixtureStep('adopter-infra-sync setup');
  const syncRepo = makeAdopterRepo(tempRoot, 'adopter-infra-sync-with-lock');
  initializeGit(syncRepo);
  const syncPrompt = 'TASK-ADOPT-0001';
  const syncClaim = await runNext(['--cwd', syncRepo, '--claim', '--actor', 'adopter-agent', '--prompt', syncPrompt]);
  assert(syncClaim.ok === true, 'adopter sync fixture must acquire a direction lock');
  writeFileSync(path.join(syncRepo, 'atm.mjs'), '#!/usr/bin/env node\n', 'utf8');
  writeJson(path.join(syncRepo, '.atm', 'runtime', 'pinned-runner.json'), {
    schemaVersion: 'atm.pinnedRunner.v0.1',
    runnerPath: 'atm.mjs',
    sourcePath: 'C:/Users/User/AI-Atomic-Framework/release/atm-onefile/atm.mjs'
  });
  runGit(syncRepo, ['add', 'atm.mjs', '.atm/runtime/pinned-runner.json']);
  const preCommitSync = runHook(['pre-commit', '--cwd', syncRepo]);
  assert(preCommitSync.ok === true, 'adopter infrastructure sync must pass pre-commit even with an active task direction lock');
  assert((preCommitSync.evidence as any).allowAdopterInfrastructureSync === true, 'adopter infrastructure sync must be reported in pre-commit evidence');
  assert(((preCommitSync.evidence as any).directionLockDriftFiles ?? []).length === 0, 'adopter infrastructure sync must not be reported as task direction drift');
}










