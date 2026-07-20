import { existsSync, readFileSync } from 'node:fs';
import { CliError, relativePathFrom, resolveValue } from '../shared.js';
import { createLocalGovernanceAdapter } from '../../../../plugin-governance-local/dist/index.js';
import { resolveActorId } from '../actor-registry.js';
import { resolveActorWorkSession, updateActorWorkSessionState } from '../actor-session.js';
import { computeMissingValidatorReport, verifyTaskEvidence } from '../evidence.js';
import { cleanupStaleTeamRunsForTerminalTasks } from '../team-runtime-cleanup.js';
import { evaluateTeamRequiredCompletionGate } from '../team.js';
import { assertRunnerFreshForWriteAction, createFrameworkModeStatus, inspectFrameworkCloseWorktree, registerCloseCommitWindow, requireTargetRepoClosureAuthority, } from '../framework-development.js';
import { assertEmergencyApproval, recordProtectedOverrideOutcome } from '../emergency/gate.js';
import { assertTaskCloseAllowedByDirection, advanceTaskQueueAfterClose } from '../task-direction.js';
import { findActiveBatchRunForTask, readActiveBatchRun } from '../work-channels.js';
import { evaluateTaskDoneCloseAdmission } from './lifecycle-state.js';
import { inspectHistoricalDelivery, pathMatchesTaskScope } from './historical-delivery.js';
import { attachDirtyGuardToScopedDiffIsolation, buildCloseScopedDiffIsolation, evaluateFrameworkCloseDirtyGuard } from './scope-lock-diagnostics.js';
import { parseClaimRecord } from './task-ledger-readers.js';
import { normalizeRelativePath, taskPathFor } from './task-file-io-helpers.js';
import { evaluateFrameworkDeliveryWindow, readDeferredForeignStagedFilesForActiveCloseWindow } from './close-helpers/close-window-diagnostics.js';
import { extractTaskCloseDeclaredFiles, extractTaskDeliverableFiles, evaluateTaskDeliverableGate, existingTaskCloseArtifacts, stageTaskCloseArtifacts, taskDeliveryPrincipleText } from './close-helpers/close-artifact-staging.js';
import { createClosureTransitionMetadata } from './close-helpers/task-transition-writer.js';
import { uniqueStrings, isCliErrorWithCode, recordStaleRunnerOverride, recordFailedEmergencyUseAttempt } from '../tasks.js';
import { parseCloseOptions } from './task-option-parsers.js';
import { resolveCloseHistoricalContext } from './close-orchestrator/historical-context.js';
import { prepareClosurePacket } from './close-orchestrator/closure-packet.js';
import { makeTasksClosedResult } from './close-orchestrator/close-result.js';
import { executeCloseWrites } from './close-orchestrator/close-write.js';
export async function runTasksClose(argv) {
    const options = parseCloseOptions(argv);
    const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
    if (!resolvedActor) {
        throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks close requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
    }
    const actorId = resolvedActor.actorId;
    const protectedCloseSurface = 'tasks close historical-delivery backend';
    const { historicalBatchSlice, effectiveHistoricalDeliveryRefs, allowHistoricalCloseback, governedHistoricalBatchCheckpoint, protectedCloseFlags, requiresProtectedCloseApproval, shouldDeferProtectedCloseApproval } = resolveCloseHistoricalContext(options);
    const protectedCloseCommand = `node atm.mjs tasks close --task ${options.taskId} --actor ${actorId} --status ${options.status} --json`;
    let emergencyUse = null;
    let failedEmergencyAuditPath = null;
    try {
        const taskPath = taskPathFor(options.cwd, options.taskId);
        if (!existsSync(taskPath)) {
            throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${options.taskId}.`, {
                exitCode: 2,
                details: { taskPath: relativePathFrom(options.cwd, taskPath), taskId: options.taskId }
            });
        }
        if (requiresProtectedCloseApproval && !shouldDeferProtectedCloseApproval) {
            emergencyUse = assertEmergencyApproval({
                cwd: options.cwd,
                surface: protectedCloseSurface,
                permission: 'backend.tasks.close',
                taskId: options.taskId,
                actorId,
                emergencyApproval: options.emergencyApproval,
                flags: protectedCloseFlags,
                reason: options.reason ?? 'Direct close backend historical-delivery path.',
                command: protectedCloseCommand
            });
        }
        const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8'));
        const previousTaskContent = readFileSync(taskPath, 'utf8');
        if (options.status === 'abandoned' && !options.reason?.trim()) {
            throw new CliError('ATM_TASK_ABANDON_REASON_REQUIRED', `Task ${options.taskId} cannot be abandoned without a reason.`, {
                exitCode: 2,
                details: {
                    taskId: options.taskId,
                    status: options.status,
                    requiredCommand: `node atm.mjs tasks close --task ${options.taskId} --actor ${actorId} --status abandoned --reason "<reason>" --json`
                }
            });
        }
        const staleGate = assertRunnerFreshForWriteAction({
            cwd: options.cwd,
            action: 'tasks-close',
            allowStaleRunner: options.allowStaleRunner
        });
        if (options.allowStaleRunner && staleGate.warning) {
            await recordStaleRunnerOverride({
                cwd: options.cwd,
                taskId: options.taskId,
                actorId,
                action: 'tasks-close',
                command: `node atm.mjs tasks close --task ${options.taskId} --actor ${actorId} --allow-stale-runner --json`
            });
        }
        const currentClaim = parseClaimRecord(taskDocument.claim);
        const activeSession = resolveActorWorkSession(options.cwd, {
            actorId,
            taskId: options.taskId,
            claimLeaseId: currentClaim?.leaseId ?? null,
            includeNonActive: true
        });
        const currentOwner = typeof taskDocument.owner === 'string' ? taskDocument.owner : null;
        if (currentOwner && currentOwner !== actorId) {
            throw new CliError('ATM_TASK_CLOSE_OWNER_MISMATCH', `Task ${options.taskId} owner is ${currentOwner}, not ${actorId}.`, {
                exitCode: 1,
                details: { taskId: options.taskId, owner: currentOwner, actorId }
            });
        }
        requireTargetRepoClosureAuthority({
            cwd: options.cwd,
            taskDocument,
            taskId: options.taskId,
            status: options.status
        });
        const owningBatch = options.status === 'done'
            ? (options.batchId ? readActiveBatchRun(options.cwd, { batchId: options.batchId }) : findActiveBatchRunForTask(options.cwd, options.taskId))
            : null;
        if (options.status === 'done') {
            if (owningBatch?.status === 'active' && owningBatch.taskIds.includes(options.taskId) && !options.fromBatchCheckpoint) {
                const currentTaskId = owningBatch.currentTaskId ?? owningBatch.taskIds[owningBatch.currentIndex] ?? null;
                throw new CliError('ATM_BATCH_CHECKPOINT_REQUIRED', currentTaskId === options.taskId
                    ? `Task ${options.taskId} is the active batch queue head. Close it through batch checkpoint, not direct tasks close.`
                    : `Task ${options.taskId} belongs to active batch ${owningBatch.batchId}. Do not close batch tasks directly; deliver the current queue head and use batch checkpoint to advance.`, {
                    exitCode: 1,
                    details: {
                        taskId: options.taskId,
                        batchId: owningBatch.batchId,
                        currentIndex: owningBatch.currentIndex,
                        currentTaskId,
                        requiredCommand: `node atm.mjs batch checkpoint --actor ${actorId} --batch ${owningBatch.batchId} --json`,
                        blockedPattern: 'manual tasks close during active batch',
                        remediation: currentTaskId && currentTaskId !== options.taskId
                            ? `Deliver queue head ${currentTaskId}, then run node atm.mjs batch checkpoint --actor ${actorId} --batch ${owningBatch.batchId} --json instead of directly closing ${options.taskId}.`
                            : `Run node atm.mjs batch checkpoint --actor ${actorId} --batch ${owningBatch.batchId} --json after delivering ${options.taskId}.`
                    }
                });
            }
            if (options.fromBatchCheckpoint && owningBatch?.batchId && options.batchId && owningBatch.batchId !== options.batchId) {
                throw new CliError('ATM_BATCH_OWNERSHIP_MISMATCH', `Task ${options.taskId} belongs to batch ${owningBatch.batchId}, not ${options.batchId}.`, {
                    exitCode: 1,
                    details: {
                        taskId: options.taskId,
                        expectedBatchId: owningBatch.batchId,
                        actualBatchId: options.batchId
                    }
                });
            }
            const doneCloseAdmission = evaluateTaskDoneCloseAdmission({
                taskId: options.taskId,
                actorId,
                status: taskDocument.status,
                claimState: currentClaim?.state ?? null,
                claimActorId: currentClaim?.actorId ?? null,
                hasActiveSession: Boolean(activeSession?.sessionId),
                allowHistoricalCloseback
            });
            if (!doneCloseAdmission.ok) {
                throw new CliError(doneCloseAdmission.code, doneCloseAdmission.message, {
                    exitCode: 1,
                    details: doneCloseAdmission.details
                });
            }
            assertTaskCloseAllowedByDirection(options.cwd, options.taskId, actorId, {
                allowHistoricalCloseback
            });
            const teamRequiredGate = evaluateTeamRequiredCompletionGate({
                cwd: options.cwd,
                taskId: options.taskId,
                taskDocument
            });
            if (!teamRequiredGate.ok) {
                throw new CliError('ATM_TEAM_COMPLETION_REQUIRED', `Task ${options.taskId} declares team.required and cannot close until a Team run is completed.`, {
                    exitCode: 1,
                    details: {
                        taskId: options.taskId,
                        required: teamRequiredGate.required,
                        requiredCommand: teamRequiredGate.requiredCommand,
                        remediation: 'Run or inspect the active Team run, then close it with team complete before closing the task.'
                    }
                });
            }
        }
        const taskDeclaredFiles = extractTaskCloseDeclaredFiles(taskDocument, options.cwd, options.taskId, {
            checkpointScoped: options.fromBatchCheckpoint
        });
        const activeFrameworkStatus = options.status === 'done'
            ? createFrameworkModeStatus({ cwd: options.cwd })
            : null;
        const frameworkStatus = options.status === 'done'
            ? createFrameworkModeStatus({
                cwd: options.cwd,
                files: taskDeclaredFiles.length > 0 ? taskDeclaredFiles : undefined
            })
            : null;
        const frameworkDeliveryWindow = options.status === 'done'
            ? evaluateFrameworkDeliveryWindow({
                cwd: options.cwd,
                taskId: options.taskId,
                actorId,
                batchId: options.batchId ?? owningBatch?.batchId ?? null,
                fromBatchCheckpoint: options.fromBatchCheckpoint,
                taskDeclaredFiles,
                criticalChangedFiles: activeFrameworkStatus?.criticalChangedFiles ?? [],
                historicalDeliveryRefs: effectiveHistoricalDeliveryRefs,
                historicalBatchCloseReady: historicalBatchSlice?.okToCloseTask === true
            })
            : null;
        let closeScopedDiffIsolation = options.status === 'done' && frameworkStatus?.repoRole === 'framework' && frameworkDeliveryWindow
            ? buildCloseScopedDiffIsolation({
                cwd: options.cwd,
                taskId: options.taskId,
                taskDeclaredFiles,
                frameworkChangedFiles: activeFrameworkStatus?.changedFiles ?? [],
                frameworkDeliveryWindow
            })
            : null;
        if (frameworkStatus?.repoRole === 'framework') {
            const closeWorktree = inspectFrameworkCloseWorktree(options.cwd, options.taskId);
            const historicalDeliveredFiles = uniqueStrings(effectiveHistoricalDeliveryRefs.flatMap((ref) => inspectHistoricalDelivery({
                cwd: options.historicalDeliveryRepo ?? options.cwd,
                taskId: options.taskId,
                requestedRef: ref,
                declaredFiles: taskDeclaredFiles,
                enforceDeclaredScope: true,
                waiverOutOfScopeDelivery: options.waiverOutOfScopeDelivery === true,
                waiverReason: options.reason ?? null
            }).deliverableFiles));
            const batchCheckpointGovernanceDirtyFiles = options.fromBatchCheckpoint
                ? closeWorktree.trackedDirtyFiles.filter((entry) => {
                    const normalized = normalizeRelativePath(entry).toLowerCase();
                    const taskIdLower = options.taskId.toLowerCase();
                    return normalized === `.atm/history/evidence/${taskIdLower}.json`
                        || normalized === `.atm/history/tasks/${taskIdLower}.json`
                        || normalized.startsWith(`.atm/history/task-events/${taskIdLower}/`);
                })
                : [];
            const batchCheckpointScopedDirtyFiles = options.fromBatchCheckpoint
                ? closeWorktree.trackedDirtyFiles.filter((entry) => taskDeclaredFiles.some((declared) => pathMatchesTaskScope(entry, declared)))
                : [];
            const allowedAdvisoryGovernanceFiles = options.status === 'done' && effectiveHistoricalDeliveryRefs.length > 0
                ? [
                    `.atm/history/evidence/${options.taskId}.json`,
                    `.atm/history/tasks/${options.taskId}.json`,
                    ...readDeferredForeignStagedFilesForActiveCloseWindow(options.cwd, options.taskId)
                ]
                : options.fromBatchCheckpoint
                    ? batchCheckpointGovernanceDirtyFiles
                    : [];
            const closeDirtyGuard = evaluateFrameworkCloseDirtyGuard({
                cwd: options.cwd,
                taskId: options.taskId,
                taskDeclaredFiles,
                taskDeliverableFiles: extractTaskDeliverableFiles(taskDocument),
                trackedDirtyFiles: closeWorktree.trackedDirtyFiles,
                historicalDeliveredFiles,
                allowedAdvisoryGovernanceFiles,
                allowedAdvisoryDirtyFiles: options.fromBatchCheckpoint ? batchCheckpointScopedDirtyFiles : []
            });
            const effectiveCloseDirtyGuard = options.fromBatchCheckpoint
                ? {
                    ...closeDirtyGuard,
                    blockingTrackedDirtyFiles: closeDirtyGuard.incorrectPlanningMirrorPreEditFiles,
                    scopeTrackedDirtyFiles: [],
                    governanceTrackedDirtyFiles: []
                }
                : closeDirtyGuard;
            if (closeScopedDiffIsolation) {
                closeScopedDiffIsolation = attachDirtyGuardToScopedDiffIsolation(closeScopedDiffIsolation, effectiveCloseDirtyGuard, closeWorktree.ignoredUntrackedFiles);
            }
            if (effectiveCloseDirtyGuard.blockingTrackedDirtyFiles.length > 0) {
                throw new CliError('ATM_TASK_CLOSE_DIRTY_WORKTREE', `Task ${options.taskId} cannot be closed as done while in-scope or closure-governance tracked changes are still dirty.`, {
                    exitCode: 1,
                    details: {
                        taskId: options.taskId,
                        trackedDirtyFiles: effectiveCloseDirtyGuard.blockingTrackedDirtyFiles,
                        scopeTrackedDirtyFiles: effectiveCloseDirtyGuard.scopeTrackedDirtyFiles,
                        governanceTrackedDirtyFiles: effectiveCloseDirtyGuard.governanceTrackedDirtyFiles,
                        regenerableArtifactFiles: effectiveCloseDirtyGuard.regenerableArtifactFiles,
                        correctPlanningMirrorPreEditFiles: effectiveCloseDirtyGuard.correctPlanningMirrorPreEditFiles,
                        incorrectPlanningMirrorPreEditFiles: effectiveCloseDirtyGuard.incorrectPlanningMirrorPreEditFiles,
                        advisoryTrackedDirtyFiles: effectiveCloseDirtyGuard.advisoryTrackedDirtyFiles,
                        unstagedFiles: closeWorktree.unstagedFiles.filter((entry) => effectiveCloseDirtyGuard.blockingTrackedDirtyFiles.includes(entry)),
                        stagedFiles: closeWorktree.stagedFiles.filter((entry) => effectiveCloseDirtyGuard.blockingTrackedDirtyFiles.includes(entry)),
                        ignoredUntrackedFiles: closeWorktree.ignoredUntrackedFiles,
                        remediation: 'Commit this task\'s scoped delivery changes first before closing done. Unrelated tracked dirty files are isolated as advisory and do not block this task. The closure packet describes the delivery parent commit instead of the mutable worktree.'
                    }
                });
            }
            const scopedCriticalChangedFiles = frameworkDeliveryWindow?.scopedCriticalChangedFiles ?? [];
            const isolatedUnrelatedChanges = frameworkDeliveryWindow?.unscopedCriticalChangedFiles ?? [];
            if (scopedCriticalChangedFiles.length > 0 && frameworkDeliveryWindow?.ok !== true) {
                throw new CliError('ATM_TASK_CLOSE_FRAMEWORK_DIFF_ACTIVE', `Task ${options.taskId} cannot be closed while in-scope ATM framework critical files are still modified outside the governed delivery window.`, {
                    details: {
                        taskId: options.taskId,
                        criticalChangedFiles: activeFrameworkStatus?.criticalChangedFiles ?? [],
                        scopedCriticalChangedFiles,
                        isolatedUnrelatedChanges,
                        closeScopedDiffIsolation,
                        frameworkDeliveryWindow,
                        requiredCommand: frameworkDeliveryWindow?.requiredCommand ?? null,
                        remediation: frameworkDeliveryWindow?.remediation ?? 'Stage only the task-scoped deliverables/evidence, then close through the governed task or batch lifecycle.'
                    }
                });
            }
            const effectiveFrameworkBlockers = frameworkDeliveryWindow?.ok === true
                ? frameworkStatus.blockers.filter((entry) => !frameworkDeliveryWindow.allowedBlockers.includes(entry))
                : frameworkStatus.blockers;
            if ((frameworkStatus.mode === 'required' || frameworkStatus.mode === 'cross-repo-target-required') && effectiveFrameworkBlockers.length > 0) {
                // TASK-AAO-0017: 加入 TL;DR 和結構化缺失 validator 報告
                const missingReport = computeMissingValidatorReport(options.cwd, options.taskId, actorId);
                throw new CliError('ATM_TASK_CLOSE_FRAMEWORK_GATE_FAILED', `Task ${options.taskId} cannot be closed until framework-development blockers are resolved.`, {
                    details: {
                        taskId: options.taskId,
                        blockers: effectiveFrameworkBlockers,
                        suppressedBlockers: frameworkDeliveryWindow?.ok === true
                            ? frameworkStatus.blockers.filter((entry) => frameworkDeliveryWindow.allowedBlockers.includes(entry))
                            : [],
                        frameworkDeliveryWindow,
                        closeScopedDiffIsolation,
                        criticalChangedFiles: frameworkStatus.criticalChangedFiles,
                        requiredGates: frameworkStatus.requiredGates,
                        tldr: missingReport.tldr,
                        missingValidationPasses: missingReport.missingValidationPasses,
                        blockingFindings: missingReport.blockingFindings
                    }
                });
            }
        }
        const evidenceGate = options.status === 'done'
            ? historicalBatchSlice?.okToCloseTask === true
                ? null
                : verifyTaskEvidence({
                    cwd: options.cwd,
                    taskId: options.taskId,
                    gate: 'close',
                    taskDocument,
                    taskDeclaredFiles,
                    frameworkTask: frameworkStatus?.repoRole === 'framework'
                })
            : null;
        if (evidenceGate && !evidenceGate.ok) {
            // TASK-AAO-0017: 加入 TL;DR 和結構化缺失 validator 報告
            const missingReport = computeMissingValidatorReport(options.cwd, options.taskId, actorId);
            throw new CliError('ATM_TASK_CLOSE_EVIDENCE_REQUIRED', `Task ${options.taskId} cannot be closed as done without required delivery evidence. The goal is to deliver the task, not to mark it done.`, {
                exitCode: 1,
                details: {
                    taskId: options.taskId,
                    deliveryPrinciple: taskDeliveryPrincipleText(),
                    gate: evidenceGate.gate,
                    missing: evidenceGate.missing,
                    evidenceCount: evidenceGate.total,
                    remediation: 'Implement the requested non-.atm deliverables, run the required validators, then add command-backed evidence before closing done.',
                    tldr: missingReport.tldr,
                    missingValidationPasses: missingReport.missingValidationPasses,
                    blockingFindings: missingReport.blockingFindings
                }
            });
        }
        const deliverableGate = options.status === 'done'
            ? evaluateTaskDeliverableGate({
                cwd: options.cwd,
                taskId: options.taskId,
                taskDocument,
                taskDeclaredFiles,
                claim: parseClaimRecord(taskDocument.claim),
                historicalDeliveryRefs: effectiveHistoricalDeliveryRefs,
                historicalDeliveryRepo: options.historicalDeliveryRepo,
                historicalBatchCloseReadySlice: historicalBatchSlice?.okToCloseTask === true
                    ? {
                        batchId: historicalBatchSlice.batchId,
                        matchedCommits: historicalBatchSlice.matchedCommits,
                        matchedFiles: historicalBatchSlice.matchedFiles,
                        taskSpecificValidationPasses: historicalBatchSlice.taskSpecificValidationPasses,
                        batchWideValidationPasses: historicalBatchSlice.batchWideValidationPasses
                    }
                    : null,
                waiverOutOfScopeDelivery: options.waiverOutOfScopeDelivery,
                waiverReason: options.reason
            })
            : null;
        if (deliverableGate && !deliverableGate.ok) {
            throw new CliError('ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED', `Task ${options.taskId} cannot be closed as done because ATM found no real non-.atm deliverable diff. Task delivery comes before task closure.`, {
                exitCode: 1,
                details: deliverableGate
            });
        }
        const preparedClosurePacket = prepareClosurePacket({
            // Contract marker: requiredValidationPassesForClosure(frameworkStatus.requiredGates, closePacketChangedFiles)
            options,
            taskDocument,
            actorId,
            activeSession,
            frameworkStatus,
            deliverableGate,
            taskDeclaredFiles,
            historicalBatchSlice
        });
        const existingClosurePacketPath = preparedClosurePacket.existingClosurePacketPath;
        let closurePacketPath = preparedClosurePacket.closurePacketPath;
        let closurePacket = preparedClosurePacket.closurePacket;
        const pendingClosurePacket = preparedClosurePacket.pendingClosurePacket;
        const createdClosurePacketAbsolute = preparedClosurePacket.createdClosurePacketAbsolute;
        if (options.status === 'done') {
            const finalPacketPath = existingClosurePacketPath || (pendingClosurePacket ? `.atm/history/evidence/${options.taskId}.closure-packet.json` : null);
            const finalPacket = closurePacket || pendingClosurePacket;
            const evaluatedMetadata = createClosureTransitionMetadata(finalPacketPath, finalPacket, owningBatch?.batchId ?? options.batchId, activeSession?.sessionId ?? null);
            if (!evaluatedMetadata || evaluatedMetadata.schemaId !== 'atm.taskClosureTransition.v1') {
                throw new CliError('ATM_TASK_CLOSE_CLOSURE_METADATA_REQUIRED', `Task ${options.taskId} cannot be closed as ${options.status} because closure metadata cannot be produced.`, {
                    exitCode: 1,
                    details: { taskId: options.taskId }
                });
            }
        }
        if (requiresProtectedCloseApproval && shouldDeferProtectedCloseApproval) {
            emergencyUse = assertEmergencyApproval({
                cwd: options.cwd,
                surface: protectedCloseSurface,
                permission: 'backend.tasks.close',
                taskId: options.taskId,
                actorId,
                emergencyApproval: options.emergencyApproval,
                flags: protectedCloseFlags,
                reason: options.reason ?? 'Direct close backend historical-delivery path.',
                command: protectedCloseCommand
            });
        }
        if (currentClaim && currentClaim.state === 'active' && currentClaim.actorId === actorId) {
            taskDocument.claim = {
                ...currentClaim,
                heartbeatAt: new Date().toISOString(),
                state: 'released',
                reason: options.reason ?? 'closed'
            };
        }
        const previousStatus = String(taskDocument.status ?? '');
        taskDocument.status = options.status;
        taskDocument.owner = actorId;
        taskDocument.closedAt = new Date().toISOString();
        taskDocument.closedByActor = actorId;
        taskDocument.closedBySessionId = activeSession?.sessionId ?? null;
        if (options.reason) {
            taskDocument.closeReason = options.reason;
        }
        const closeWriteResult = await executeCloseWrites({
            options,
            actorId,
            taskPath,
            previousTaskContent,
            taskDocument,
            activeSession,
            previousStatus,
            owningBatch,
            effectiveHistoricalDeliveryRefs,
            pendingClosurePacket,
            createdClosurePacketAbsolute,
            closurePacketPath,
            closurePacket
        });
        const transitionPath = closeWriteResult.transitionPath;
        closurePacketPath = closeWriteResult.closurePacketPath;
        const closeEvidencePath = `.atm/history/evidence/${options.taskId}.json`;
        const closeArtifactFiles = existingTaskCloseArtifacts(options.cwd, [
            relativePathFrom(options.cwd, taskPath),
            closeEvidencePath,
            transitionPath,
            closurePacketPath
        ]);
        stageTaskCloseArtifacts(options.cwd, closeArtifactFiles);
        if (currentClaim && currentClaim.state === 'active' && currentClaim.actorId === actorId) {
            const adapter = createLocalGovernanceAdapter({ repositoryRoot: options.cwd });
            await resolveValue(adapter.stores.lockStore.releaseLock(options.taskId, actorId));
        }
        if (activeSession?.sessionId) {
            updateActorWorkSessionState({
                cwd: options.cwd,
                sessionId: activeSession.sessionId,
                status: options.status === 'done' ? 'closed' : currentClaim?.state === 'handoff' ? 'handoff' : 'released',
                reason: options.reason ?? (typeof taskDocument.closeReason === 'string' ? taskDocument.closeReason : null)
            });
        }
        const cleanedTeamRuns = cleanupStaleTeamRunsForTerminalTasks({
            cwd: options.cwd,
            taskId: options.taskId,
            terminalTaskStatus: options.status
        });
        const closeCommitWindowPathFromClose = (options.status === 'done' || options.status === 'abandoned')
            ? registerCloseCommitWindow({
                cwd: options.cwd,
                taskId: options.taskId,
                actorId,
                allowedFiles: closeArtifactFiles,
                transitionId: transitionPath.split(/[\\/]/).pop()?.replace(/\.json$/, '') ?? null,
                action: options.status === 'abandoned' ? 'abandon' : 'close'
            })
            : null;
        const taskQueue = options.status === 'done'
            ? advanceTaskQueueAfterClose(options.cwd, options.taskId, { batchId: owningBatch?.batchId ?? options.batchId })
            : null;
        let protectedOverrideOutcome = null;
        if (emergencyUse?.protectedOverrideAudit?.event?.eventId) {
            protectedOverrideOutcome = recordProtectedOverrideOutcome({
                cwd: options.cwd,
                parentEventId: emergencyUse.protectedOverrideAudit.event.eventId,
                actorId,
                taskId: options.taskId,
                surface: protectedCloseSurface,
                command: protectedCloseCommand,
                flags: protectedCloseFlags,
                permission: 'backend.tasks.close',
                leaseId: options.emergencyApproval,
                reason: options.reason ?? 'Direct close backend historical-delivery path.',
                skippedChecks: ['taskflow-operator-lane', 'protected-backend-surface'],
                touchedFiles: closeArtifactFiles,
                outcome: 'succeeded',
                emergencyUsePath: emergencyUse.usePath
            });
        }
        return makeTasksClosedResult({
            options,
            actorId,
            taskPath,
            evidenceGate,
            closurePacketPath,
            transitionPath,
            closeCommitWindowPathFromClose,
            closeArtifactFiles,
            deliverableGate,
            cleanedTeamRuns,
            closeScopedDiffIsolation,
            emergencyUse,
            protectedOverrideOutcome,
            failedEmergencyAuditPath,
            taskQueue,
            historicalBatchSlice
        });
    }
    catch (error) {
        if (shouldDeferProtectedCloseApproval
            && options.emergencyApproval
            && !emergencyUse
            && !isCliErrorWithCode(error, 'ATM_EMERGENCY_')) {
            failedEmergencyAuditPath = recordFailedEmergencyUseAttempt({
                cwd: options.cwd,
                leaseId: options.emergencyApproval,
                permission: 'backend.tasks.close',
                surface: protectedCloseSurface,
                taskId: options.taskId,
                actorId,
                reason: options.reason ?? 'Direct close backend historical-delivery path.',
                command: protectedCloseCommand,
                failureCode: error instanceof CliError && typeof error.code === 'string' ? error.code : null
            });
        }
        throw error;
    }
}
