import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { createWaveManifest, evaluateWaveEligibility, type WaveManifestTask } from '../../../../core/src/broker/wave-manifest.ts';
import { evaluateAtomicWaveCheckpoint } from '../../../../core/src/broker/wave-generated-executor.ts';
import { CliError, makeResult, message, parseOptions } from '../shared.ts';
import { resolveActorId } from '../actor-registry.ts';
import { runNext } from '../next.ts';
import { runTasks } from '../tasks.ts';
import { abandonTaskQueue, advanceTaskQueueHead, findActiveTaskQueue, partitionTaskScope, restoreTaskQueueHead,
type TaskDirectionTask,
type TaskQueueRecord } from '../task-direction.ts';
import { activeBatchSelectionStatus, inspectBatchRunConsistency, isPathAllowedByScope, listActiveBatchRuns, readActiveBatchRun, releaseBatchRun, repairBatchRunFromQueue, updateBatchRun, writeBatchTaskAuditEvent,
type BatchRunRecord,
type BatchSkippedTaskRecord } from '../work-channels.ts';
import { evaluateBatchTeamAdmission,
type BatchTeamAdmissionDecision } from '../team.ts';
export type BatchTeamAttemptUsage = { readonly inputTokens?: number; readonly outputTokens?: number; readonly cacheReadTokens?: number; readonly fullyLoadedCostUsd?: number; readonly retry?: boolean; readonly discarded?: boolean; };
export type BatchTeamIntegrationReport = { readonly schemaId: 'atm.batchTeamIntegrationReport.v1'; readonly taskId: string; readonly batchId: string; readonly sealedClose: { readonly usesSealAndCommitTransaction: true; readonly checkpointRefusesPayloadMismatch: true; readonly payloadDigestMatchesEvidence: boolean; };
readonly teamAdmission: BatchTeamAdmissionDecision; readonly usage: { readonly attemptCount: number; readonly retryCount: number; readonly discardedContributionCount: number; readonly inputTokens: number; readonly outputTokens: number; readonly cacheReadTokens: number; readonly fullyLoadedCostUsd: number; };
readonly latency: { readonly queueHeadLatencyMs: number; readonly batchMakespanMs: number; readonly throughputPerMinute: number; readonly throughputIsSingleTaskLatency: false; };
readonly stopLoss: { readonly triggered: boolean; readonly laterQueueHeadRoute: 'unchanged' | 'cheaper-qualified-model-mix' | 'single-agent'; readonly closeSemanticsChanged: false; };
};
type BatchTeamUsageAggregate = BatchTeamIntegrationReport['usage'];
export async function runBatch(argv: string[]) {
const action = String(argv[0] ?? 'status').toLowerCase();
const batchHistoricalDeliveryRefs = action === 'checkpoint' ? parseBatchHistoricalDeliveryRefs(argv) : [];
const batchHistoricalBatchRefs = action === 'checkpoint' ? parseBatchHistoricalBatchRefs(argv) : [];
const batchDeliverAndCloseExtras = action === 'deliver-and-close' ? parseBatchDeliverAndCloseExtras(argv) : null;
const checkpointReadinessInput = action === 'checkpoint-readiness' ? parseBatchCheckpointReadinessArgs(argv) : null;
const autoBatch = parseAutoBatchControls(argv);
const { options } = parseOptions( action === 'checkpoint' ? stripBatchCheckpointCloseArgs(argv) : action === 'deliver-and-close' ? stripBatchDeliverAndCloseExtras(argv) : action === 'checkpoint-readiness' ? stripBatchCheckpointReadinessArgs(argv) : stripAutoBatchArgs(argv), 'batch' ); if (action === 'status' || action === 'current') {
const selector = buildBatchSelector(options);
const compact = options.compact === true || action === 'current';
const selection = Object.keys(selector).length > 0 ? activeBatchSelectionStatus(options.cwd, selector) : activeBatchSelectionStatus(options.cwd);
const allActiveBatches = listActiveBatchRuns(options.cwd);
const batchRun = selection.batchRun;
const taskQueue = batchRun ? findActiveTaskQueue(options.cwd, batchRun.sourcePrompt, { batchId: batchRun.batchId }) : null;
const consistency = inspectBatchRunConsistency(batchRun, taskQueue);
const pendingCommitWindow = batchRun ? buildPendingCheckpointCommitWindow(options.cwd, batchRun, taskQueue) : null; if (!selection.ok && allActiveBatches.length > 1 && Object.keys(selector).length === 0) { if (compact) { return makeResult({ ok: false, command: 'batch', cwd: options.cwd,
messages: [message('error', 'ATM_BATCH_SELECTION_REQUIRED', 'Multiple active batch runs exist; choose one with --batch <batchId> or --scope <scopeKey>.', { activeBatchCount: allActiveBatches.length, candidates: allActiveBatches.map(toCompactBatchCandidate) })], evidence: { action, compact: true, activeBatchCount: allActiveBatches.length, candidates: allActiveBatches.map(toCompactBatchCandidate),
requiredCommand: 'node atm.mjs batch current --batch <batchId> --compact --json' }
});
}
return makeResult({ ok: false, command: 'batch', cwd: options.cwd, messages: [message('error', 'ATM_BATCH_SELECTION_REQUIRED', 'Multiple active batch runs exist; choose one with --batch <batchId> or --scope <scopeKey>.', { activeBatches: allActiveBatches.map(toBatchCandidate) })], evidence: { action: 'status', activeBatches: allActiveBatches, selection }
});
}
if (compact) {
const compactStatus = buildCompactBatchStatus(options.cwd, batchRun, taskQueue, consistency, allActiveBatches.length, pendingCommitWindow, autoBatch); return makeResult({ ok: consistency.ok, command: 'batch', cwd: options.cwd, messages: [consistency.ok ? message('info', 'ATM_BATCH_CURRENT', batchRun ? 'Current batch queue head resolved.' : 'No active batch run found.', { active: Boolean(batchRun),
batchId: batchRun?.batchId ?? null, currentTaskId: batchRun?.currentTaskId ?? null, pendingCommitTaskId: pendingCommitWindow?.taskId ?? null, checkpointCommand: batchRun ? `node atm.mjs batch checkpoint --actor <id> --batch ${batchRun.batchId} --json` : null })
: message('error', 'ATM_BATCH_STATE_REPAIR_REQUIRED', 'Active batch runtime is inconsistent and must be repaired before continuing.', { active: Boolean(batchRun), batchHeadTaskId: consistency.batchHeadTaskId, queueHeadTaskId: consistency.queueHeadTaskId, reason: consistency.reason, requiredCommand: batchRun ? `node atm.mjs batch repair --actor <id> --batch ${batchRun.batchId} --json`
: 'node atm.mjs batch repair --actor <id> --json' })], evidence: { action, compact: true, current: compactStatus }
});
}
return makeResult({ ok: consistency.ok, command: 'batch', cwd: options.cwd, messages: [consistency.ok ? message('info', 'ATM_BATCH_STATUS', batchRun ? 'Active batch run found.' : 'No active batch run found.', { active: Boolean(batchRun), batchId: batchRun?.batchId ?? null, scopeKey: batchRun?.scopeKey ?? null, currentTaskId: batchRun?.currentTaskId ?? null, activeBatchCount: allActiveBatches.length,
pendingCommitTaskId: pendingCommitWindow?.taskId ?? null, pendingCommitCommand: pendingCommitWindow?.commitCommand ?? null })
: message('error', 'ATM_BATCH_STATE_REPAIR_REQUIRED', 'Active batch runtime is inconsistent and must be repaired before continuing.', { active: Boolean(batchRun), batchHeadTaskId: consistency.batchHeadTaskId, queueHeadTaskId: consistency.queueHeadTaskId, reason: consistency.reason, requiredCommand: 'node atm.mjs batch repair --actor <id> --json' })], evidence: { action: 'status', batchRun,
activeBatches: allActiveBatches, taskQueue, pendingCommitWindow, consistency, dirtyFileSummary: readGitDirtyFileSummary(options.cwd) }
});
}
if (action === 'checkpoint-readiness') {
if (!checkpointReadinessInput?.waveId || !checkpointReadinessInput.manifestDigest || checkpointReadinessInput.taskIds.length === 0) { throw new CliError('ATM_CLI_USAGE', 'batch checkpoint-readiness requires --wave <id>, --manifest-digest <digest>, and at least one --task <id>.', { exitCode: 2 }); }
const deliveryReceipts = checkpointReadinessInput.deliveryReceipts.map((filePath) => JSON.parse(readFileSync(path.resolve(options.cwd, filePath), 'utf8')));
const buildReceipts = checkpointReadinessInput.buildReceipts.map((filePath) => JSON.parse(readFileSync(path.resolve(options.cwd, filePath), 'utf8')));
const projectionReceipts = checkpointReadinessInput.projectionReceipts.map((filePath) => JSON.parse(readFileSync(path.resolve(options.cwd, filePath), 'utf8')));
const readiness = evaluateAtomicWaveCheckpoint({ waveId: checkpointReadinessInput.waveId, taskIds: checkpointReadinessInput.taskIds, manifestDigest: checkpointReadinessInput.manifestDigest, deliveryReceipts, buildReceipts, projectionReceipts, planningClosebackOk: checkpointReadinessInput.planningClosebackOk });
return makeResult({ ok: readiness.ready, command: 'batch', cwd: options.cwd, messages: [message(readiness.ready ? 'info' : 'error', readiness.ready ? 'ATM_BATCH_WAVE_CHECKPOINT_READY' : 'ATM_BATCH_WAVE_CHECKPOINT_BLOCKED', readiness.ready ? 'Atomic wave checkpoint has all required commit/build/projection receipts.' : 'Atomic wave checkpoint is missing required receipts or planning closeback.', { waveId: readiness.waveId, missingByTask: readiness.missingByTask, planningCloseback: readiness.planningCloseback })], evidence: { action: 'checkpoint-readiness', readiness } });
}
const resolvedActor = resolveActorId(options.agent ?? undefined); if (!resolvedActor) { throw new CliError('ATM_ACTOR_ID_MISSING', `batch ${action} requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).`, { exitCode: 2 }); }
if (action === 'checkpoint') {
const holdNextClaim = options.hold === true;
const active = selectRequiredBatch(options.cwd, buildBatchSelector(options), resolvedActor.actorId, action); if (!active) { throw new CliError('ATM_BATCH_RUN_MISSING', 'batch checkpoint requires an active batch run. Start with next --claim on a batch-scoped prompt; batch is for delivering each queue item, not for bulk-closing task cards.', { exitCode: 2 }); }
const consistencyQueue = findActiveTaskQueue(options.cwd, active.sourcePrompt, { batchId: active.batchId });
const consistency = inspectBatchRunConsistency(active, consistencyQueue); if (!consistency.ok) { throw new CliError('ATM_BATCH_STATE_REPAIR_REQUIRED', 'batch checkpoint cannot continue because batch-run and task-queue runtime disagree.', { exitCode: 1, details: { batchId: active.batchId, reason: consistency.reason, batchHeadTaskId: consistency.batchHeadTaskId, queueHeadTaskId: consistency.queueHeadTaskId,
requiredCommand: `node atm.mjs batch repair --actor ${resolvedActor.actorId} --batch ${active.batchId} --json` }
});
}
const currentTaskId = active.currentTaskId; if (!currentTaskId) {
const completed = releaseBatchRun(options.cwd, active, 'completed'); return makeResult({ ok: true, command: 'batch', cwd: options.cwd, messages: [message('info', 'ATM_BATCH_COMPLETED', 'Batch run is already completed.', { batchId: completed.batchId, scopeKey: completed.scopeKey })], evidence: { action: 'checkpoint', batchRun: completed }
});
}
const capturedHeadBeforeClose = readGitHead(options.cwd);
const closeResult = await runTasks([ 'close', '--cwd', options.cwd, '--task', currentTaskId, '--actor', resolvedActor.actorId, '--status', 'done', '--from-batch-checkpoint', '--batch', active.batchId, ...batchHistoricalDeliveryRefs.flatMap((ref) => ['--historical-delivery', ref]), ...batchHistoricalBatchRefs.flatMap((ref) => ['--historical-batch', ref]), '--json' ]); if (!closeResult.ok) {
const closeCategory = categorizeCheckpointCloseFailure(closeResult, currentTaskId, resolvedActor.actorId); return makeResult({ ok: false, command: 'batch', cwd: options.cwd, messages: [message('error', 'ATM_BATCH_CHECKPOINT_CLOSE_FAILED', closeCategory.tldr ?? `Batch checkpoint could not close task ${currentTaskId}; resolve the issue and retry.`, { batchId: active.batchId, closedTaskId: currentTaskId,
category: closeCategory.category, reason: closeCategory.reason, requiredCommand: closeCategory.requiredCommand, tldr: closeCategory.tldr, missingValidationPasses: closeCategory.missingValidationPasses, blockingFindings: closeCategory.blockingFindings })], evidence: { action: 'checkpoint', actorId: resolvedActor.actorId, closedTaskId: currentTaskId, held: holdNextClaim,
historicalDeliveryRefs: batchHistoricalDeliveryRefs, historicalBatchRefs: batchHistoricalBatchRefs, closeHeadCapture: { schemaId: 'atm.batchCheckpointHeadCapture.v1', taskId: currentTaskId, batchId: active.batchId, headBeforeClose: capturedHeadBeforeClose, headAfterClose: readGitHead(options.cwd) }, closeResult: closeResult.evidence, failureCategory: closeCategory }
});
}
let cleanupResult: unknown = null; try { cleanupResult = await runTasks([ 'lock', 'cleanup', '--cwd', options.cwd, '--task', currentTaskId, '--actor', resolvedActor.actorId, '--reason', 'batch checkpoint cleanup', '--json' ]); } catch { cleanupResult = null; }
const queue = findActiveTaskQueue(options.cwd, active.sourcePrompt, { batchId: active.batchId });
const nextTaskId = queue?.taskIds[queue.currentIndex] ?? null;
const updated = updateBatchRun(options.cwd, active, { currentIndex: queue?.currentIndex ?? active.currentIndex, currentTaskId: nextTaskId, pendingCommitTaskId: currentTaskId, status: queue?.status === 'completed' || !nextTaskId ? 'completed' : 'active', hold: holdNextClaim && nextTaskId ? { schemaId: 'atm.batchHold.v1', status: 'held', afterTaskId: currentTaskId, currentTaskId: nextTaskId,
heldByActor: resolvedActor.actorId, heldAt: new Date().toISOString(), resumeCommand: `node atm.mjs batch resume --actor ${resolvedActor.actorId} --batch ${active.batchId} --json` }
: null });
const nextClaim = updated.status === 'active' && !holdNextClaim ? await runNext(['--cwd', options.cwd, '--claim', '--actor', resolvedActor.actorId, '--prompt', active.sourcePrompt, '--json']) : null; if (updated.status === 'completed') { releaseBatchRun(options.cwd, updated, 'completed'); }
const totalTasks = updated.taskIds?.length ?? 0;
const currentIndex = updated.currentIndex ?? 0;
const remainingTasks = updated.status === 'completed' ? 0 : Math.max(0, totalTasks - currentIndex);
const isBatchComplete = updated.status === 'completed';
const isPartialOk = !isBatchComplete && !holdNextClaim;
const primaryCode = isPartialOk ? 'ATM_BATCH_CHECKPOINT_PARTIAL_OK' : 'ATM_BATCH_CHECKPOINT_OK';
const primaryText = isBatchComplete ? 'Batch checkpoint closed the final task and completed the batch run.' : holdNextClaim ? 'Batch checkpoint closed the current task and held before claiming the next queue head.' : `Batch checkpoint closed task ${currentTaskId}; ${remainingTasks} task(s) remain — batch is NOT yet complete.`; return makeResult({ ok: true, command: 'batch', cwd: options.cwd,
messages: [message('info', primaryCode, primaryText, { batchId: updated.batchId, closedTaskId: currentTaskId, nextTaskId: updated.currentTaskId, held: holdNextClaim, category: isBatchComplete ? 'batch-complete' : holdNextClaim ? 'held' : 'partial-ok', remainingTasks, totalTasks, batchComplete: isBatchComplete,
deliveryPrinciple: 'Batch speed comes from automated queue bookkeeping, not relaxed delivery. Each task still needs real non-.atm deliverables before checkpoint can close it.',
commitInstruction: `Checkpoint succeeded. Stage .atm/history/tasks/${currentTaskId}.json and .atm/history/task-events/${currentTaskId}/, then create one commit that contains the already staged deliverables, evidence, task file, and task events.`, continueInstruction: isBatchComplete ? 'Batch is complete after this checkpoint commit.' : holdNextClaim
? `Commit the closed task first, then resume with node atm.mjs batch resume --actor <id> --batch ${updated.batchId} --json or node atm.mjs next --claim --actor <id> --prompt "${updated.sourcePrompt}" --json.` : `This is a batch run. Do not switch to per-task normal flow. After this checkpoint commit, continue with ${updated.currentTaskId} using --batch ${updated.batchId}.`, requiredCommand: isPartialOk
? `node atm.mjs batch checkpoint --actor <id> --batch ${updated.batchId} --json` : null }), ...(isBatchComplete || holdNextClaim ? [] : [message('warning', 'ATM_BATCH_CONTEXT_ACTIVE', 'This is a batch run. Do not switch to per-task normal flow.', { batchId: updated.batchId, currentTaskId: updated.currentTaskId, requiredCommand: `node atm.mjs batch checkpoint --actor <id> --batch ${updated.batchId} --json` })])],
evidence: { action: 'checkpoint', actorId: resolvedActor.actorId, closedTaskId: currentTaskId, held: holdNextClaim, historicalDeliveryRefs: batchHistoricalDeliveryRefs, historicalBatchRefs: batchHistoricalBatchRefs, closeHeadCapture: { schemaId: 'atm.batchCheckpointHeadCapture.v1', taskId: currentTaskId, batchId: active.batchId, headBeforeClose: capturedHeadBeforeClose, headAfterClose: readGitHead(options.cwd) },
commitInstruction: { timing: 'single-commit-after-checkpoint', beforeCheckpoint: [ '<stage deliverables>', `.atm/history/evidence/${currentTaskId}.json` ], files: [ '<deliverables>', `.atm/history/tasks/${currentTaskId}.json`, `.atm/history/evidence/${currentTaskId}.json`, `.atm/history/task-events/${currentTaskId}/` ] }, closeResult: closeResult.evidence,
cleanupResult: (cleanupResult as { evidence?: unknown } | null)?.evidence ?? null, batchRun: updated, nextClaim: nextClaim?.evidence ?? null }
});
}
if (action === 'deliver-and-close') {
const holdNextClaim = options.hold === true;
const active = selectRequiredBatch(options.cwd, buildBatchSelector(options), resolvedActor.actorId, action); if (!active) { throw new CliError('ATM_BATCH_RUN_MISSING', 'batch deliver-and-close requires an active batch run. Start with next --claim on a batch-scoped prompt; batch deliver-and-close bundles the delivery commit, historical close, and governance commit into one command.', { exitCode: 2 }); }
const consistencyQueue = findActiveTaskQueue(options.cwd, active.sourcePrompt, { batchId: active.batchId });
const consistency = inspectBatchRunConsistency(active, consistencyQueue); if (!consistency.ok) { throw new CliError('ATM_BATCH_STATE_REPAIR_REQUIRED', 'batch deliver-and-close cannot continue because batch-run and task-queue runtime disagree.', { exitCode: 1, details: { batchId: active.batchId, reason: consistency.reason, batchHeadTaskId: consistency.batchHeadTaskId, queueHeadTaskId: consistency.queueHeadTaskId,
requiredCommand: `node atm.mjs batch repair --actor ${resolvedActor.actorId} --batch ${active.batchId} --json` }
});
}
const currentTaskId = active.currentTaskId; if (!currentTaskId) {
const completed = releaseBatchRun(options.cwd, active, 'completed'); return makeResult({ ok: true, command: 'batch', cwd: options.cwd, messages: [message('info', 'ATM_BATCH_COMPLETED', 'Batch run is already completed.', { batchId: completed.batchId, scopeKey: completed.scopeKey })], evidence: { action: 'deliver-and-close', batchRun: completed } });
}
const deliverAndCloseArgv: string[] = [ 'deliver-and-close', '--cwd', options.cwd, '--task', currentTaskId, '--actor', resolvedActor.actorId, '--from-batch-checkpoint', '--batch', active.batchId, '--json' ]; if (batchDeliverAndCloseExtras?.deliveryCommit) { deliverAndCloseArgv.push('--delivery-commit', batchDeliverAndCloseExtras.deliveryCommit); }
if (batchDeliverAndCloseExtras?.deliveryMessage) { deliverAndCloseArgv.push('--message', batchDeliverAndCloseExtras.deliveryMessage); }
if (batchDeliverAndCloseExtras?.reason) { deliverAndCloseArgv.push('--reason', batchDeliverAndCloseExtras.reason); }
const deliverResult = await runTasks(deliverAndCloseArgv); if (!deliverResult.ok) {
const deliverEvidence = deliverResult.evidence as Record<string, unknown>;
const phase = typeof deliverEvidence?.phase === 'string' ? deliverEvidence.phase : null;
const capturedDeliveryCommitSha = typeof deliverEvidence?.deliveryCommitSha === 'string' ? deliverEvidence.deliveryCommitSha : null; return makeResult({ ok: false, command: 'batch', cwd: options.cwd, messages: [ message('error', 'ATM_BATCH_DELIVER_AND_CLOSE_FAILED', phase === 'close-failed'
? `Batch deliver-and-close: close phase failed for task ${currentTaskId} after delivery commit was created at ${capturedDeliveryCommitSha}. Fix the close gate and retry.` : `Batch deliver-and-close: deliver phase failed for task ${currentTaskId}; resolve the issue and retry.`, { batchId: active.batchId, closedTaskId: currentTaskId, phase, deliveryCommitSha: capturedDeliveryCommitSha,
retryCommand: phase === 'close-failed' && capturedDeliveryCommitSha ? `node atm.mjs batch deliver-and-close --actor ${resolvedActor.actorId} --batch ${active.batchId} --delivery-commit ${capturedDeliveryCommitSha} --json` : `node atm.mjs batch deliver-and-close --actor ${resolvedActor.actorId} --batch ${active.batchId} --json` }), ...deliverResult.messages ], evidence: { action: 'deliver-and-close',
actorId: resolvedActor.actorId, closedTaskId: currentTaskId, deliverResult: deliverResult.evidence }
});
}
let cleanupResult: unknown = null; try { cleanupResult = await runTasks([ 'lock', 'cleanup', '--cwd', options.cwd, '--task', currentTaskId, '--actor', resolvedActor.actorId, '--reason', 'batch deliver-and-close cleanup', '--json' ]); } catch { cleanupResult = null; }
const deliverQueue = findActiveTaskQueue(options.cwd, active.sourcePrompt, { batchId: active.batchId });
const nextTaskId = deliverQueue?.taskIds[deliverQueue.currentIndex] ?? null;
const updated = updateBatchRun(options.cwd, active, { currentIndex: deliverQueue?.currentIndex ?? active.currentIndex, currentTaskId: nextTaskId, status: deliverQueue?.status === 'completed' || !nextTaskId ? 'completed' : 'active', hold: holdNextClaim && nextTaskId ? { schemaId: 'atm.batchHold.v1', status: 'held', afterTaskId: currentTaskId, currentTaskId: nextTaskId, heldByActor: resolvedActor.actorId,
heldAt: new Date().toISOString(), resumeCommand: `node atm.mjs batch resume --actor ${resolvedActor.actorId} --batch ${active.batchId} --json` }
: null });
const nextClaim = updated.status === 'active' && !holdNextClaim ? await runNext(['--cwd', options.cwd, '--claim', '--actor', resolvedActor.actorId, '--prompt', active.sourcePrompt, '--json']) : null; if (updated.status === 'completed') { releaseBatchRun(options.cwd, updated, 'completed'); }
const deliverEvidence = deliverResult.evidence as Record<string, unknown>;
const totalTasks = updated.taskIds?.length ?? 0;
const currentIndex = updated.currentIndex ?? 0;
const remainingTasks = updated.status === 'completed' ? 0 : Math.max(0, totalTasks - currentIndex);
const isBatchComplete = updated.status === 'completed';
const isPartialOk = !isBatchComplete && !holdNextClaim;
const primaryCode = isPartialOk ? 'ATM_BATCH_DELIVER_AND_CLOSE_PARTIAL_OK' : 'ATM_BATCH_DELIVER_AND_CLOSE_OK';
const primaryText = isBatchComplete ? `Batch deliver-and-close closed the final task ${currentTaskId} and completed the batch run.` : holdNextClaim ? `Batch deliver-and-close closed task ${currentTaskId} and held before claiming the next queue head.` : `Batch deliver-and-close closed task ${currentTaskId}; ${remainingTasks} task(s) remain — batch is NOT yet complete.`; return makeResult({ ok: true, command: 'batch',
cwd: options.cwd, messages: [ message('info', primaryCode, primaryText, { batchId: updated.batchId, closedTaskId: currentTaskId, nextTaskId: updated.currentTaskId, held: holdNextClaim, deliveryCommitSha: typeof deliverEvidence?.deliveryCommitSha === 'string' ? deliverEvidence.deliveryCommitSha : null, closureCommitSha: typeof deliverEvidence?.closureCommitSha === 'string' ? deliverEvidence.closureCommitSha : null,
category: isBatchComplete ? 'batch-complete' : holdNextClaim ? 'held' : 'partial-ok', remainingTasks, totalTasks, batchComplete: isBatchComplete, requiredCommand: isPartialOk ? `node atm.mjs batch deliver-and-close --actor ${resolvedActor.actorId} --batch ${updated.batchId} --json` : null }), ...(isPartialOk
? [message('warning', 'ATM_BATCH_CONTEXT_ACTIVE', 'This is a batch run. Do not switch to per-task normal flow.', { batchId: updated.batchId, currentTaskId: updated.currentTaskId, requiredCommand: `node atm.mjs batch deliver-and-close --actor ${resolvedActor.actorId} --batch ${updated.batchId} --json` })] : []) ], evidence: { action: 'deliver-and-close', actorId: resolvedActor.actorId, closedTaskId: currentTaskId,
nextTaskId: updated.currentTaskId, held: holdNextClaim, deliveryCommitSha: typeof deliverEvidence?.deliveryCommitSha === 'string' ? deliverEvidence.deliveryCommitSha : null, closureCommitSha: typeof deliverEvidence?.closureCommitSha === 'string' ? deliverEvidence.closureCommitSha : null, governanceFiles: Array.isArray(deliverEvidence?.governanceFiles) ? deliverEvidence.governanceFiles : [], cleanupResult,
batchRun: updated, nextClaim: nextClaim?.evidence ?? null }
});
}
if (action === 'skip') {
const taskId = typeof options.task === 'string' ? options.task.trim() : '';
const reason = typeof options.reason === 'string' ? options.reason.trim() : ''; if (!taskId) { throw new CliError('ATM_CLI_USAGE', 'batch skip requires --task <task-id>.', { exitCode: 2 }); }
if (!reason) { throw new CliError('ATM_BATCH_SKIP_REASON_REQUIRED', 'batch skip requires --reason <reason>; skip is a traceable pause, not success.', { exitCode: 2 }); }
const active = selectRequiredBatch(options.cwd, buildBatchSelector(options), resolvedActor.actorId, action); if (!active) { throw new CliError('ATM_BATCH_RUN_MISSING', 'batch skip requires an active batch run.', { exitCode: 2 }); }
const queue = findActiveTaskQueue(options.cwd, active.sourcePrompt, { batchId: active.batchId });
const consistency = inspectBatchRunConsistency(active, queue); if (!consistency.ok || !queue) { throw new CliError('ATM_BATCH_STATE_REPAIR_REQUIRED', 'batch skip cannot continue because batch-run and task-queue runtime disagree.', { exitCode: 1, details: { batchId: active.batchId, reason: consistency.reason, requiredCommand: `node atm.mjs batch repair --actor ${resolvedActor.actorId} --batch ${active.batchId} --json`
}
});
}
if (active.currentTaskId !== taskId) { throw new CliError('ATM_BATCH_SKIP_NOT_QUEUE_HEAD', `batch skip only applies to the current queue head (${active.currentTaskId ?? 'none'}).`, { exitCode: 2, details: { batchId: active.batchId, requestedTaskId: taskId, currentTaskId: active.currentTaskId, requiredCommand: `node atm.mjs batch current --batch ${active.batchId} --compact --json` }
});
}
if ((active.skippedTasks ?? []).some((entry) => entry.taskId === taskId)) { throw new CliError('ATM_BATCH_SKIP_ALREADY_RECORDED', `Task ${taskId} is already recorded as skipped in this batch run.`, { exitCode: 2, details: { batchId: active.batchId, resumeCommand: `node atm.mjs batch resume --task ${taskId} --batch ${active.batchId} --actor ${resolvedActor.actorId} --json` }
});
}
const skippedEntry: BatchSkippedTaskRecord = { schemaId: 'atm.batchSkippedTask.v1', taskId, reason, skippedByActor: resolvedActor.actorId, skippedAt: new Date().toISOString(), batchIndex: active.currentIndex, resumeCommand: `node atm.mjs batch resume --task ${taskId} --batch ${active.batchId} --actor ${resolvedActor.actorId} --json` };
const advancedQueue = advanceTaskQueueHead(options.cwd, taskId, { batchId: active.batchId, queueId: queue.queueId });
const nextTaskId = advancedQueue?.taskIds[advancedQueue.currentIndex] ?? null;
const updated = updateBatchRun(options.cwd, active, { currentIndex: advancedQueue?.currentIndex ?? active.currentIndex, currentTaskId: nextTaskId, status: advancedQueue?.status === 'completed' || !nextTaskId ? 'completed' : 'active', skippedTasks: [...(active.skippedTasks ?? []), skippedEntry], hold: null });
const auditEvent = writeBatchTaskAuditEvent({ cwd: options.cwd, taskId, action: 'batch-skip', actorId: resolvedActor.actorId, batchId: active.batchId, reason, batchIndex: skippedEntry.batchIndex });
const finalized = updated.status === 'completed' ? releaseBatchRun(options.cwd, updated, 'completed') : updated; return makeResult({ ok: true, command: 'batch', cwd: options.cwd, messages: [message('info', 'ATM_BATCH_TASK_SKIPPED', `Batch skipped ${taskId} with a recorded reason; the task was not closed as done.`, { batchId: finalized.batchId, skippedTaskId: taskId, nextTaskId: finalized.currentTaskId, reason,
resumeCommand: skippedEntry.resumeCommand, auditEventPath: auditEvent.eventPath })], evidence: { action: 'skip', actorId: resolvedActor.actorId, skippedTask: skippedEntry, batchRun: finalized, taskQueue: advancedQueue, auditEvent, auditSummary: buildBatchAuditSummary(finalized) }
});
}
if (action === 'repair' || action === 'resume') {
const active = selectRequiredBatch(options.cwd, buildBatchSelector(options), resolvedActor.actorId, action); if (!active) { throw new CliError('ATM_BATCH_RUN_MISSING', `batch ${action} requires an active batch run.`, { exitCode: 2 }); }
const resumeTaskId = typeof options.task === 'string' ? options.task.trim() : ''; if (action === 'resume' && resumeTaskId) {
const skippedEntry = (active.skippedTasks ?? []).find((entry) => entry.taskId === resumeTaskId) ?? null; if (!skippedEntry) { throw new CliError('ATM_BATCH_RESUME_TASK_NOT_SKIPPED', `Task ${resumeTaskId} is not recorded as skipped in batch ${active.batchId}.`, { exitCode: 2, details: { batchId: active.batchId, skippedTaskIds: (active.skippedTasks ?? []).map((entry) => entry.taskId),
requiredCommand: `node atm.mjs batch status --batch ${active.batchId} --compact --json` }
});
}
const restoredQueue = restoreTaskQueueHead(options.cwd, resumeTaskId, { batchId: active.batchId, queueId: active.queueId }); if (!restoredQueue) { throw new CliError('ATM_BATCH_RESUME_QUEUE_RESTORE_FAILED', `Could not restore queue head for skipped task ${resumeTaskId}.`, { exitCode: 1, details: { batchId: active.batchId,
requiredCommand: `node atm.mjs batch repair --actor ${resolvedActor.actorId} --batch ${active.batchId} --json` }
});
}
const resumed = updateBatchRun(options.cwd, active, { queueId: restoredQueue.queueId, currentIndex: restoredQueue.currentIndex, currentTaskId: resumeTaskId, status: 'active', skippedTasks: (active.skippedTasks ?? []).filter((entry) => entry.taskId !== resumeTaskId), hold: null });
const auditEvent = writeBatchTaskAuditEvent({ cwd: options.cwd, taskId: resumeTaskId, action: 'batch-resume', actorId: resolvedActor.actorId, batchId: active.batchId, reason: skippedEntry.reason, batchIndex: skippedEntry.batchIndex });
const nextClaim = await runNext(['--cwd', options.cwd, '--claim', '--actor', resolvedActor.actorId, '--prompt', resumed.sourcePrompt, '--json']); return makeResult({ ok: true, command: 'batch', cwd: options.cwd, messages: [message('info', 'ATM_BATCH_TASK_RESUMED', `Batch restored skipped task ${resumeTaskId} to the queue head.`, { batchId: resumed.batchId, resumedTaskId: resumeTaskId,
nextClaimed: Boolean(nextClaim?.ok), auditEventPath: auditEvent.eventPath })], evidence: { action: 'resume', actorId: resolvedActor.actorId, resumedTaskId: resumeTaskId, before: active, after: resumed, taskQueue: restoredQueue, auditEvent, auditSummary: buildBatchAuditSummary(resumed), nextClaim: nextClaim?.evidence ?? null }
});
}
const queue = findActiveTaskQueue(options.cwd, active.sourcePrompt, { batchId: active.batchId });
const consistency = inspectBatchRunConsistency(active, queue); if (!queue) { throw new CliError('ATM_BATCH_QUEUE_MISSING', 'Active batch run has no matching active task queue; abandon or recreate the batch from the original prompt.', { exitCode: 1, details: { batchId: active.batchId, requiredCommand: `node atm.mjs batch abandon --actor ${resolvedActor.actorId} --batch ${active.batchId} --json` }
});
}
const repaired = consistency.ok ? active : repairBatchRunFromQueue(options.cwd, active, queue);
const resumed = action === 'resume' && repaired.hold ? updateBatchRun(options.cwd, repaired, { hold: null }) : repaired;
const nextClaim = action === 'resume' && resumed.currentTaskId ? await runNext(['--cwd', options.cwd, '--claim', '--actor', resolvedActor.actorId, '--prompt', resumed.sourcePrompt, '--json']) : null; return makeResult({ ok: true, command: 'batch', cwd: options.cwd, messages: [ consistency.ok ? message('info', 'ATM_BATCH_REPAIR_NOT_NEEDED', 'Batch runtime is already consistent.', { batchId: active.batchId,
currentTaskId: active.currentTaskId, held: Boolean(active.hold) })
: message('info', 'ATM_BATCH_REPAIRED', 'Batch runtime was repaired from the active task queue.', { batchId: resumed.batchId, previousTaskId: active.currentTaskId, currentTaskId: resumed.currentTaskId, queueHeadTaskId: queue.taskIds[queue.currentIndex] ?? null }), action === 'resume' ? message('info', 'ATM_BATCH_RESUMED', 'Batch hold cleared and the current queue head was claimed through next.', {
batchId: resumed.batchId, currentTaskId: resumed.currentTaskId, nextClaimed: Boolean(nextClaim?.ok), checkpointCommand: `node atm.mjs batch checkpoint --actor ${resolvedActor.actorId} --batch ${resumed.batchId} --json` })
: message('warning', 'ATM_BATCH_RESUME_INSTRUCTION', 'Resume the batch through the current queue head; do not edit task events by hand.', { currentTaskId: resumed.currentTaskId, nextCommand: `node atm.mjs next --claim --actor ${resolvedActor.actorId} --prompt "${resumed.sourcePrompt}" --json`, checkpointCommand: `node atm.mjs batch checkpoint --actor ${resolvedActor.actorId} --batch ${resumed.batchId} --json` })
], evidence: { action, actorId: resolvedActor.actorId, before: active, after: resumed, taskQueue: queue, consistency, nextClaim: nextClaim?.evidence ?? null }
});
}
if (action === 'abandon') {
const active = selectRequiredBatch(options.cwd, buildBatchSelector(options), resolvedActor.actorId, action); if (!active) { throw new CliError('ATM_BATCH_RUN_MISSING', 'batch abandon requires an active batch run.', { exitCode: 2 }); }
const activeQueue = findActiveTaskQueue(options.cwd, active.sourcePrompt, { batchId: active.batchId }) ?? findActiveTaskQueue(options.cwd, null, { batchId: active.batchId });
const abandonedQueue = activeQueue ? abandonTaskQueue({ cwd: options.cwd, queueId: activeQueue.queueId, actorId: resolvedActor.actorId, reason: `batch ${active.batchId} abandoned` })
: null;
const abandoned = releaseBatchRun(options.cwd, active, 'abandoned'); return makeResult({ ok: true, command: 'batch', cwd: options.cwd, messages: [message('info', 'ATM_BATCH_ABANDONED', 'Batch run abandoned.', { batchId: abandoned.batchId, actorId: resolvedActor.actorId })], evidence: { action: 'abandon', actorId: resolvedActor.actorId, batchRun: abandoned, taskQueue: abandonedQueue }
});
}
throw new CliError('ATM_CLI_USAGE', 'batch supports: status, current, checkpoint, repair, resume, skip, abandon', { exitCode: 2 }); }
export function buildBatchTeamIntegrationReport(input: { readonly taskId: string; readonly batchId: string; readonly currentQueueHeadTaskId: string | null | undefined; readonly structuralParallelism: boolean; readonly evidencePayloadDigest: string | null | undefined; readonly sealedPayloadDigest: string | null | undefined; readonly attempts?: readonly BatchTeamAttemptUsage[]; readonly queueHeadLatencyMs: number;
readonly batchMakespanMs: number; readonly completedTaskCount: number; readonly stopLossTriggered?: boolean; readonly costTelemetryLoaded?: boolean; }): BatchTeamIntegrationReport {
const attempts = input.attempts ?? [];
const usage = attempts.reduce<BatchTeamUsageAggregate>((acc, attempt) => ({ attemptCount: acc.attemptCount + 1, retryCount: acc.retryCount + (attempt.retry === true ? 1 : 0), discardedContributionCount: acc.discardedContributionCount + (attempt.discarded === true ? 1 : 0), inputTokens: acc.inputTokens + finiteNumber(attempt.inputTokens), outputTokens: acc.outputTokens + finiteNumber(attempt.outputTokens),
cacheReadTokens: acc.cacheReadTokens + finiteNumber(attempt.cacheReadTokens), fullyLoadedCostUsd: acc.fullyLoadedCostUsd + finiteNumber(attempt.fullyLoadedCostUsd) }), { attemptCount: 0, retryCount: 0, discardedContributionCount: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, fullyLoadedCostUsd: 0 });
const payloadDigestMatchesEvidence = Boolean(input.evidencePayloadDigest) && input.evidencePayloadDigest === input.sealedPayloadDigest;
const stopLossTriggered = input.stopLossTriggered === true;
const costTelemetryLoaded = input.costTelemetryLoaded ?? attempts.length > 0;
const teamAdmission = evaluateBatchTeamAdmission({ taskId: input.taskId, batchId: input.batchId, currentQueueHeadTaskId: input.currentQueueHeadTaskId, structuralParallelism: input.structuralParallelism, costTelemetryLoaded, stopLossTriggered });
return { schemaId: 'atm.batchTeamIntegrationReport.v1', taskId: input.taskId, batchId: input.batchId, sealedClose: { usesSealAndCommitTransaction: true, checkpointRefusesPayloadMismatch: true, payloadDigestMatchesEvidence }, teamAdmission, usage, latency: { queueHeadLatencyMs: finiteNumber(input.queueHeadLatencyMs), batchMakespanMs: finiteNumber(input.batchMakespanMs),
throughputPerMinute: calculateThroughputPerMinute(input.completedTaskCount, input.batchMakespanMs), throughputIsSingleTaskLatency: false }, stopLoss: { triggered: stopLossTriggered, laterQueueHeadRoute: stopLossTriggered ? 'single-agent' : 'unchanged', closeSemanticsChanged: false }
};
}
function buildBatchSelector(options: Record<string, unknown>) {
const selector: { batchId?: string; scopeKey?: string } = {}; if (typeof options.batch === 'string' && options.batch.trim()) selector.batchId = options.batch.trim(); if (typeof options.scope === 'string' && options.scope.trim()) selector.scopeKey = options.scope.trim(); return selector; }
function finiteNumber(value: unknown) { return typeof value === 'number' && Number.isFinite(value) ? value : 0; }
function calculateThroughputPerMinute(completedTaskCount: number, batchMakespanMs: number) {
const taskCount = finiteNumber(completedTaskCount);
const makespanMs = finiteNumber(batchMakespanMs); if (taskCount <= 0 || makespanMs <= 0) return 0; return taskCount / (makespanMs / 60000); }
function stripBatchCheckpointCloseArgs(argv: readonly string[]) {
const stripped: string[] = []; for (let index = 0; index < argv.length; index += 1) {
const arg = argv[index]; if ( arg === '--historical-delivery' || arg === '--historical-delivery-commit' || arg === '--delivery-commit' || arg === '--historical-batch' ) { index += 1; continue; }
stripped.push(arg); }
return stripped; }
function parseBatchDeliverAndCloseExtras(argv: readonly string[]): { deliveryCommit: string | null; deliveryMessage: string | null; reason: string | null } {
let deliveryCommit: string | null = null;
let deliveryMessage: string | null = null;
let reason: string | null = null; for (let index = 0; index < argv.length; index += 1) {
const arg = argv[index]; if ((arg === '--delivery-commit' || arg === '--historical-delivery') && index + 1 < argv.length) { deliveryCommit = argv[index + 1]; index += 1; continue; }
if (arg === '--message' && index + 1 < argv.length) { deliveryMessage = argv[index + 1]; index += 1; continue; }
if (arg === '--reason' && index + 1 < argv.length) { reason = argv[index + 1]; index += 1; continue; }
}
return { deliveryCommit, deliveryMessage, reason }; }
function parseBatchCheckpointReadinessArgs(argv: readonly string[]): { waveId: string | null; manifestDigest: string | null; taskIds: readonly string[]; deliveryReceipts: readonly string[]; buildReceipts: readonly string[]; projectionReceipts: readonly string[]; planningClosebackOk: boolean } {
let waveId: string | null = null;
let manifestDigest: string | null = null;
const taskIds: string[] = [];
const deliveryReceipts: string[] = [];
const buildReceipts: string[] = [];
const projectionReceipts: string[] = [];
let planningClosebackOk = true;
for (let index = 0; index < argv.length; index += 1) {
const arg = argv[index];
if (arg === '--wave' && index + 1 < argv.length) { waveId = argv[++index]; continue; }
if (arg === '--manifest-digest' && index + 1 < argv.length) { manifestDigest = argv[++index]; continue; }
if (arg === '--task' && index + 1 < argv.length) { taskIds.push(argv[++index]); continue; }
if (arg === '--delivery-receipt' && index + 1 < argv.length) { deliveryReceipts.push(argv[++index]); continue; }
if (arg === '--build-receipt' && index + 1 < argv.length) { buildReceipts.push(argv[++index]); continue; }
if (arg === '--projection-receipt' && index + 1 < argv.length) { projectionReceipts.push(argv[++index]); continue; }
if (arg === '--planning-closeback-ok') { planningClosebackOk = true; continue; }
if (arg === '--planning-closeback-blocked') { planningClosebackOk = false; continue; }
}
return { waveId, manifestDigest, taskIds, deliveryReceipts, buildReceipts, projectionReceipts, planningClosebackOk };
}
function stripBatchCheckpointReadinessArgs(argv: readonly string[]): string[] {
const stripped: string[] = [];
for (let index = 0; index < argv.length; index += 1) {
const arg = argv[index];
if (['--wave', '--manifest-digest', '--task', '--delivery-receipt', '--build-receipt', '--projection-receipt'].includes(arg) && index + 1 < argv.length) { index += 1; continue; }
if (arg === '--planning-closeback-ok' || arg === '--planning-closeback-blocked') { continue; }
stripped.push(arg);
}
return stripped;
}
function stripBatchDeliverAndCloseExtras(argv: readonly string[]): string[] {
const stripped: string[] = []; for (let index = 0; index < argv.length; index += 1) {
const arg = argv[index]; if ( (arg === '--delivery-commit' || arg === '--historical-delivery' || arg === '--message' || arg === '--reason') && index + 1 < argv.length ) { index += 1; continue; }
stripped.push(arg); }
return stripped; }
function parseBatchHistoricalDeliveryRefs(argv: readonly string[]) {
const refs: string[] = []; for (let index = 0; index < argv.length; index += 1) {
const arg = argv[index]; if (arg !== '--historical-delivery' && arg !== '--historical-delivery-commit' && arg !== '--delivery-commit') continue;
const value = argv[index + 1]; if (!value || value.startsWith('--')) { throw new CliError('ATM_CLI_USAGE', `batch checkpoint ${arg} requires a commit ref.`, { exitCode: 2 }); }
refs.push(...value.split(',').map((entry) => entry.trim()).filter(Boolean)); index += 1; }
return uniqueStrings(refs); }
function parseBatchHistoricalBatchRefs(argv: readonly string[]) {
const refs: string[] = []; for (let index = 0; index < argv.length; index += 1) {
const arg = argv[index]; if (arg !== '--historical-batch') continue;
const value = argv[index + 1]; if (!value || value.startsWith('--')) { throw new CliError('ATM_CLI_USAGE', `batch checkpoint ${arg} requires a batch id or path.`, { exitCode: 2 }); }
refs.push(...value.split(',').map((entry) => entry.trim()).filter(Boolean)); index += 1; }
return uniqueStrings(refs); }
function stripAutoBatchArgs(argv: readonly string[]) {
const stripped: string[] = []; for (let index = 0; index < argv.length; index += 1) {
const arg = argv[index]; if (arg === '--auto-batch' || arg === '--auto-batch-max-wave-size' || arg === '--auto-batch-collection-timeout-ms') { index += 1; continue; }
stripped.push(arg); }
return stripped; }
function selectRequiredBatch(cwd: string, selector: ReturnType<typeof buildBatchSelector>, actorId: string, action: string) {
const selection = activeBatchSelectionStatus(cwd, { ...selector, actorId: selector.batchId || selector.scopeKey ? null : actorId });
if (selection.ok) return selection.batchRun; if (selection.reason === 'batch-selection-required') { throw new CliError('ATM_BATCH_SELECTION_REQUIRED', `batch ${action} found multiple active batch runs; choose one with --batch <batchId> or --scope <scopeKey>.`, { exitCode: 2, details: { action, activeBatches: selection.candidates.map(toBatchCandidate) }
});
}
return null; }
function toBatchCandidate(batchRun: { readonly batchId: string; readonly scopeKey?: string | null; readonly currentTaskId?: string | null; readonly taskIds: readonly string[]; readonly createdByActor?: string | null }) { return { batchId: batchRun.batchId, scopeKey: batchRun.scopeKey ?? null, currentTaskId: batchRun.currentTaskId ?? null, taskIds: batchRun.taskIds, createdByActor: batchRun.createdByActor ?? null,
checkpointCommand: `node atm.mjs batch checkpoint --actor <id> --batch ${batchRun.batchId} --json` };
}
function toCompactBatchCandidate(batchRun: { readonly batchId: string; readonly scopeKey?: string | null; readonly currentTaskId?: string | null; readonly taskIds: readonly string[]; readonly currentIndex?: number | null; readonly createdByActor?: string | null; readonly hold?: { readonly status?: string; readonly resumeCommand?: string } | null }) { return { batchId: batchRun.batchId,
scopeKey: batchRun.scopeKey ?? null, currentTaskId: batchRun.currentTaskId ?? null, held: Boolean(batchRun.hold), resumeCommand: batchRun.hold?.resumeCommand ?? null, currentIndex: batchRun.currentIndex ?? null, totalTasks: batchRun.taskIds.length, createdByActor: batchRun.createdByActor ?? null, statusCommand: `node atm.mjs batch current --batch ${batchRun.batchId} --compact --json`,
checkpointCommand: `node atm.mjs batch checkpoint --actor <id> --batch ${batchRun.batchId} --json` };
}
function buildCompactBatchStatus( cwd: string, batchRun: BatchRunRecord | null | undefined, taskQueue: TaskQueueRecord | null | undefined, consistency: { readonly ok: boolean; readonly [key: string]: unknown }, activeBatchCount: number, pendingCommitWindow: ReturnType<typeof buildPendingCheckpointCommitWindow>, autoBatch = parseAutoBatchControls([]) ) {
const queueHead = taskQueue?.tasks?.[taskQueue.currentIndex] ?? null;
const scope = queueHead ? partitionTaskScope(queueHead) : null;
const validators = queueHead ? readTaskValidators(cwd, queueHead.taskPath) : [];
const batchId = batchRun?.batchId ?? null;
const currentTaskId = batchRun?.currentTaskId ?? taskQueue?.taskIds?.[taskQueue?.currentIndex ?? 0] ?? null;
const commitInstructionTaskId = pendingCommitWindow?.taskId ?? batchRun?.pendingCommitTaskId ?? currentTaskId;
const held = Boolean(batchRun?.hold);
const currentWave = buildCurrentWaveSelection(cwd, batchRun, taskQueue, autoBatch);
const resumeCommand = batchRun?.hold?.resumeCommand ?? (batchId ? `node atm.mjs batch resume --actor <id> --batch ${batchId} --json` : null); return { schemaId: 'atm.batchCurrent.v1', ok: consistency.ok, active: Boolean(batchRun), activeBatchCount, batchId, scopeKey: batchRun?.scopeKey ?? null, queueId: taskQueue?.queueId ?? batchRun?.queueId ?? null,
currentIndex: batchRun?.currentIndex ?? taskQueue?.currentIndex ?? null, totalTasks: batchRun?.taskIds?.length ?? taskQueue?.taskIds?.length ?? 0, progress: buildCompactProgress(batchRun, taskQueue), held, hold: batchRun?.hold ?? null, skippedTasks: batchRun?.skippedTasks ?? [], auditSummary: buildBatchAuditSummary(batchRun), currentTaskId, currentTask: queueHead ? { workItemId: queueHead.workItemId,
title: queueHead.title, taskPath: queueHead.taskPath, sourcePlanPath: queueHead.sourcePlanPath, targetRepo: queueHead.targetRepo }
: null, allowedFiles: scope?.targetWork.allowedFiles ?? [], planningReadOnlyPaths: scope?.planningContext.readOnlyPaths ?? [], validators, currentWave, deferredReasons: currentWave.deferredReasons, dispatchCommand: currentWave.dispatchCommand, pendingCommitWindow, checkpointCommand: batchId ? `node atm.mjs batch checkpoint --actor <id> --batch ${batchId} --json` : null, commands: { checkpoint: batchId ? `node atm.mjs batch checkpoint --actor <id> --batch ${batchId} --json` : null, checkpointHold: batchId
? `node atm.mjs batch checkpoint --actor <id> --batch ${batchId} --hold --json` : null, resume: batchId ? `node atm.mjs batch resume --actor <id> --batch ${batchId} --json` : null, repair: batchId ? `node atm.mjs batch repair --actor <id> --batch ${batchId} --json` : 'node atm.mjs batch repair --actor <id> --json', status: batchId ? `node atm.mjs batch current --batch ${batchId} --compact --json`
: 'node atm.mjs batch current --compact --json', dispatchWave: currentWave.dispatchCommand }, commitInstruction: commitInstructionTaskId ? { timing: 'after-checkpoint', files: pendingCommitWindow?.commitFiles ?? [ '<deliverables>', `.atm/history/tasks/${commitInstructionTaskId}.json`, `.atm/history/evidence/${commitInstructionTaskId}.json`, `.atm/history/task-events/${commitInstructionTaskId}/` ] }
: null, nextCommand: batchRun?.sourcePrompt ? `node atm.mjs next --claim --actor <id> --prompt "${batchRun.sourcePrompt}" --json` : null, resumeCommand, repairCommand: batchId ? `node atm.mjs batch repair --actor <id> --batch ${batchId} --json` : 'node atm.mjs batch repair --actor <id> --json', omitted: { taskIds: batchRun?.taskIds?.length ?? taskQueue?.taskIds?.length ?? 0, fullTaskQueue: true, fullBatchRun: true,
useVerboseCommand: batchId ? `node atm.mjs batch status --batch ${batchId} --json` : 'node atm.mjs batch status --json' }, consistency };
}
function buildCurrentWaveSelection(cwd: string, batchRun: BatchRunRecord | null | undefined, taskQueue: TaskQueueRecord | null | undefined, autoBatch = parseAutoBatchControls([])) {
const batchId = batchRun?.batchId ?? null;
const tasks = taskQueue?.tasks ?? [];
const startIndex = batchRun?.currentIndex ?? taskQueue?.currentIndex ?? 0;
const maxWaveSize = autoBatch.maxWaveSize;
const selected: WaveManifestTask[] = [];
const deferredReasons: Array<{ readonly taskId: string; readonly reasonCode: string; readonly detail: string }> = [];
const seed = buildTaskWaveSeed(batchRun, taskQueue);
const waveId = buildDeterministicWaveId(batchId, seed, tasks.slice(startIndex).map((task) => task.workItemId));
if (!autoBatch.enabled) {
for (let index = Math.max(0, startIndex); index < tasks.length; index += 1) deferredReasons.push({ taskId: tasks[index].workItemId, reasonCode: 'auto-batch-disabled', detail: autoBatch.reason });
return { schemaId: 'atm.batchWaveSelection.v1' as const, status: 'serial-fallback', serialFallback: true, maxWaveSize, selectedTaskIds: [], currentWave: null, deferredReasons, dispatchCommand: null, autoBatch };
}
for (let index = Math.max(0, startIndex); index < tasks.length; index += 1) {
const task = tasks[index];
if (selected.length >= maxWaveSize) {
deferredReasons.push({ taskId: task.workItemId, reasonCode: 'max-wave-size', detail: `wave selector admits at most ${maxWaveSize} tasks` });
continue;
}
const validators = readTaskValidators(cwd, task.taskPath);
if (validators.length === 0) {
deferredReasons.push({ taskId: task.workItemId, reasonCode: 'validators-missing', detail: 'task record has no validators' });
continue;
}
if (!areTaskDependenciesReady(cwd, task)) {
deferredReasons.push({ taskId: task.workItemId, reasonCode: 'dependency-not-ready', detail: 'one or more dependencies are not done' });
continue;
}
const candidate = buildWaveCandidate(task, waveId, validators);
const decision = evaluateWaveEligibility([...selected, candidate]);
if (!decision.ok) {
deferredReasons.push({ taskId: task.workItemId, reasonCode: 'wave-incompatible', detail: decision.reasons.join('; ') });
continue;
}
selected.push(candidate);
}
const targetRepo = selected[0]?.targetRepo ?? null;
const status = selected.length > 1 ? 'wave-ready' : selected.length === 1 ? 'serial-fallback' : 'empty';
const currentWave = selected.length > 0 && batchId && targetRepo ? createWaveManifest({ waveId, batchRunId: batchId, coordinatorActorId: batchRun?.createdByActor ?? 'unknown', targetRepo, executor: 'local-lanes', tasks: selected, sealedBaseSha: readGitHead(cwd), now: new Date(0).toISOString() }) : null;
const dispatchCommand = status === 'wave-ready' && batchId ? `node atm.mjs team wave dispatch --batch ${batchId} --wave ${waveId} --executor local-lanes --json` : null;
return { schemaId: 'atm.batchWaveSelection.v1' as const, status, serialFallback: status === 'serial-fallback', maxWaveSize, selectedTaskIds: selected.map((task) => task.taskId), currentWave, deferredReasons, dispatchCommand, autoBatch };
}
function parseAutoBatchControls(argv: readonly string[]) {
const option = readOptionValue(argv, '--auto-batch');
const envOff = process.env.ATM_AUTO_BATCH === '0';
const circuitOpen = Boolean(process.env.ATM_AUTO_BATCH_CIRCUIT_OPEN);
const optionOff = option === 'off' || option === 'false' || option === '0';
const maxWaveSize = Math.max(1, parsePositiveInteger(readOptionValue(argv, '--auto-batch-max-wave-size') ?? process.env.ATM_AUTO_BATCH_MAX_WAVE_SIZE, 4));
const collectionTimeoutMs = Math.max(0, parsePositiveInteger(readOptionValue(argv, '--auto-batch-collection-timeout-ms') ?? process.env.ATM_AUTO_BATCH_COLLECTION_TIMEOUT_MS, 120000));
const reason = circuitOpen ? 'ATM_AUTO_BATCH_CIRCUIT_OPEN' : envOff ? 'ATM_AUTO_BATCH=0' : optionOff ? '--auto-batch off' : 'enabled';
return { schemaId: 'atm.autoBatchControls.v1' as const, enabled: !(envOff || circuitOpen || optionOff), reason, maxWaveSize, collectionTimeoutMs };
}
function parsePositiveInteger(value: string | undefined | null, fallback: number): number {
const parsed = Number(value);
return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
function readOptionValue(argv: readonly string[], flag: string): string | null {
const index = argv.indexOf(flag);
return index >= 0 && index + 1 < argv.length ? String(argv[index + 1]) : null;
}
function buildWaveCandidate(task: TaskDirectionTask, waveId: string, validators: readonly string[]): WaveManifestTask {
return { taskId: task.workItemId, waveId, targetRepo: task.targetRepo ?? 'unknown', surfaceFamily: inferSurfaceFamily(task.scopePaths), scopePaths: task.scopePaths, validators, dependencyReady: true };
}
function areTaskDependenciesReady(cwd: string, task: TaskDirectionTask): boolean {
const record = readJsonRecord(cwd, task.taskPath);
const recordDependencies = Array.isArray(record?.dependencies) ? record.dependencies.filter((entry): entry is string => typeof entry === 'string') : [];
const dependencies = recordDependencies.length > 0 ? recordDependencies : task.dependencies;
if (dependencies.length === 0) return true;
return dependencies.every((dependency) => {
const record = readJsonRecord(cwd, `.atm/history/tasks/${dependency}.json`);
return record?.status === 'done';
});
}
function inferSurfaceFamily(scopePaths: readonly string[]): string {
const lower = scopePaths.map((entry) => normalizeRelativePath(entry).toLowerCase());
if (lower.some((entry) => entry.startsWith('packages/core/'))) return 'core';
if (lower.some((entry) => entry.startsWith('packages/cli/'))) return 'cli';
if (lower.some((entry) => entry.startsWith('release/'))) return 'release';
if (lower.some((entry) => entry.startsWith('scripts/'))) return 'scripts';
if (lower.some((entry) => entry.startsWith('docs/') || entry.endsWith('.md'))) return 'docs';
if (lower.some((entry) => entry.startsWith('.atm/'))) return 'ledger';
return 'mixed';
}
function buildTaskWaveSeed(batchRun: BatchRunRecord | null | undefined, taskQueue: TaskQueueRecord | null | undefined): string {
return `${batchRun?.scopeKey ?? taskQueue?.scopeKey ?? 'batch'}:${batchRun?.currentIndex ?? taskQueue?.currentIndex ?? 0}`;
}
function buildDeterministicWaveId(batchId: string | null, seed: string, taskIds: readonly string[]): string {
return `wave-${hashShort([batchId ?? 'no-batch', seed, ...taskIds].join('\n'))}`;
}
function hashShort(value: string): string {
return createHash('sha256').update(value).digest('hex').slice(0, 12);
}
export function buildPendingCheckpointCommitWindow(cwd: string, batchRun: BatchRunRecord | null | undefined, taskQueue: TaskQueueRecord | null | undefined) { if (!batchRun?.batchId || !Array.isArray(batchRun.taskIds)) return null;
const gitChanges = readGitChangedFiles(cwd);
const changedFiles = gitChanges.files; if (gitChanges.available && changedFiles.length === 0) return null;
const candidateTaskIds = uniqueStrings([ typeof batchRun.pendingCommitTaskId === 'string' ? batchRun.pendingCommitTaskId : '', ...batchRun.taskIds.map(String) ].filter(Boolean)); for (const taskId of candidateTaskIds) {
const taskFile = `.atm/history/tasks/${taskId}.json`;
const relatedFiles = changedFiles.filter((file) => isTaskCheckpointRelatedFile(file, taskId)); if (gitChanges.available && !relatedFiles.includes(taskFile)) continue;
const task = readJsonRecord(cwd, taskFile); if (task?.status !== 'done') continue;
const lastTransitionId = typeof task.lastTransitionId === 'string' ? task.lastTransitionId : '';
const eventFile = `.atm/history/task-events/${taskId}/${lastTransitionId}.json`; if (!lastTransitionId) continue; if (gitChanges.available && !changedFiles.includes(eventFile)) continue;
const event = readJsonRecord(cwd, eventFile);
const closure = event?.closure as { schemaId?: unknown; batchId?: unknown } | undefined;
const checkpointClosure = typeof event?.command === 'string' && event.command.startsWith('node atm.mjs ') && (event.command.includes('--from-batch-checkpoint') || closure?.schemaId === 'atm.taskClosureTransition.v1') && (event.command.includes(`--batch ${batchRun.batchId}`) || closure?.batchId === batchRun.batchId); if (!checkpointClosure) continue;
const scope = extractTaskScopeFiles(task);
const deliverableFiles = changedFiles.filter((file) => scope.some((allowed) => isPathAllowedByScope(file, [allowed])));
const evidenceFile = `.atm/history/evidence/${taskId}.json`;
const checkpointFiles = relatedFiles.length > 0 ? relatedFiles : uniqueStrings([ taskFile, existsSync(path.join(cwd, normalizeRelativePath(evidenceFile))) ? evidenceFile : '', eventFile ].filter(Boolean));
const commitFiles = uniqueStrings([ ...deliverableFiles, taskFile, evidenceFile, `.atm/history/task-events/${taskId}/` ]); return { schemaId: 'atm.batchCheckpointCommitWindow.v1', batchId: batchRun.batchId, taskId, currentBatchTaskId: batchRun.currentTaskId ?? taskQueue?.taskIds?.[taskQueue?.currentIndex ?? 0] ?? null, changedFiles: checkpointFiles, deliverableFiles, commitFiles,
commitCommand: `git add ${commitFiles.map(quoteShellArg).join(' ')} && git commit -m "complete ${taskId}"`, statusCommand: `node atm.mjs batch current --batch ${batchRun.batchId} --compact --json`, note: 'Checkpoint has closed this task. Commit these files before continuing with the next queue head.' };
}
return null; }
function isTaskCheckpointRelatedFile(filePath: string, taskId: string) {
const normalized = normalizeRelativePath(filePath);
const lower = normalized.toLowerCase();
const taskLower = taskId.toLowerCase(); return lower === `.atm/history/tasks/${taskLower}.json` || lower === `.atm/history/evidence/${taskLower}.json` || lower === `.atm/history/evidence/${taskLower}.closure-packet.json` || lower.startsWith(`.atm/history/task-events/${taskLower}/`); }
function extractTaskScopeFiles(task: Record<string, unknown>): readonly string[] {
const output: string[] = []; collectStringArray(task.scope, output); collectStringArray(task.scopePaths, output); collectStringArray(task.deliverables, output); collectStringArray(task.files, output); collectStringArray(task.allowedFiles, output);
const targetWork = task.targetWork && typeof task.targetWork === 'object' && !Array.isArray(task.targetWork) ? task.targetWork as Record<string, unknown> : null; if (targetWork) collectStringArray(targetWork.allowedFiles, output); return uniqueStrings(output.map(normalizeRelativePath).filter(Boolean)); }
function collectStringArray(value: unknown, output: string[]) { if (!Array.isArray(value)) return; for (const entry of value) { if (typeof entry === 'string') output.push(entry); }
}
function readGitChangedFiles(cwd: string) {
const result = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd, encoding: 'utf8' });
if (result.status !== 0) return { available: false, files: [] as string[] };
const files = String(result.stdout ?? '') .split(/\r?\n/) .map((line) => line.trimEnd()) .filter(Boolean) .map((line) => normalizeGitStatusPath(line.slice(3))) .filter(Boolean); return { available: true, files }; }
function readGitHead(cwd: string): string | null {
const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd, encoding: 'utf8' });
return result.status === 0 ? result.stdout.trim() || null : null; }
function readGitDirtyFileSummary(cwd: string) {
const porcelain = spawnSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd, encoding: 'utf8' });
if (porcelain.status !== 0) { return { available: false, staged: 0, modifiedTracked: 0, untracked: 0, untrackedFiles: [] as string[], hint: 'git status unavailable' };
}
let staged = 0;
let modifiedTracked = 0;
let untracked = 0;
const untrackedFiles: string[] = []; for (const rawLine of String(porcelain.stdout ?? '').split(/\r?\n/)) {
const line = rawLine.trimEnd(); if (!line) continue;
const code = line.slice(0, 2);
const filePath = normalizeGitStatusPath(line.slice(3)); if (code.startsWith('??')) { untracked += 1; untrackedFiles.push(filePath); continue; }
if (code[0] && code[0] !== ' ' && code[0] !== '?') staged += 1; if (code[1] && code[1] !== ' ' && code[1] !== '?') modifiedTracked += 1; }
return { available: true, staged, modifiedTracked, untracked, untrackedFiles: uniqueStrings(untrackedFiles), hint: untracked > 0 ? 'Untracked files are advisory only; claim/checkpoint never hard-block on them (TASK-AAO-0011).' : null };
}
function normalizeGitStatusPath(value: string) {
const renamed = value.includes(' -> ') ? value.split(' -> ').pop() ?? value : value; return normalizeRelativePath(renamed.replace(/^"|"$/g, '')); }
function readJson(cwd: string, relativePath: string): unknown {
const filePath = path.join(cwd, normalizeRelativePath(relativePath)); if (!existsSync(filePath)) return null; try { return JSON.parse(readFileSync(filePath, 'utf8')); } catch { return null; }
}
function readJsonRecord(cwd: string, relativePath: string): Record<string, unknown> | null {
const parsed = readJson(cwd, relativePath); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null; return parsed as Record<string, unknown>; }
function quoteShellArg(value: string) { return `"${value.replace(/"/g, '\\"')}"`; }
function normalizeRelativePath(value: string | null | undefined) { return String(value ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, ''); }
function uniqueStrings(values: readonly string[]) { return [...new Set(values.map(normalizeRelativePath).filter(Boolean))].sort((left, right) => left.localeCompare(right)); }
function buildCompactProgress(batchRun: BatchRunRecord | null | undefined, taskQueue: TaskQueueRecord | null | undefined) {
const currentIndex = batchRun?.currentIndex ?? taskQueue?.currentIndex ?? null;
const totalTasks = batchRun?.taskIds?.length ?? taskQueue?.taskIds?.length ?? 0;
const ordinal = typeof currentIndex === 'number' && totalTasks > 0 ? Math.min(totalTasks, currentIndex + 1) : null; return { currentIndex, ordinal, totalTasks, remainingTasks: typeof currentIndex === 'number' ? Math.max(0, totalTasks - currentIndex) : totalTasks, skippedTaskCount: Array.isArray(batchRun?.skippedTasks) ? batchRun.skippedTasks.length : 0 };
}
function buildBatchAuditSummary(batchRun: { readonly currentTaskId?: string | null; readonly skippedTasks?: readonly { readonly taskId: string; readonly reason: string }[] | null; readonly hold?: { readonly status?: string } | null; readonly status?: string | null } | null | undefined) {
const skippedTasks = Array.isArray(batchRun?.skippedTasks) ? batchRun!.skippedTasks! : []; return { schemaId: 'atm.batchAuditSummary.v1', currentTaskId: batchRun?.currentTaskId ?? null, held: Boolean(batchRun?.hold), batchStatus: batchRun?.status ?? null, openTaskId: batchRun?.currentTaskId ?? null, skippedTaskIds: skippedTasks.map((entry) => entry.taskId), skippedTasks: skippedTasks.map((entry) => ({
taskId: entry.taskId, reason: entry.reason, state: 'skipped' })), blockedTaskIds: skippedTasks.map((entry) => entry.taskId), doneTaskIds: [] as string[] };
}
function readTaskValidators(cwd: string, taskPath: string | null | undefined): readonly string[] { if (!taskPath) return [];
const absolutePath = path.isAbsolute(taskPath) ? taskPath : path.resolve(cwd, taskPath); if (!existsSync(absolutePath)) return []; try {
const parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
const validators = Array.isArray(parsed?.validators) ? parsed.validators : []; return validators.map(String).filter(Boolean); } catch { return []; }
}
function categorizeCheckpointCloseFailure( closeResult: { ok: boolean; messages?: readonly { code?: string; data?: Record<string, unknown> }[]; evidence?: unknown }, taskId: string, actorId: string ): { category: string; reason: string; requiredCommand: string | null; tldr: string | null; missingValidationPasses: readonly unknown[]; blockingFindings: readonly unknown[]; } {
const errorMsg = Array.isArray(closeResult.messages) ? closeResult.messages.find((m) => typeof m.code === 'string' && m.code.startsWith('ATM_TASK_CLOSE')) : null;
const code = errorMsg?.code ?? 'ATM_TASK_CLOSE_UNKNOWN';
const tldr = typeof errorMsg?.data?.tldr === 'string' ? errorMsg.data.tldr : null;
const missingValidationPasses = Array.isArray(errorMsg?.data?.missingValidationPasses) ? (errorMsg.data.missingValidationPasses as readonly unknown[]) : [];
const blockingFindings = Array.isArray(errorMsg?.data?.blockingFindings) ? (errorMsg.data.blockingFindings as readonly unknown[]) : []; if (code === 'ATM_TASK_CLOSE_EVIDENCE_REQUIRED' || code === 'ATM_TASK_CLOSE_CLOSURE_PACKET_INVALID') { return { category: 'missing-evidence', reason: tldr ?? `Task ${taskId} lacks required command-backed evidence or a valid closure packet.`,
requiredCommand: `node atm.mjs evidence missing --task ${taskId} --actor ${actorId} --json`, tldr, missingValidationPasses, blockingFindings };
}
if (code === 'ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED') { return { category: 'missing-deliverable', reason: `Task ${taskId} has no real non-.atm deliverable diff; implement the required files first.`, requiredCommand: null, tldr, missingValidationPasses, blockingFindings };
}
if (code === 'ATM_TASK_CLOSE_FRAMEWORK_DIFF_ACTIVE' || code === 'ATM_TASK_CLOSE_FRAMEWORK_GATE_FAILED') {
const requiredCommand = typeof errorMsg?.data?.requiredCommand === 'string' ? errorMsg.data.requiredCommand : null; return { category: 'framework-gate-failed', reason: tldr ?? `Task ${taskId} cannot close due to ATM framework delivery window or gate blocker.`, requiredCommand, tldr, missingValidationPasses, blockingFindings };
}
if (code === 'ATM_TASK_CLOSE_ACTIVE_CLAIM_REQUIRED') { return { category: 'no-active-claim', reason: `Task ${taskId} has no active claim owned by ${actorId}.`, requiredCommand: `node atm.mjs next --claim --actor ${actorId} --prompt "${taskId}" --json`, tldr, missingValidationPasses, blockingFindings };
}
if (code === 'ATM_TASK_CLOSE_OWNER_MISMATCH') { return { category: 'owner-mismatch', reason: `Task ${taskId} is owned by a different actor; use takeover or correct --actor.`, requiredCommand: `node atm.mjs tasks takeover --task ${taskId} --actor ${actorId} --json`, tldr, missingValidationPasses, blockingFindings };
}
return { category: 'close-failed', reason: `Task ${taskId} close returned ok=false (code: ${code}).`, requiredCommand: null, tldr, missingValidationPasses, blockingFindings };
}
