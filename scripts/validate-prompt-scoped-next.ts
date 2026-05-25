import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runBatch } from '../packages/cli/src/commands/batch.ts';
import { runNext } from '../packages/cli/src/commands/next.ts';
import { runQuickfix } from '../packages/cli/src/commands/quickfix.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  const tempRoot = mkdtempSync(path.join(process.cwd(), '.atm-temp', 'prompt-scoped-next-'));
  try {
    const planDir = path.join(tempRoot, 'docs', 'plan');
    const taskDir = path.join(planDir, 'tasks');
    const otherTaskDir = path.join(tempRoot, 'docs', 'other', 'tasks');
    mkdirSync(taskDir, { recursive: true });
    mkdirSync(otherTaskDir, { recursive: true });

    writeFileSync(path.join(planDir, 'PlanAlpha.md'), '# Plan Alpha\n', 'utf8');
    writeFileSync(path.join(tempRoot, 'docs', 'other', 'OtherPlan.md'), '# Other Plan\n', 'utf8');
    writeTaskCard(path.join(taskDir, 'TASK-ALPHA-0001.task.md'), 'TASK-ALPHA-0001', 'Alpha first task');
    writeTaskCard(path.join(taskDir, 'TASK-ALPHA-0002.task.md'), 'TASK-ALPHA-0002', 'Alpha second task');
    writeTaskCard(path.join(otherTaskDir, 'TASK-OTHER-0001.task.md'), 'TASK-OTHER-0001', 'Other task');
    writeTaskCard(path.join(otherTaskDir, 'SANGUO-BOOTSTRAP-0001.task.md'), 'SANGUO-BOOTSTRAP-0001', 'Sanguo bootstrap task');

    const exact = await runNext(['--cwd', tempRoot, '--prompt', 'Please implement TASK-ALPHA-0001']);
    assert(exact.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_ROUTE_READY'), 'exact task id prompt must route to one task');
    assert((exact.evidence.nextAction as any).selectedTask.workItemId === 'TASK-ALPHA-0001', 'exact task id prompt selected wrong task');
    assert((exact.evidence.nextAction as any).recommendedChannel === 'normal', 'exact task id prompt must recommend normal channel');

    const genericExact = await runNext(['--cwd', tempRoot, '--prompt', '請處理 SANGUO-BOOTSTRAP-0001']);
    assert(genericExact.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_ROUTE_READY'), 'generic governed task id prompt must route to one task');
    assert((genericExact.evidence.nextAction as any).selectedTask.workItemId === 'SANGUO-BOOTSTRAP-0001', 'generic governed task id prompt selected wrong task');

    const quickfixPrompt = '請小修 tsconfig.json typo';
    const quickfixRoute = await runNext(['--cwd', tempRoot, '--prompt', quickfixPrompt]);
    assert(quickfixRoute.messages.some((entry) => entry.code === 'ATM_NEXT_QUICKFIX_ROUTE_READY'), 'quickfix prompt must route to the fast channel');
    assert((quickfixRoute.evidence.nextAction as any).recommendedChannel === 'fast', 'quickfix route must recommend fast channel');
    const quickfixClaim = await runNext(['--cwd', tempRoot, '--claim', '--actor', 'prompt-scope-test', '--prompt', quickfixPrompt]);
    assert(quickfixClaim.ok === true, 'quickfix next --claim must succeed');
    assert((quickfixClaim.evidence.quickfixLock as any)?.schemaId === 'atm.quickfixLock.v1', 'quickfix next --claim must persist atm.quickfixLock.v1');
    const quickfixStatus = await runQuickfix(['status', '--cwd', tempRoot, '--json']);
    assert((quickfixStatus.evidence.lock as any)?.actorId === 'prompt-scope-test', 'quickfix status must report the active lock');
    const quickfixRelease = await runQuickfix(['release', '--cwd', tempRoot, '--actor', 'prompt-scope-test', '--json']);
    assert((quickfixRelease.evidence.lock as any)?.status === 'released', 'quickfix release must mark the lock as released');

    const markdownClaim = await runNext(['--cwd', tempRoot, '--claim', '--actor', 'prompt-scope-test', '--prompt', 'Please implement TASK-ALPHA-0001']);
    assert(markdownClaim.ok === false, 'next --claim must not pretend to claim a Markdown-only task card');
    assert(markdownClaim.messages.some((entry) => entry.code === 'ATM_NEXT_CLAIM_TASK_IMPORT_REQUIRED'), 'next --claim must require import for Markdown task cards');

    const intentPath = path.join(tempRoot, '.atm', 'runtime', 'task-intent.json');
    mkdirSync(path.dirname(intentPath), { recursive: true });
    writeFileSync(path.join(tempRoot, 'docs', 'plan', 'TASK-ALPHA-0002.note.md'), '# helper\n', 'utf8');
    writeFileSync(intentPath, `${JSON.stringify({
      schemaId: 'atm.taskIntent.v1',
      userPrompt: 'skill resolved alpha two',
      mentionedTaskIds: ['TASK-ALPHA-0002'],
      mentionedPlanPaths: [],
      taskRootHints: [],
      targetRepoHints: [],
      requestedAction: 'implement',
      confidence: 0.95,
      source: 'atm-skill'
    }, null, 2)}\n`, 'utf8');
    const intent = await runNext(['--cwd', tempRoot, '--intent', intentPath]);
    assert(intent.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_ROUTE_READY'), 'intent file must route to one task');
    assert((intent.evidence.nextAction as any).selectedTask.workItemId === 'TASK-ALPHA-0002', 'intent file selected wrong task');

    const queue = await runNext(['--cwd', tempRoot, '--prompt', 'PlanAlpha first 2 task cards']);
    assert(queue.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_QUEUE_READY'), 'plan-scoped ordinal prompt must return a task queue');
    assert((queue.evidence.nextAction as any).queueSize === 2, 'plan-scoped ordinal prompt must select two tasks');
    assert((queue.evidence.nextAction as any).recommendedChannel === 'batch', 'plan-scoped queue prompt must recommend batch channel');
    assert((queue.evidence.taskQueue as any)?.schemaId === 'atm.taskQueuePreview.v1', 'plan-scoped queue prompt must stay read-only and only expose a queue preview');
    assert((queue.evidence.nextAction as any).queueHeadTaskId === 'TASK-ALPHA-0001', 'plan-scoped queue must expose the queue head');

    const ledgerTaskDir = path.join(tempRoot, '.atm', 'history', 'tasks');
    mkdirSync(ledgerTaskDir, { recursive: true });
    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-LEDGER-0001.json'), 'TASK-LEDGER-0001', 'Ledger first task', 'src/first.ts');
    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-LEDGER-0002.json'), 'TASK-LEDGER-0002', 'Ledger second task', 'src/second.ts');
    const ledgerPrompt = 'TASK-LEDGER-0001 TASK-LEDGER-0002 all task cards';
    const ledgerQueue = await runNext(['--cwd', tempRoot, '--prompt', ledgerPrompt]);
    assert(ledgerQueue.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_QUEUE_READY'), 'ledger task prompt must create a queue');
    const ledgerClaim = await runNext(['--cwd', tempRoot, '--claim', '--actor', 'prompt-scope-test', '--prompt', ledgerPrompt]);
    assert(ledgerClaim.ok === true, 'next --claim must claim the queue head for ledger tasks');
    assert((ledgerClaim.evidence.taskDirectionLock as any)?.schemaId === 'atm.taskDirectionLock.v1', 'next --claim must persist atm.taskDirectionLock.v1');
    assert((ledgerClaim.evidence.batchRun as any)?.schemaId === 'atm.batchRun.v1', 'batch claim must persist atm.batchRun.v1');
    const lockPath = path.join(tempRoot, '.atm', 'runtime', 'locks', 'TASK-LEDGER-0001.lock.json');
    assert(existsSync(lockPath), 'direction lock must be embedded in the runtime lock file');
    const lockDocument = JSON.parse(readFileSync(lockPath, 'utf8'));
    assert(lockDocument.taskDirectionLock?.taskId === 'TASK-LEDGER-0001', 'runtime lock must include the selected task direction lock');
    const batchStatus = await runBatch(['status', '--cwd', tempRoot, '--actor', 'prompt-scope-test', '--json']);
    assert((batchStatus.evidence.batchRun as any)?.currentTaskId === 'TASK-LEDGER-0001', 'batch status must point at the claimed queue head');

    writeLedgerTask(path.join(ledgerTaskDir, 'SANGUO-BOOTSTRAP-0001.json'), 'SANGUO-BOOTSTRAP-0001', 'Running Sanguo bootstrap task', 'docs/sanguo.md', {
      status: 'running',
      claimActorId: 'prompt-scope-test'
    });
    const runningExact = await runNext(['--cwd', tempRoot, '--prompt', 'SANGUO-BOOTSTRAP-0001']);
    assert(runningExact.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_ROUTE_READY'), 'exact task id prompt must route to a running task with active claim');
    assert((runningExact.evidence.nextAction as any).selectedTask.workItemId === 'SANGUO-BOOTSTRAP-0001', 'exact running task prompt selected wrong task');
    const runningClaim = await runNext(['--cwd', tempRoot, '--claim', '--actor', 'prompt-scope-test', '--prompt', 'SANGUO-BOOTSTRAP-0001']);
    assert(runningClaim.ok === true, 'next --claim must reuse an active claim for a running task');
    assert((runningClaim.evidence.claimPreparation as any)?.reusedActiveClaim === true, 'running task claim should be reported as reused active claim');
    assert((runningClaim.evidence.taskDirectionLock as any)?.taskId === 'SANGUO-BOOTSTRAP-0001', 'running task claim must still write a direction lock');
    const runningAllowedFiles = (runningClaim.evidence.taskDirectionLock as any)?.allowedFiles ?? [];
    assert(runningAllowedFiles.includes('docs/sanguo.md'), 'direction lock allowedFiles must preserve real task paths');
    assert(!runningAllowedFiles.some((entry: string) => entry.includes('human gate')), 'direction lock allowedFiles must not include natural-language acceptance text');

    const ambiguous = await runNext(['--cwd', tempRoot, '--prompt', 'Please do the next task card']);
    assert(ambiguous.ok === false, 'ambiguous task-card prompt must not route as ok');
    assert(ambiguous.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_SELECTION_REQUIRED'), 'ambiguous task-card prompt must ask for task selection');

    const nonTaskPrompt = await runNext(['--cwd', tempRoot, '--prompt', 'Please show onboarding guidance']);
    assert(nonTaskPrompt.messages.some((entry) => entry.code === 'ATM_NEXT_PROMPT_GUIDANCE_REQUIRED'), 'non-task prompt must route to prompt-scoped guidance');

    const scopedNotFound = await runNext(['--cwd', tempRoot, '--prompt', 'ATM framework 100% self atomization plan implement all task cards']);
    assert(scopedNotFound.ok === false, 'explicit scoped prompt without matching tasks must not route to an unrelated task');
    assert(scopedNotFound.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_SCOPE_NOT_FOUND'), 'explicit scoped prompt without matching tasks must report task scope not found');

    const noPrompt = await runNext(['--cwd', tempRoot]);
    const importedTaskQueue = noPrompt.evidence.importedTaskQueue as { selectedTask?: unknown };
    assert(importedTaskQueue.selectedTask == null, 'next without prompt must not auto-pick a global open/planned task');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function writeTaskCard(filePath: string, taskId: string, title: string) {
  writeFileSync(filePath, `---
task_id: ${taskId}
title: ${title}
status: planned
target_repo: AI-Atomic-Framework
closure_authority: target_repo
---
# ${taskId}
`, 'utf8');
}

function writeLedgerTask(filePath: string, taskId: string, title: string, scopePath: string, options: { readonly status?: string; readonly claimActorId?: string } = {}) {
  writeFileSync(filePath, `${JSON.stringify({
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: taskId,
    title,
    status: options.status ?? 'ready',
    dependencies: [],
    acceptance: ['bootstrap output reviewed by human gate'],
    scope: [scopePath],
    ...(options.claimActorId ? {
      claim: {
        actorId: options.claimActorId,
        leaseId: `lease-${taskId.toLowerCase()}`,
        claimedAt: '2026-05-24T00:00:00.000Z',
        heartbeatAt: '2026-05-24T00:00:00.000Z',
        ttlSeconds: 1800,
        files: [scopePath],
        state: 'active'
      }
    } : {}),
    source: {
      planPath: 'docs/plan/PlanAlpha.md',
      sectionTitle: title,
      headingLine: 1,
      hash: taskId
    }
  }, null, 2)}\n`, 'utf8');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
