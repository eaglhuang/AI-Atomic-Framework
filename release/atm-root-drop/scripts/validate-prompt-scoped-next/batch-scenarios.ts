import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBatch } from '../../packages/cli/src/commands/batch.ts';
import { runNext } from '../../packages/cli/src/commands/next.ts';
import { runQuickfix } from '../../packages/cli/src/commands/quickfix.ts';
import { runTasks } from '../../packages/cli/src/commands/tasks.ts';
import { runTeam } from '../../packages/cli/src/commands/team.ts';
import { listActiveBatchRuns } from '../../packages/cli/src/commands/work-channels.ts';
import { assert, assertDecisionTrail, assertRunnerMode, assertTeamRecommendation, runGit } from './assertions.ts';
import { writeLedgerTask, writeTaskCard } from './writers.ts';

export async function runBatchScenarios(ctx: any) {
  const { tempRoot, ledgerTaskDir } = ctx;
  const ledgerPrompt = 'TASK-LEDGER-0001 TASK-LEDGER-0002 all task cards';
    const ledgerQueue = await runNext(['--cwd', tempRoot, '--prompt', ledgerPrompt]);
    assert(ledgerQueue.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_QUEUE_READY'), 'ledger task prompt must create a queue');
    assert((ledgerQueue.evidence.nextAction as any).batchInstruction?.includes('batch checkpoint'), 'batch route must explicitly point agents to batch checkpoint');
    assert((ledgerQueue.evidence.nextAction as any).playbook?.channel === 'batch', 'batch route must include an executable batch playbook');
    assert((ledgerQueue.evidence.nextAction as any).playbook?.commitTiming?.includes('after batch checkpoint'), 'batch playbook must tell agents not to commit before checkpoint');
    assert(ledgerQueue.messages.some((entry) => entry.code === 'ATM_CHANNEL_PLAYBOOK_REQUIRED'), 'batch route must emit the channel playbook as a warning message');
    assert((ledgerQueue.evidence.nextAction as any).playbook?.state === 'queue-preview', 'batch queue preview must mark the playbook as queue-preview');
    const ledgerClaim = await runNext(['--cwd', tempRoot, '--claim', '--actor', 'prompt-scope-test', '--prompt', ledgerPrompt]);
    assert(ledgerClaim.ok === true, 'next --claim must claim the queue head for ledger tasks');
    assert(ledgerClaim.messages.some((entry) => entry.code === 'ATM_TASK_DELIVERY_PRINCIPLE'), 'next --claim must remind agents that the claimed task must be delivered before closure');
    assert((ledgerClaim.evidence.taskDirectionLock as any)?.schemaId === 'atm.taskDirectionLock.v1', 'next --claim must persist atm.taskDirectionLock.v1');
    assert((ledgerClaim.evidence.nextAction as any).playbook?.state === 'queue-head-active', 'claimed batch route must mark the playbook as queue-head-active');
    assert((ledgerClaim.evidence.nextAction as any).deliveryPrinciple?.notAllowedAsCompletion?.some((entry: string) => entry.includes('.atm/history')), 'next --claim delivery principle must reject ledger-only completion');
    assert((ledgerClaim.evidence.batchRun as any)?.schemaId === 'atm.batchRun.v1', 'batch claim must persist atm.batchRun.v1');
    const ledgerClaimTrail = assertDecisionTrail(ledgerClaim.evidence.nextAction as any, 'claimed batch route');
    assert(ledgerClaimTrail.some((entry) => entry.check === 'task-direction-lock' && entry.result === 'pass'), 'claimed route decisionTrail must record task direction lock evidence');
    const ledgerBatchId = (ledgerClaim.evidence.batchRun as any)?.batchId;
    assert(typeof ledgerBatchId === 'string' && ledgerBatchId.length > 0, 'batch claim must return a stable batchId');
    const lockPath = path.join(tempRoot, '.atm', 'runtime', 'locks', 'TASK-LEDGER-0001.lock.json');
    assert(existsSync(lockPath), 'direction lock must be embedded in the runtime lock file');
    const lockDocument = JSON.parse(readFileSync(lockPath, 'utf8'));
    assert(lockDocument.taskDirectionLock?.taskId === 'TASK-LEDGER-0001', 'runtime lock must include the selected task direction lock');
    assert(lockDocument.taskDirectionLock?.batchId === ledgerBatchId, 'direction lock must carry the batchId');
    const batchStatus = await runBatch(['status', '--cwd', tempRoot, '--actor', 'prompt-scope-test', '--json']);
    assert((batchStatus.evidence.batchRun as any)?.currentTaskId === 'TASK-LEDGER-0001', 'batch status must point at the claimed queue head');
    const compactBatchStatus = await runBatch(['current', '--cwd', tempRoot, '--batch', ledgerBatchId, '--compact', '--json']);
    assert((compactBatchStatus.evidence.current as any)?.schemaId === 'atm.batchCurrent.v1', 'batch current --compact must return the compact current schema');
    assert((compactBatchStatus.evidence.current as any)?.currentTaskId === 'TASK-LEDGER-0001', 'compact batch current must point at the queue head');
    assert(Array.isArray((compactBatchStatus.evidence.current as any)?.allowedFiles), 'compact batch current must include allowedFiles');
    assert((compactBatchStatus.evidence as any).batchRun === undefined, 'compact batch current must omit the full batchRun payload');
    assert((compactBatchStatus.evidence as any).taskQueue === undefined, 'compact batch current must omit the full taskQueue payload');
    assert(String((compactBatchStatus.evidence.current as any)?.commands?.checkpoint ?? '').includes(`--batch ${ledgerBatchId}`), 'compact batch current must include a batch-specific checkpoint command');
    const activeBatchExact = await runNext(['--cwd', tempRoot, '--prompt', 'TASK-LEDGER-0002']);
    assert(activeBatchExact.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_QUEUE_READY'), 'exact task id inside an active batch must stay in queue routing');
    assert((activeBatchExact.evidence.nextAction as any).recommendedChannel === 'batch', 'exact task id inside an active batch must recommend batch channel');
    assert((activeBatchExact.evidence.nextAction as any).queueHeadTaskId === 'TASK-LEDGER-0001', 'active batch exact route must still point at the current queue head');
    assert(String((activeBatchExact.evidence.nextAction as any).requiredCommand ?? '').includes(ledgerPrompt), 'active batch exact route must redirect claim back to the original batch prompt');
    const activeBatchFamily = await runNext(['--cwd', tempRoot, '--prompt', 'Please continue remaining LEDGER task cards one by one']);
    assert(activeBatchFamily.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_QUEUE_READY'), 'alternate same-family prompt inside an active batch must stay in queue routing');
    assert((activeBatchFamily.evidence.nextAction as any).queueHeadTaskId === 'TASK-LEDGER-0001', 'alternate same-family prompt must keep the active batch queue head');
    assert(String((activeBatchFamily.evidence.nextAction as any).requiredCommand ?? '').includes(ledgerPrompt), 'alternate same-family prompt must redirect claim back to the original batch prompt');
    const activeBatchClaim = await runNext(['--cwd', tempRoot, '--claim', '--actor', 'prompt-scope-test', '--prompt', 'TASK-LEDGER-0002']);
    assert((activeBatchClaim.evidence.nextAction as any).selectedTask.workItemId === 'TASK-LEDGER-0001', 'active batch next --claim must claim the current queue head, not the later exact task prompt');
    assert((activeBatchClaim.evidence.nextAction as any).recommendedChannel === 'batch', 'active batch next --claim must stay in batch channel');
    let directBatchCloseBlocked = false;
    try {
      await runTasks(['close', '--cwd', tempRoot, '--task', 'TASK-LEDGER-0001', '--actor', 'prompt-scope-test', '--status', 'done']);
    } catch (error) {
      directBatchCloseBlocked = (error as { code?: string }).code === 'ATM_BATCH_CHECKPOINT_REQUIRED';
    }
    assert(directBatchCloseBlocked, 'active batch queue head must be closed through batch checkpoint, not direct tasks close');
    let directLaterBatchCloseBlocked = false;
    try {
      await runTasks(['close', '--cwd', tempRoot, '--task', 'TASK-LEDGER-0002', '--actor', 'prompt-scope-test', '--status', 'done']);
    } catch (error) {
      directLaterBatchCloseBlocked = (error as { code?: string }).code === 'ATM_BATCH_CHECKPOINT_REQUIRED';
    }
    assert(directLaterBatchCloseBlocked, 'later tasks inside an active batch must also be closed through batch checkpoint, not direct tasks close');
    const batchRunPath = path.join(tempRoot, '.atm', 'runtime', 'batch-runs', `${ledgerBatchId}.json`);
    const corruptedBatchRun = JSON.parse(readFileSync(batchRunPath, 'utf8'));
    corruptedBatchRun.taskIds = ['TASK-LEDGER-0002'];
    corruptedBatchRun.currentIndex = 0;
    corruptedBatchRun.currentTaskId = 'TASK-LEDGER-0002';
    writeFileSync(batchRunPath, `${JSON.stringify(corruptedBatchRun, null, 2)}\n`, 'utf8');
    const brokenBatchStatus = await runBatch(['status', '--cwd', tempRoot, '--json']);
    assert(brokenBatchStatus.ok === false, 'batch status must fail when batch-run and task-queue disagree');
    assert(brokenBatchStatus.messages.some((entry) => entry.code === 'ATM_BATCH_STATE_REPAIR_REQUIRED'), 'broken batch status must require repair');
    const brokenBatchNext = await runNext(['--cwd', tempRoot, '--prompt', 'TASK-LEDGER-0002']);
    assert(brokenBatchNext.ok === false, 'next must not continue through an inconsistent active batch');
    assert(brokenBatchNext.messages.some((entry) => entry.code === 'ATM_BATCH_STATE_REPAIR_REQUIRED'), 'next must return the batch repair route when runtime is inconsistent');
    assert((brokenBatchNext.evidence.nextAction as any).playbook?.state === 'repair-required', 'repair route must mark the playbook as repair-required');
    const repairBatch = await runBatch(['repair', '--cwd', tempRoot, '--actor', 'prompt-scope-test', '--batch', ledgerBatchId, '--json']);
    assert(repairBatch.ok === true, 'batch repair must succeed for a queue-backed inconsistent batch');
    assert((repairBatch.evidence.after as any)?.taskIds?.includes('TASK-LEDGER-0001'), 'batch repair must restore the full task queue task list');
    assert((repairBatch.evidence.after as any)?.currentTaskId === 'TASK-LEDGER-0001', 'batch repair must restore the queue head as current task');

    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-RANGE-0001.json'), 'TASK-RANGE-0001', 'Range first task', 'docs/range-one.md');
    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-RANGE-0002.json'), 'TASK-RANGE-0002', 'Range second task', 'docs/range-two.md');
    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-RANGE-0003.json'), 'TASK-RANGE-0003', 'Range third task', 'docs/range-three.md');
    const explicitRangeClaim = await runNext([
      '--cwd', tempRoot,
      '--claim',
      '--actor', 'prompt-scope-test',
      '--prompt', 'complete selected range',
      '--tasks', 'TASK-RANGE-0003,TASK-RANGE-0001,TASK-RANGE-0002'
    ]);
    const rangeBatch = (explicitRangeClaim.evidence.batchRun as any) ?? {};
    assert(rangeBatch.currentTaskId === 'TASK-RANGE-0003', 'explicit --tasks batch must preserve the caller supplied order');
    assert(JSON.stringify(rangeBatch.taskIds) === JSON.stringify(['TASK-RANGE-0003', 'TASK-RANGE-0001', 'TASK-RANGE-0002']), 'explicit --tasks taskIds must be frozen in order');
    const activeBatchesAfterRangeClaim = listActiveBatchRuns(tempRoot);
    assert(activeBatchesAfterRangeClaim.length >= 2, `explicit --tasks claim must coexist with the existing ledger batch, got ${activeBatchesAfterRangeClaim.map((entry) => entry.batchId).join(',')}`);
    const multiBatchStatus = await runBatch(['status', '--cwd', tempRoot, '--json']);
    assert(multiBatchStatus.ok === false, 'batch status without selector must not guess when multiple active batches exist');
    assert(multiBatchStatus.messages.some((entry) => entry.code === 'ATM_BATCH_SELECTION_REQUIRED'), 'multiple active batches must require --batch or --scope selection');
    const compactMultiBatchStatus = await runBatch(['current', '--cwd', tempRoot, '--compact', '--json']);
    assert(compactMultiBatchStatus.ok === false, 'compact batch current without selector must not guess when multiple active batches exist');
    assert((compactMultiBatchStatus.evidence as any).compact === true, 'compact multi-batch selection response must stay compact');
    assert(Array.isArray((compactMultiBatchStatus.evidence as any).candidates), 'compact multi-batch selection response must list compact candidates');
    assert((compactMultiBatchStatus.evidence as any).activeBatches === undefined, 'compact multi-batch selection response must omit full activeBatches');
    assert((compactMultiBatchStatus.evidence as any).candidates.every((entry: any) => Array.isArray(entry.taskIds) === false), 'compact candidates must not include full task id arrays');
    const selectedRangeStatus = await runBatch(['status', '--cwd', tempRoot, '--batch', rangeBatch.batchId, '--json']);
    assert((selectedRangeStatus.evidence.batchRun as any)?.currentTaskId === 'TASK-RANGE-0003', 'batch status --batch must select the requested batch');
    await runBatch(['abandon', '--cwd', tempRoot, '--actor', 'prompt-scope-test', '--batch', rangeBatch.batchId, '--json']);
    const rangeAfterAbandon = await runNext(['--cwd', tempRoot, '--prompt', 'TASK-RANGE-0002']);
    assert(rangeAfterAbandon.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_ROUTE_READY'), 'abandoned batch queue must not be reused by exact task routing');
    assert((rangeAfterAbandon.evidence.nextAction as any).recommendedChannel === 'normal', 'abandoned batch queue must not keep exact task prompts in batch mode');

}
