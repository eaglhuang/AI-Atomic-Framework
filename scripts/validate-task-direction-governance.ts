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

async function main() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-task-direction-governance-'));
  try {
    await validateAdopterGoverned(tempRoot);
    await validateBatchCheckpointHold(tempRoot);
    await validateAaoThroughputAgentJourney(tempRoot);
    await validateFrameworkDevelopment(tempRoot);
    await validateTaskSelfAllowOnClaim(tempRoot);
    if (!process.exitCode) {
      console.log(`[task-direction-governance:${mode}] ok (adopter-governed and framework-development task direction gates verified)`);
    }
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
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

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
