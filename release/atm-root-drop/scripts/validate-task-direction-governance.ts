import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { runBatch } from '../packages/cli/src/commands/batch.ts';
import { runFrameworkTempClaim } from '../packages/cli/src/commands/framework-development.ts';
import { runHook } from '../packages/cli/src/commands/hook.ts';
import { runIntegrationHookInvocation } from '../packages/cli/src/commands/integration-hooks.ts';
import { runLock } from '../packages/cli/src/commands/lock.ts';
import { runNext } from '../packages/cli/src/commands/next.ts';
import { buildTaskSelfAllowPaths, readActiveTaskDirectionLocks } from '../packages/cli/src/commands/task-direction.ts';
import { runTasks } from '../packages/cli/src/commands/tasks.ts';

const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(message: string): never {
  console.error(`[task-direction-governance:${mode}] ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function assertGovernanceLockAllowedFilesAreSsot(repo: string, taskId: string) {
  const lockPath = path.join(repo, '.atm', 'runtime', 'locks', `${taskId}.lock.json`);
  assert(existsSync(lockPath), `governance lock for ${taskId} must exist after claim`);
  const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
  const embedded = (parsed as { taskDirectionLock?: { allowedFiles?: unknown } }).taskDirectionLock;
  const canonical = Array.isArray(embedded?.allowedFiles)
    ? [...(embedded!.allowedFiles as unknown[])].filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.replace(/\\/g, '/')).sort()
    : null;
  const lockFiles = Array.isArray(parsed.files)
    ? [...(parsed.files as unknown[])].filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.replace(/\\/g, '/')).sort()
    : null;
  assert(canonical !== null, `governance lock for ${taskId} must embed taskDirectionLock.allowedFiles`);
  assert(lockFiles !== null, `governance lock for ${taskId} must expose top-level files`);
  assert(JSON.stringify(canonical) === JSON.stringify(lockFiles), `ATM_TASK_DIRECTION_LOCK_FILES_MISMATCH: governance lock top-level files for ${taskId} must equal taskDirectionLock.allowedFiles (SSOT). canonical=${JSON.stringify(canonical)} files=${JSON.stringify(lockFiles)}`);
}

async function runTimedSection(section: string, fn: () => Promise<void>) {
  const startedAt = Date.now();
  console.log(`[task-direction-governance:${mode}] section start ${section}`);
  await fn();
  console.log(`[task-direction-governance:${mode}] section done ${section} ${Date.now() - startedAt}ms`);
}

async function main() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-task-direction-governance-'));
  try {
    await runTimedSection('validateAdopterGoverned', () => validateAdopterGoverned(tempRoot));
    await runTimedSection('validateBatchCheckpointHold', () => validateBatchCheckpointHold(tempRoot));
    await runTimedSection('validateAaoThroughputAgentJourney', () => validateAaoThroughputAgentJourney(tempRoot));
    await runTimedSection('validateFrameworkDevelopment', () => validateFrameworkDevelopment(tempRoot));
    await runTimedSection('validateTaskSelfAllowOnClaim', () => validateTaskSelfAllowOnClaim(tempRoot));
    await runTimedSection('validateTasksClaimDirectionLockConsistency', () => validateTasksClaimDirectionLockConsistency(tempRoot));
    await runTimedSection('validateNextClaimPromptScopeConsistency', () => validateNextClaimPromptScopeConsistency(tempRoot));
    await runTimedSection('validateOutOfScopeSubtraction', () => validateOutOfScopeSubtraction(tempRoot));
    await runTimedSection('validateSameFileParallelClaimAdmission', () => validateSameFileParallelClaimAdmission(tempRoot));
    await runTimedSection('validateSameFilePreCommitOwnership', () => validateSameFilePreCommitOwnership(tempRoot));
    if (!process.exitCode) {
      console.log(`[task-direction-governance:${mode}] ok (adopter-governed and framework-development task direction gates verified)`);
      process.exit(0);
    }
  } finally {
    try {
      rmSync(tempRoot, { recursive: true, force: true });
    } catch {}
  }
}

/**
 * TASK-AAO-0062 regression:
 * tasks claim 產出的 lock 紀錄必須 embed taskDirectionLock，
 * 使得 tasks close 可以通過 direction lock 檢查。
 */
async function validateTasksClaimDirectionLockConsistency(tempRoot: string) {
  const repo = makeAdopterRepo(tempRoot, 'adopter-tasks-claim-consistency');
  initializeGit(repo);
  const claim = await runTasks(['claim', '--cwd', repo, '--task', 'TASK-ADOPT-0001', '--actor', 'adopter-agent', '--files', 'src/one.ts', '--json']);
  assert(claim.ok === true, 'tasks claim consistency: tasks claim must succeed');

  const lockPath = path.join(repo, '.atm', 'runtime', 'locks', 'TASK-ADOPT-0001.lock.json');
  assert(existsSync(lockPath), 'tasks claim consistency: locks file must exist after tasks claim');
  const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
  assert(parsed.taskDirectionLock !== undefined, 'tasks claim consistency: locks file must embed taskDirectionLock');

  // 修改實質 deliverable 以通過 close 時的 deliverable 門檻
  writeFileSync(path.join(repo, 'src', 'one.ts'), 'export const one = 99;\n', 'utf8');

  const close = await runTasks(['close', '--cwd', repo, '--task', 'TASK-ADOPT-0001', '--actor', 'adopter-agent', '--status', 'done', '--json']);
  assert(close.ok === true, `tasks claim consistency: tasks close must succeed. Got: ${JSON.stringify(close.messages)}`);
}

/**
 * TASK-AAO-0058 regression：
 * 任務 claim 後，direction lock.allowedFiles 必須自動包含三條 canonical governance 路徑，
 * 且不包含整個 .atm/history/** 放寬路徑。
 */
async function validateTaskSelfAllowOnClaim(tempRoot: string) {
  const repo = makeAdopterRepo(tempRoot, 'adopter-self-allow');
  const prompt = 'TASK-ADOPT-0001';
  const claim = await runNext(['--cwd', repo, '--claim', '--actor', 'adopter-agent', '--prompt', prompt]);
  assert(claim.ok === true, 'self-allow regression: next --claim must succeed');
  assertGovernanceLockAllowedFilesAreSsot(repo, 'TASK-ADOPT-0001');

  // 1. 讀取 canonical allowedFiles
  const lockPath = path.join(repo, '.atm', 'runtime', 'locks', 'TASK-ADOPT-0001.lock.json');
  assert(existsSync(lockPath), 'self-allow regression: governance lock must exist after claim');
  const parsed = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
  const embedded = (parsed as { taskDirectionLock?: { allowedFiles?: unknown } }).taskDirectionLock;
  const allowedFiles = Array.isArray(embedded?.allowedFiles)
    ? (embedded!.allowedFiles as string[]).map((entry) => entry.replace(/\\/g, '/'))
    : null;
  assert(allowedFiles !== null, 'self-allow regression: taskDirectionLock.allowedFiles must be an array');

  // 2. 三條 canonical governance 路徑必須存在
  const selfAllow = buildTaskSelfAllowPaths('TASK-ADOPT-0001');
  for (const govPath of selfAllow) {
    assert(
      allowedFiles.some((entry) => entry === govPath || entry.replace(/\\/g, '/') === govPath),
      `self-allow regression: allowedFiles must contain canonical governance path "${govPath}" after claim. Got: ${JSON.stringify(allowedFiles)}`
    );
  }

  // 3. 不允許整個 .atm/history/** 作為放寬路徑
  assert(
    !allowedFiles.some((entry) => entry === '.atm/history/**' || entry === '.atm/history'),
    `self-allow regression: allowedFiles must NOT contain broadened ".atm/history/**" or ".atm/history". Got: ${JSON.stringify(allowedFiles)}`
  );
}

async function validateAaoThroughputAgentJourney(tempRoot: string) {
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

  const preWriteDrift = runIntegrationHookInvocation([
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
  assert(currentAfterCheckpoint.pendingCommitWindow?.taskId === 'TASK-ADOPT-0001', 'compact current must preserve the checkpoint commit window');
  assert(String(currentAfterCheckpoint.pendingCommitWindow?.commitCommand ?? '').includes('TASK-ADOPT-0001'), 'pending commit window must provide a task-specific commit command');
  assert(String(currentAfterCheckpoint.commands?.resume ?? '').includes(`--batch ${batchId}`), 'compact current must provide a batch-specific resume command');

  runGit(repo, ['add',
    'src/one.ts',
    '.atm/history/tasks/TASK-ADOPT-0001.json',
    '.atm/history/evidence/TASK-ADOPT-0001.json',
    '.atm/history/task-events/TASK-ADOPT-0001'
  ]);
  // 模擬 `node atm.mjs git commit` 設定的 attribution env vars，
  // pre-commit hook 偵測到 staged task 檔案時需要這些才不會要求 ATM wrapper
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
  assert(preCommit.ok === true, 'checkpoint commit window must allow committing the just-closed task while the batch is held');
  runGit(repo, ['-c', 'user.name=ATM Test', '-c', 'user.email=atm-test@example.invalid', 'commit', '-m', 'complete TASK-ADOPT-0001']);

  const resume = await runBatch(['resume', '--cwd', repo, '--actor', 'adopter-agent', '--batch', batchId, '--json']);
  assert(resume.ok === true, 'AAO throughput journey must resume the held batch');
  assert(readActiveTaskDirectionLocks(repo).some((lock) => lock.taskId === 'TASK-ADOPT-0002'), 'batch resume must claim the next queue head only after the checkpoint commit window is safe');
}

async function validateBatchCheckpointHold(tempRoot: string) {
  const repo = makeAdopterRepo(tempRoot, 'adopter-batch-hold');
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
  assert(current.pendingCommitWindow?.taskId === 'TASK-ADOPT-0001', 'held status must preserve the previous task commit window');

  const resume = await runBatch(['resume', '--cwd', repo, '--actor', 'adopter-agent', '--batch', batchId, '--json']);
  assert(resume.ok === true, 'batch resume must succeed after checkpoint --hold');
  assert((resume.evidence as any).after?.hold === null, 'batch resume must clear the held state');
  assert(readActiveTaskDirectionLocks(repo).some((lock) => lock.taskId === 'TASK-ADOPT-0002'), 'batch resume must claim the next queue head through next');
}

async function validateAdopterGoverned(tempRoot: string) {
  const repo = makeAdopterRepo(tempRoot, 'adopter-governed');
  const prompt = 'TASK-ADOPT-0001 TASK-ADOPT-0002 all task cards';

  const route = await runNext(['--cwd', repo, '--prompt', prompt]);
  assert(route.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_QUEUE_READY'), 'adopter prompt must resolve to a scoped task queue');
  assert((route.evidence.taskQueue as any)?.schemaId === 'atm.taskQueuePreview.v1', 'adopter prompt route must stay read-only and only expose atm.taskQueuePreview.v1');
  assert((route.evidence.nextAction as any).queueHeadTaskId === 'TASK-ADOPT-0001', 'adopter queue head must be first task');

  const beforeClaim = runIntegrationHookInvocation([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'src/one.ts'
  ]);
  assert(beforeClaim.ok === false, 'adopter prompt-scoped edit must be blocked before claim');
  assert(beforeClaim.messages.some((entry) => entry.code === 'ATM_TASK_DIRECTION_LOCK_REQUIRED'), 'adopter pre-tool block must require a direction lock');

  const claim = await runNext(['--cwd', repo, '--claim', '--actor', 'adopter-agent', '--prompt', prompt]);
  assert(claim.ok === true, 'adopter next --claim must claim queue head');
  assert((claim.evidence.taskDirectionLock as any)?.taskId === 'TASK-ADOPT-0001', 'adopter claim must create direction lock for queue head');
  assertGovernanceLockAllowedFilesAreSsot(repo, 'TASK-ADOPT-0001');
  const adopterBatchId = (claim.evidence.batchRun as any)?.batchId;
  assert(typeof adopterBatchId === 'string' && adopterBatchId.length > 0, 'adopter claim must create a batchId for checkpoint status');

  const inScope = runIntegrationHookInvocation([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'src/one.ts'
  ]);
  assert(inScope.ok === true, 'adopter in-scope edit must pass after direction lock');
  await runLock(['release', '--cwd', repo, '--task', 'TASK-ADOPT-0001', '--owner', 'adopter-agent', '--json']);
  const reclaimed = await runNext(['--cwd', repo, '--claim', '--actor', 'adopter-agent', '--prompt', prompt]);
  assert(reclaimed.ok === true, 'next --claim must re-claim a previously released governance lock');
  const reclaimedLocks = readActiveTaskDirectionLocks(repo);
  assert(reclaimedLocks.some((lock) => lock.taskId === 'TASK-ADOPT-0001'), 're-claimed released lock must be visible as an active direction lock');

  const outOfScope = runIntegrationHookInvocation([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'src/two.ts'
  ]);
  assert(outOfScope.ok === false, 'adopter queue must block edits to the next task before queue head closes');
  assert(outOfScope.messages.some((entry) => entry.code === 'ATM_TOOL_SCOPE_DRIFT_BLOCKED'), 'adopter out-of-scope edit must report scope drift');

  const crossRepo = makeAdopterRepo(tempRoot, 'adopter-cross-repo');
  writeLedgerTask(crossRepo, 'TASK-CROSS-PLAN-0001', 'Cross planning mirror task', 'src/one.ts', {
    scopePaths: [
      'src/one.ts',
      'docs/ai_atomic_framework/atm-agent-first-operability/tasks/TASK-CROSS-PLAN-0001.task.md'
    ],
    sourcePlanPath: '../3KLife/docs/ai_atomic_framework/atm-agent-first-operability/ATM Agent-First 可操作性優化計畫書.md'
  });
  writeEvidence(crossRepo, 'TASK-CROSS-PLAN-0001');
  const crossClaim = await runNext(['--cwd', crossRepo, '--claim', '--actor', 'adopter-agent', '--prompt', 'TASK-CROSS-PLAN-0001']);
  assert(crossClaim.ok === true, 'cross planning fixture must claim successfully');
  const mirrorBlock = runIntegrationHookInvocation([
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

  const staticEvidenceBlock = runIntegrationHookInvocation([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'atomic_workbench/evidence/TASK-ADOPT-0001.json'
  ]);
  assert(staticEvidenceBlock.ok === false, 'adopter queue must block direct static evidence artifact edits');
  assert(staticEvidenceBlock.messages.some((entry) => entry.code === 'ATM_STATIC_EVIDENCE_IMPERSONATION_BLOCKED'), 'adopter static evidence edit must report impersonation block');

  const runtimeLockEditBlock = runIntegrationHookInvocation([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', '.atm/runtime/locks/TASK-ADOPT-0001.lock.json'
  ]);
  assert(runtimeLockEditBlock.ok === false, 'adopter queue must block manual runtime lock edits');
  assert(runtimeLockEditBlock.messages.some((entry) => entry.code === 'ATM_RUNTIME_LOCK_MANUAL_EDIT_BLOCKED'), 'manual runtime lock edits must report the dedicated blocker');

  const scopeExpansionRepo = makeAdopterRepo(tempRoot, 'adopter-scope-expansion');
  writeLedgerTask(scopeExpansionRepo, 'TASK-EXPAND-0005', 'Generated fixture exclusion boundaries', 'src/one.ts');
  writeEvidence(scopeExpansionRepo, 'TASK-EXPAND-0005');
  initializeGit(scopeExpansionRepo);
  mkdirSync(path.join(scopeExpansionRepo, 'atomic_workbench', 'atomization-coverage'), { recursive: true });
  writeFileSync(path.join(scopeExpansionRepo, 'atomic_workbench', 'atomization-coverage', 'exclusion-inventory.json'), '{}\n', 'utf8');
  // 必須先 stage，否則 TASK-AAO-0011 之後 scope expansion guard 只對 staged/modified-tracked 檔案作用
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

  writeFileSync(path.join(repo, 'src', 'one.ts'), 'export const one = 2;\n', 'utf8');
  await runBatch(['checkpoint', '--cwd', repo, '--actor', 'adopter-agent', '--json']);
  const checkpointWindowStatus = await runBatch(['current', '--cwd', repo, '--batch', adopterBatchId, '--compact', '--json']);
  assert((checkpointWindowStatus.evidence.current as any)?.pendingCommitWindow?.taskId === 'TASK-ADOPT-0001', 'batch current --compact must show the pending checkpoint commit window after checkpoint');
  assert(String((checkpointWindowStatus.evidence.current as any)?.pendingCommitWindow?.commitCommand ?? '').includes('TASK-ADOPT-0001'), 'pending checkpoint commit window must include a task-specific commit command');
  const afterFirstClose = await runNext(['--cwd', repo, '--prompt', prompt]);
  assert((afterFirstClose.evidence.nextAction as any).queueHeadTaskId === 'TASK-ADOPT-0002', 'adopter queue must advance to second task after closing first');
  initializeGit(repo);
  runGit(repo, ['add',
    'src/one.ts',
    '.atm/history/tasks/TASK-ADOPT-0001.json',
    '.atm/history/evidence/TASK-ADOPT-0001.json',
    '.atm/history/task-events/TASK-ADOPT-0001'
  ]);
  const checkpointCommit = runHook(['pre-commit', '--cwd', repo]);
  assert(checkpointCommit.ok === true, 'batch checkpoint commit must pass even after the direction lock advances to the next queue head');
  assert(((checkpointCommit.evidence as any).directionLockDriftFiles ?? []).length === 0, 'checkpointed task deliverables must not be reported as drift against the next task lock');

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

async function validateFrameworkDevelopment(tempRoot: string) {
  const repo = makeFrameworkRepo(tempRoot, 'ai-atomic-framework');
  const prompt = 'TASK-FW-0001 TASK-FW-0002 all task cards';

  const route = await runNext(['--cwd', repo, '--prompt', prompt]);
  assert(route.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_QUEUE_READY'), 'framework prompt must resolve to a scoped task queue');

  const beforeClaim = runIntegrationHookInvocation([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'packages/core/src/one.ts'
  ]);
  assert(beforeClaim.ok === false, 'framework critical edit must be blocked before task/framework claim');
  assert(beforeClaim.messages.some((entry) => entry.code === 'ATM_TASK_DIRECTION_LOCK_REQUIRED' || entry.code === 'ATM_INTEGRATION_PRE_TOOL_FRAMEWORK_CLAIM_REQUIRED'), 'framework pre-tool must report missing claim');

  writeJson(path.join(repo, '.atm', 'runtime', 'task-direction-locks', 'TASK-FW-0001.json'), {
    schemaId: 'atm.taskDirectionLock.v1',
    specVersion: '0.1.0',
    taskId: 'TASK-FW-0001',
    queueId: null,
    queueIndex: null,
    allowedFiles: ['packages/core/src/one.ts'],
    promptHash: null,
    actorId: 'framework-agent',
    createdAt: new Date().toISOString(),
    status: 'active'
  });
  const directionOnlyBlock = runIntegrationHookInvocation([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'packages/core/src/one.ts'
  ]);
  assert(directionOnlyBlock.ok === false, 'framework direction lock alone must not satisfy framework-development hard gate');
  assert(directionOnlyBlock.messages.some((entry) => entry.code === 'ATM_INTEGRATION_PRE_TOOL_FRAMEWORK_CLAIM_REQUIRED'), 'framework direction-only block must require framework claim');

  const taskClaim = await runNext(['--cwd', repo, '--claim', '--actor', 'framework-agent', '--prompt', prompt]);
  assert(taskClaim.ok === true, 'framework next --claim must claim queue head and write direction lock');

  const withFrameworkTaskClaim = runIntegrationHookInvocation([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'packages/core/src/one.ts'
  ]);
  assert(withFrameworkTaskClaim.ok === true, 'framework task claim plus direction lock must allow critical in-scope edit');

  await runFrameworkTempClaim(repo, 'framework-agent', ['packages/core/src/one.ts'], 'test framework hard gate');

  const withFrameworkClaim = runIntegrationHookInvocation([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'packages/core/src/one.ts'
  ]);
  assert(withFrameworkClaim.ok === true, 'framework critical in-scope edit must pass with both direction lock and framework claim');

  const frameworkScopeDrift = runIntegrationHookInvocation([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', prompt,
    '--files', 'packages/core/src/two.ts'
  ]);
  assert(frameworkScopeDrift.ok === false, 'framework mode must still enforce task direction scope after framework claim');
  assert(frameworkScopeDrift.messages.some((entry) => entry.code === 'ATM_TOOL_SCOPE_DRIFT_BLOCKED'), 'framework scope drift must report the shared direction-lock blocker');
}

function makeAdopterRepo(parent: string, name: string) {
  const repo = path.join(parent, name);
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeJson(path.join(repo, 'package.json'), { name, type: 'module' });
  writeFileSync(path.join(repo, 'src', 'one.ts'), 'export const one = 1;\n', 'utf8');
  writeFileSync(path.join(repo, 'src', 'two.ts'), 'export const two = 2;\n', 'utf8');
  writeLedgerTask(repo, 'TASK-ADOPT-0001', 'Adopter task one', 'src/one.ts');
  writeLedgerTask(repo, 'TASK-ADOPT-0002', 'Adopter task two', 'src/two.ts');
  writeEvidence(repo, 'TASK-ADOPT-0001');
  writeEvidence(repo, 'TASK-ADOPT-0002');
  // 建立 actor 預設 identity，以便 pre-commit hook 的 commit attribution 查詢 gitName/gitEmail
  writeJson(path.join(repo, '.atm', 'runtime', 'identity', 'default.json'), {
    schemaId: 'atm.identityDefault.v1',
    specVersion: '0.1.0',
    actorId: 'adopter-agent',
    gitName: 'ATM Test',
    gitEmail: 'atm-test@example.invalid',
    updatedAt: new Date().toISOString()
  });
  return repo;
}

function makeFrameworkRepo(parent: string, name: string) {
  const repo = path.join(parent, name);
  mkdirSync(path.join(repo, 'packages', 'core', 'src'), { recursive: true });
  mkdirSync(path.join(repo, 'packages', 'cli', 'src'), { recursive: true });
  writeJson(path.join(repo, 'package.json'), { name: 'ai-atomic-framework', workspaces: ['packages/*'] });
  writeJson(path.join(repo, 'atomic-registry.json'), { entries: [] });
  writeJson(path.join(repo, '.atm', 'runtime', 'pinned-runner.json'), {
    schemaVersion: 'atm.pinnedRunner.v0.1',
    runnerPath: 'atm.mjs',
    sourcePath: 'release/atm-onefile/atm.mjs'
  });
  mkdirSync(path.join(repo, 'release', 'atm-onefile'), { recursive: true });
  writeFileSync(path.join(repo, 'release', 'atm-onefile', 'atm.mjs'), '#!/usr/bin/env node\n', 'utf8');
  writeFileSync(path.join(repo, 'packages', 'core', 'src', 'index.ts'), 'export const core = true;\n', 'utf8');
  writeFileSync(path.join(repo, 'packages', 'core', 'src', 'one.ts'), 'export const one = 1;\n', 'utf8');
  writeFileSync(path.join(repo, 'packages', 'core', 'src', 'two.ts'), 'export const two = 2;\n', 'utf8');
  writeFileSync(path.join(repo, 'packages', 'cli', 'src', 'atm.ts'), 'export const atm = true;\n', 'utf8');
  writeLedgerTask(repo, 'TASK-FW-0001', 'Framework task one', 'packages/core/src/one.ts');
  writeLedgerTask(repo, 'TASK-FW-0002', 'Framework task two', 'packages/core/src/two.ts');
  writeEvidence(repo, 'TASK-FW-0001');
  writeEvidence(repo, 'TASK-FW-0002');
  return repo;
}

function writeLedgerTask(repo: string, taskId: string, title: string, scopePath: string, options: { readonly scopePaths?: readonly string[]; readonly sourcePlanPath?: string } = {}) {
  writeJson(path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title,
    status: 'ready',
    dependencies: [],
    scope: options.scopePaths ?? [scopePath],
    source: {
      planPath: options.sourcePlanPath ?? 'docs/plan.md',
      sectionTitle: title,
      headingLine: 1,
      hash: taskId
    }
  });
}

function writeEvidence(repo: string, taskId: string) {
  writeJson(path.join(repo, '.atm', 'history', 'evidence', `${taskId}.json`), {
    taskId,
    evidence: [
      {
        evidenceKind: 'validation',
        evidenceType: 'test',
        summary: 'validator fixture evidence',
        details: {
          commandRuns: [
            {
              command: 'fixture-pass',
              exitCode: 0,
              stdoutSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
              stderrSha256: 'sha256:0000000000000000000000000000000000000000000000000000000000000000'
            }
          ]
        }
      }
    ]
  });
}

function initializeGit(repo: string) {
  runGit(repo, ['init', '-q']);
  runGit(repo, ['add', '.']);
  runGit(repo, ['-c', 'user.name=ATM Test', '-c', 'user.email=atm-test@example.invalid', 'commit', '-m', 'initial fixture']);
}

function runGit(repo: string, args: string[]) {
  const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  assert(result.status === 0, `git ${args.join(' ')} must exit 0: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

async function validateNextClaimPromptScopeConsistency(tempRoot: string) {
  const repo = makeAdopterRepo(tempRoot, 'adopter-next-claim-prompt-scope');
  writeFileSync(path.join(repo, 'src', 'three.ts'), 'export const three = 3;\n', 'utf8');
  writeLedgerTask(repo, 'TASK-ADOPT-0003', 'Adopter task three with multi-deliverables', 'src/one.ts', {
    scopePaths: ['src/one.ts', 'src/two.ts', 'src/three.ts']
  });
  writeEvidence(repo, 'TASK-ADOPT-0003');
  initializeGit(repo);

  const claim = await runNext(['--cwd', repo, '--claim', '--actor', 'adopter-agent', '--prompt', 'TASK-ADOPT-0003']);
  assert(claim.ok === true, 'next claim prompt sync: next --claim must succeed');

  const taskPath = path.join(repo, '.atm', 'history', 'tasks', 'TASK-ADOPT-0003.json');
  assert(existsSync(taskPath), 'next claim prompt sync: task ledger JSON must exist');
  const taskData = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, any>;

  const claimFiles = taskData.claim?.files ?? [];
  const allowedFiles = taskData.taskDirectionLock?.allowedFiles ?? [];

  assert(claimFiles.includes('src/one.ts'), 'claim.files must contain src/one.ts');
  assert(claimFiles.includes('src/two.ts'), 'claim.files must contain src/two.ts');
  assert(claimFiles.includes('src/three.ts'), 'claim.files must contain src/three.ts');

  assert(allowedFiles.includes('src/one.ts'), 'allowedFiles must contain src/one.ts');
  assert(allowedFiles.includes('src/two.ts'), 'allowedFiles must contain src/two.ts');
  assert(allowedFiles.includes('src/three.ts'), 'allowedFiles must contain src/three.ts');

  const hookResult = runIntegrationHookInvocation([
    'pre-tool',
    '--cwd', repo,
    '--editor', 'copilot',
    '--tool-name', 'Edit',
    '--prompt', 'TASK-ADOPT-0003',
    '--files', 'src/one.ts,src/two.ts,src/three.ts'
  ]);
  assert(hookResult.ok === true, `pre-tool hook must allow edits to all three deliverables. Messages: ${JSON.stringify(hookResult.messages)}`);
}

async function validateOutOfScopeSubtraction(tempRoot: string) {
  const repo = makeAdopterRepo(tempRoot, 'adopter-out-of-scope-subtraction');
  writeJson(path.join(repo, '.atm', 'history', 'tasks', 'TASK-ADOPT-0004.json'), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-ADOPT-0004',
    title: 'outOfScope subtraction test',
    status: 'ready',
    dependencies: [],
    scopePaths: ['src/one.ts', 'src/two.ts', 'src/three.ts'],
    outOfScope: ['src/two.ts'],
    source: {
      planPath: 'docs/plan.md',
      sectionTitle: 'outOfScope subtraction test',
      headingLine: 1,
      hash: 'TASK-ADOPT-0004'
    }
  });
  writeEvidence(repo, 'TASK-ADOPT-0004');
  initializeGit(repo);

  const claim = await runNext(['--cwd', repo, '--claim', '--actor', 'adopter-agent', '--prompt', 'TASK-ADOPT-0004']);
  assert(claim.ok === true, 'outOfScope subtraction: next --claim must succeed');

  const taskPath = path.join(repo, '.atm', 'history', 'tasks', 'TASK-ADOPT-0004.json');
  assert(existsSync(taskPath), 'outOfScope subtraction: task ledger JSON must exist');
  const taskData = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, any>;

  const claimFiles = taskData.claim?.files ?? [];
  const allowedFiles = taskData.taskDirectionLock?.allowedFiles ?? [];

  assert(allowedFiles.includes('src/one.ts'), 'allowedFiles must contain src/one.ts');
  assert(!allowedFiles.includes('src/two.ts'), 'allowedFiles must NOT contain src/two.ts (subtracted)');
  assert(allowedFiles.includes('src/three.ts'), 'allowedFiles must contain src/three.ts');

  writeJson(path.join(repo, '.atm', 'history', 'tasks', 'TASK-ADOPT-0005.json'), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-ADOPT-0005',
    title: 'outOfScope undefined test',
    status: 'ready',
    dependencies: [],
    scopePaths: ['src/one.ts', 'src/two.ts'],
    source: {
      planPath: 'docs/plan.md',
      sectionTitle: 'outOfScope undefined test',
      headingLine: 1,
      hash: 'TASK-ADOPT-0005'
    }
  });
  writeEvidence(repo, 'TASK-ADOPT-0005');
  const claim2 = await runNext(['--cwd', repo, '--claim', '--actor', 'adopter-agent', '--prompt', 'TASK-ADOPT-0005']);
  assert(claim2.ok === true, 'outOfScope undefined: next --claim must succeed');
  const taskPath2 = path.join(repo, '.atm', 'history', 'tasks', 'TASK-ADOPT-0005.json');
  const taskData2 = JSON.parse(readFileSync(taskPath2, 'utf8')) as Record<string, any>;
  const allowedFiles2 = taskData2.taskDirectionLock?.allowedFiles ?? [];
  assert(allowedFiles2.includes('src/one.ts'), 'allowedFiles2 must contain src/one.ts');
  assert(allowedFiles2.includes('src/two.ts'), 'allowedFiles2 must contain src/two.ts');

  const markdownText = `---
task_id: TASK-ADOPT-0006
title: markdown outOfScope test
status: ready
scopePaths:
  - src/one.ts
  - src/two.ts
forbidden_files:
  - src/two.ts
---
forbidden paths in prose like src/two.ts
`;
  mkdirSync(path.join(repo, 'docs', 'ai_atomic_framework', 'atm-agent-first-operability', 'tasks'), { recursive: true });
  writeFileSync(path.join(repo, 'docs', 'ai_atomic_framework', 'atm-agent-first-operability', 'tasks', 'TASK-ADOPT-0006.task.md'), markdownText, 'utf8');

  const imp = await runTasks(['import', '--cwd', repo, '--from', 'docs/ai_atomic_framework/atm-agent-first-operability/tasks/TASK-ADOPT-0006.task.md', '--write', '--json']);
  assert(imp.ok === true, 'markdown outOfScope import: must succeed');

  const claim3 = await runNext(['--cwd', repo, '--claim', '--actor', 'adopter-agent', '--prompt', 'TASK-ADOPT-0006']);
  assert(claim3.ok === true, 'markdown outOfScope: next --claim must succeed');
  const taskPath3 = path.join(repo, '.atm', 'history', 'tasks', 'TASK-ADOPT-0006.json');
  const taskData3 = JSON.parse(readFileSync(taskPath3, 'utf8')) as Record<string, any>;
  const allowedFiles3 = taskData3.taskDirectionLock?.allowedFiles ?? [];

  assert(allowedFiles3.includes('src/one.ts'), 'allowedFiles3 must contain src/one.ts');
  assert(!allowedFiles3.includes('src/two.ts'), 'allowedFiles3 must NOT contain src/two.ts');
}

/**
 * TASK-CID-0024:
 * next --claim 不再因為「同檔/同 atom 與排隊中的卡重疊」就一律序列化。
 * - 正例 1：同檔同 atom 重疊但對方卡尚未被 claim → 准入（advisory only）。
 * - 反例：對方卡已被其他 actor 以 write intent 主動 claim → 仍要被
 *   ATM_NEXT_CLAIM_BLOCKED 擋下。
 * - 正例 2：closeout-only / no-more-mutation claim intent 在同樣的活躍衝突
 *   下仍可 claim，且 intent 會落到 task ledger claim.intent。
 */
async function validateSameFileParallelClaimAdmission(tempRoot: string) {
  const repo = makeAdopterRepo(tempRoot, 'adopter-same-file-parallel-claim');
  writeFileSync(path.join(repo, 'src', 'shared.ts'), 'export const shared = 1;\n', 'utf8');
  for (const [taskId, ownFile] of [['TASK-PAR-0001', 'src/one.ts'], ['TASK-PAR-0002', 'src/two.ts']] as const) {
    writeJson(path.join(repo, '.atm', 'history', 'tasks', `${taskId}.json`), {
      schemaVersion: 'atm.workItem.v0.2',
      workItemId: taskId,
      title: `Same-file parallel fixture ${taskId}`,
      status: 'ready',
      dependencies: [],
      scopePaths: [ownFile, 'src/shared.ts'],
      source: {
        planPath: 'docs/plan.md',
        sectionTitle: taskId,
        headingLine: 1,
        hash: taskId
      }
    });
    writeEvidence(repo, taskId);
  }
  writeJson(path.join(repo, 'atomic_workbench', 'atomization-coverage', 'path-to-atom-map.json'), {
    mappings: [
      { path_pattern: 'src/shared.ts', atom_id: 'atom-shared-fixture', capability: 'fixture-shared-surface' }
    ]
  });
  initializeGit(repo);

  // 正例 1：TASK-PAR-0001 仍在排隊（未 claim），同 atom 重疊不得阻擋 claim。
  const queuedOverlapClaim = await runNext(['--cwd', repo, '--claim', '--actor', 'agent-other', '--prompt', 'TASK-PAR-0002']);
  assert(queuedOverlapClaim.ok === true, 'same-file parallel claim: CID/atom overlap with a queued (unclaimed) task must not block next --claim');
  const claimedTask = JSON.parse(readFileSync(path.join(repo, '.atm', 'history', 'tasks', 'TASK-PAR-0002.json'), 'utf8')) as Record<string, any>;
  assert(claimedTask.claim?.state === 'active' && claimedTask.claim?.actorId === 'agent-other', 'same-file parallel claim: TASK-PAR-0002 must hold an active claim after admission');
  assert((claimedTask.claim?.intent ?? 'write') === 'write', 'same-file parallel claim: default claim intent must be write');

  // 反例：TASK-PAR-0002 已被另一 actor 以 write intent 主動 claim，
  // 同 atom 的 TASK-PAR-0001 write claim 必須仍被擋下。
  let activeConflictBlocked: any = null;
  try {
    await runNext(['--cwd', repo, '--claim', '--actor', 'adopter-agent', '--prompt', 'TASK-PAR-0001']);
  } catch (error) {
    activeConflictBlocked = error;
  }
  assert(activeConflictBlocked?.code === 'ATM_NEXT_CLAIM_BLOCKED', 'same-file parallel claim: active write-claim CID conflict must still block next --claim');
  const blockedDetails = (activeConflictBlocked?.details ?? {}) as Record<string, any>;
  assert(blockedDetails.conflictWithTaskId === 'TASK-PAR-0002', 'same-file parallel claim: block details must identify the actively claimed conflicting task');
  assert(String(blockedDetails.closeoutOnlyHint ?? '').includes('--claim-intent closeout-only'), 'same-file parallel claim: block details must hint at the closeout-only claim intent');

  // 正例 2：closeout-only claim intent 在同樣的活躍衝突下必須可 claim。
  const closeoutOnlyClaim = await runNext(['--cwd', repo, '--claim', '--actor', 'adopter-agent', '--prompt', 'TASK-PAR-0001', '--claim-intent', 'closeout-only']);
  assert(closeoutOnlyClaim.ok === true, 'same-file parallel claim: closeout-only claim intent must be admitted despite an active same-atom write claim');
  assert((closeoutOnlyClaim.evidence as any).claimIntent === 'closeout-only', 'same-file parallel claim: next --claim evidence must surface claimIntent=closeout-only');
  const closeoutTask = JSON.parse(readFileSync(path.join(repo, '.atm', 'history', 'tasks', 'TASK-PAR-0001.json'), 'utf8')) as Record<string, any>;
  assert(closeoutTask.claim?.state === 'active' && closeoutTask.claim?.intent === 'closeout-only', 'same-file parallel claim: ledger claim.intent must persist closeout-only');
}

/**
 * TASK-CID-0024:
 * hook pre-commit 不再因為「同一 staged 檔有多個 active claim」就失敗。
 * - 正例 1：兩個 write claim 覆蓋同一檔，但 committing task 自己擁有該檔 → 通過。
 * - 反例 1：staged 檔只被別的 active write claim 覆蓋（mixed staged content）
 *   且無 steward/broker 證據 → ATM_PRE_COMMIT_STAGED_OWNERSHIP_AMBIGUOUS。
 * - 正例 2：同樣的 staged 檔若有 neutral-steward broker intent 覆蓋 → 通過。
 * - 反例 2：closeout-only claim 卻 staged 自己 scope 的 source mutation →
 *   ATM_PRE_COMMIT_CLOSEOUT_ONLY_CLAIM_MUTATION。
 */
async function validateSameFilePreCommitOwnership(tempRoot: string) {
  const repo = makeAdopterRepo(tempRoot, 'adopter-same-file-precommit');
  writeFileSync(path.join(repo, 'src', 'shared.ts'), 'export const shared = 1;\n', 'utf8');
  writeFileSync(path.join(repo, 'src', 'a.ts'), 'export const a = 1;\n', 'utf8');
  writeFileSync(path.join(repo, 'src', 'b.ts'), 'export const b = 1;\n', 'utf8');
  writeFileSync(path.join(repo, 'src', 'c.ts'), 'export const c = 1;\n', 'utf8');
  writeLedgerTask(repo, 'TASK-MIX-0001', 'Same-file pre-commit fixture one', 'src/a.ts');
  writeLedgerTask(repo, 'TASK-MIX-0002', 'Same-file pre-commit fixture two', 'src/b.ts');
  writeLedgerTask(repo, 'TASK-MIX-0003', 'Closeout-only pre-commit fixture', 'src/c.ts');
  writeEvidence(repo, 'TASK-MIX-0001');
  writeEvidence(repo, 'TASK-MIX-0002');
  writeEvidence(repo, 'TASK-MIX-0003');
  initializeGit(repo);

  const claimOne = await runTasks(['claim', '--cwd', repo, '--task', 'TASK-MIX-0001', '--actor', 'adopter-agent', '--files', 'src/a.ts,src/shared.ts', '--json']);
  assert(claimOne.ok === true, 'same-file pre-commit: TASK-MIX-0001 claim must succeed');
  const claimTwo = await runTasks(['claim', '--cwd', repo, '--task', 'TASK-MIX-0002', '--actor', 'adopter-agent', '--files', 'src/b.ts,src/shared.ts', '--json']);
  assert(claimTwo.ok === true, 'same-file pre-commit: TASK-MIX-0002 same-file claim must succeed alongside TASK-MIX-0001');
  const claimThree = await runTasks(['claim', '--cwd', repo, '--task', 'TASK-MIX-0003', '--actor', 'adopter-agent', '--files', 'src/c.ts', '--claim-intent', 'closeout-only', '--json']);
  assert(claimThree.ok === true, 'same-file pre-commit: closeout-only claim must succeed');
  assert((claimThree.evidence as any).claimIntent === 'closeout-only', 'same-file pre-commit: tasks claim evidence must surface claimIntent');

  const runPreCommitAs = (taskId: string) => {
    process.env.ATM_COMMIT_ACTOR_ID = 'adopter-agent';
    process.env.ATM_COMMIT_TASK_ID = taskId;
    process.env.GIT_AUTHOR_NAME = 'ATM Test';
    process.env.GIT_AUTHOR_EMAIL = 'atm-test@example.invalid';
    try {
      return runHook(['pre-commit', '--cwd', repo]);
    } finally {
      delete process.env.ATM_COMMIT_ACTOR_ID;
      delete process.env.ATM_COMMIT_TASK_ID;
      delete process.env.GIT_AUTHOR_NAME;
      delete process.env.GIT_AUTHOR_EMAIL;
    }
  };

  // 正例 1：committing task 擁有 staged 同檔 → 多重 same-file claim 不得阻擋。
  writeFileSync(path.join(repo, 'src', 'shared.ts'), 'export const shared = 2;\n', 'utf8');
  runGit(repo, ['add', 'src/shared.ts']);
  const ownedMultiClaim = runPreCommitAs('TASK-MIX-0001');
  assert(ownedMultiClaim.ok === true, `same-file pre-commit: multiple active same-file claims must not block when the committing task owns the staged file. Got: ${JSON.stringify((ownedMultiClaim.evidence as any).blockingFindings ?? [])}`);
  const ownedReport = (ownedMultiClaim.evidence as any).sameFileClaimReport;
  assert(ownedReport?.ok === true, 'same-file pre-commit: sameFileClaimReport must be ok for owned staged files');
  assert((ownedReport?.multiClaimFiles ?? []).some((entry: any) => entry.file === 'src/shared.ts'), 'same-file pre-commit: sameFileClaimReport must record the same-file multi-claim coverage');

  // 反例 1：staged 檔只屬於另一個 active write claim → ambiguous，必須阻擋。
  writeFileSync(path.join(repo, 'src', 'b.ts'), 'export const b = 2;\n', 'utf8');
  runGit(repo, ['add', 'src/b.ts']);
  const ambiguous = runPreCommitAs('TASK-MIX-0001');
  assert(ambiguous.ok === false, 'same-file pre-commit: mixed staged content owned by another active write claim must block');
  const ambiguousFindings = ((ambiguous.evidence as any).sameFileClaimReport?.findings ?? []) as Array<Record<string, any>>;
  assert(ambiguousFindings.some((entry) => entry.code === 'ATM_PRE_COMMIT_STAGED_OWNERSHIP_AMBIGUOUS' && entry.file === 'src/b.ts'), 'same-file pre-commit: ambiguous staged ownership must emit ATM_PRE_COMMIT_STAGED_OWNERSHIP_AMBIGUOUS for the foreign-claimed file');

  // 正例 2：同樣的 staged 檔若有 neutral-steward broker intent 覆蓋 → 通過。
  writeJson(path.join(repo, '.atm', 'runtime', 'write-broker.registry.json'), {
    schemaId: 'atm.writeBrokerRegistry.v1',
    specVersion: '0.1.0',
    repoId: 'local-repo',
    workspaceId: 'main',
    activeIntents: [
      {
        intentId: 'intent-fixture-steward',
        taskId: 'TASK-MIX-0002',
        teamRunId: null,
        actorId: 'steward-fixture',
        baseCommit: 'HEAD',
        resourceKeys: {
          files: ['src/b.ts'],
          atomIds: [],
          atomCids: [],
          generators: [],
          projections: [],
          registries: [],
          validators: [],
          artifacts: []
        },
        leaseEpoch: 1,
        lane: 'neutral-steward',
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString()
      }
    ]
  });
  const stewardCovered = runPreCommitAs('TASK-MIX-0001');
  assert(stewardCovered.ok === true, `same-file pre-commit: steward/broker evidence must resolve staged ownership ambiguity. Got: ${JSON.stringify((stewardCovered.evidence as any).blockingFindings ?? [])}`);
  rmSync(path.join(repo, '.atm', 'runtime', 'write-broker.registry.json'), { force: true });
  runGit(repo, ['reset', '--', 'src/b.ts']);
  runGit(repo, ['checkout', '--', 'src/b.ts']);
  runGit(repo, ['reset', '--', 'src/shared.ts']);
  runGit(repo, ['checkout', '--', 'src/shared.ts']);

  // 反例 2：closeout-only claim 不得 staged 自己 scope 的 source mutation。
  writeFileSync(path.join(repo, 'src', 'c.ts'), 'export const c = 2;\n', 'utf8');
  runGit(repo, ['add', 'src/c.ts']);
  const closeoutMutation = runPreCommitAs('TASK-MIX-0003');
  assert(closeoutMutation.ok === false, 'same-file pre-commit: closeout-only claim must not ship new source mutations');
  const closeoutFindings = ((closeoutMutation.evidence as any).sameFileClaimReport?.findings ?? []) as Array<Record<string, any>>;
  assert(closeoutFindings.some((entry) => entry.code === 'ATM_PRE_COMMIT_CLOSEOUT_ONLY_CLAIM_MUTATION' && entry.file === 'src/c.ts'), 'same-file pre-commit: closeout-only mutation must emit ATM_PRE_COMMIT_CLOSEOUT_ONLY_CLAIM_MUTATION');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
