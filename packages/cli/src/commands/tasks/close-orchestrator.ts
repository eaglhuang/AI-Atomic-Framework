// TASK-RFT-0012: extracted verbatim from packages/cli/src/commands/tasks.ts.
// The body of runTasksClose lives here; tasks.ts router re-exports it.
import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { CliError, makeResult, message, relativePathFrom, resolveValue } from '../shared.ts';
import { createLocalGovernanceAdapter } from '../../../../plugin-governance-local/src/index.ts';
import { resolveActorId } from '../actor-registry.ts';
import { resolveActorWorkSession, updateActorWorkSessionState } from '../actor-session.ts';
import { computeMissingValidatorReport, verifyTaskEvidence } from '../evidence.ts';
import { cleanupStaleTeamRunsForTerminalTasks } from '../team-runtime-cleanup.ts';
import { evaluateTeamRequiredCompletionGate } from '../team.ts';
import {
  assertRunnerFreshForWriteAction,
  createClosurePacket,
  createFrameworkModeStatus,
  executeTaskCloseTransaction,
  inspectFrameworkCloseWorktree,
  registerCloseCommitWindow,
  requireTargetRepoClosureAuthority,
  requiredValidationPassesForClosure,
  type ClosurePacket,
  validateClosurePacket,
  writeClosurePacket
} from '../framework-development.ts';
import { assertEmergencyApproval, recordProtectedOverrideOutcome } from '../emergency/gate.ts';
import {
  assertTaskCloseAllowedByDirection,
  advanceTaskQueueAfterClose
} from '../task-direction.ts';
import { findActiveBatchRunForTask, readActiveBatchRun } from '../work-channels.ts';
import { evaluateTaskDoneCloseAdmission } from './lifecycle-state.ts';
import {
  buildHistoricalDeliveryProvenance,
  inspectHistoricalDelivery,
  pathMatchesTaskScope
} from './historical-delivery.ts';
import {
  attachDirtyGuardToScopedDiffIsolation,
  buildCloseScopedDiffIsolation,
  evaluateFrameworkCloseDirtyGuard
} from './scope-lock-diagnostics.ts';
import { parseClaimRecord } from './task-ledger-readers.ts';
import { normalizeRelativePath, taskPathFor } from './task-file-io-helpers.ts';
// TASK-RFT-0013: import close-helper clusters directly rather than through tasks.ts re-exports.
import {
  type HistoricalBatchCloseSlice,
  loadHistoricalBatchCloseSlice,
  evaluateFrameworkDeliveryWindow,
  readDeferredForeignStagedFilesForActiveCloseWindow
} from './close-helpers/close-window-diagnostics.ts';
import {
  extractTaskCloseDeclaredFiles,
  extractTaskDeliverableFiles,
  evaluateTaskDeliverableGate,
  existingTaskCloseArtifacts,
  stageTaskCloseArtifacts,
  taskDeliveryPrincipleText
} from './close-helpers/close-artifact-staging.ts';
import {
  writeTaskDocumentWithTransition,
  buildTaskTransitionCommand,
  createClosureTransitionMetadata
} from './close-helpers/task-transition-writer.ts';
import {
  uniqueStrings,
  isCliErrorWithCode,
  recordStaleRunnerOverride,
  recordFailedEmergencyUseAttempt,
  type EmergencyUseEvidence
} from '../tasks.ts';
import { parseCloseOptions } from './task-option-parsers.ts';

export async function runTasksClose(argv: string[]) {
  const options = parseCloseOptions(argv);
  const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks close requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
  }
  const actorId = resolvedActor.actorId;
  const protectedCloseSurface = 'tasks close historical-delivery backend';
  let historicalBatchSlice: HistoricalBatchCloseSlice | null = null;
  let effectiveHistoricalDeliveryRefs: readonly string[] = [...options.historicalDeliveryRefs];
  if (options.historicalBatchRef) {
    historicalBatchSlice = loadHistoricalBatchCloseSlice(options.cwd, options.taskId, options.historicalBatchRef);
    if (!historicalBatchSlice.okToCloseTask) {
      throw new CliError('ATM_TASK_CLOSE_HISTORICAL_BATCH_NOT_CLOSE_READY', `Task ${options.taskId} cannot close from historical batch ${historicalBatchSlice.batchId} because the slice is not close-ready.`, {
        exitCode: 1,
        details: {
          taskId: options.taskId,
          batchId: historicalBatchSlice.batchId,
          batchPath: historicalBatchSlice.batchPath,
          coverageStatus: historicalBatchSlice.coverageStatus,
          okToRecordEvidence: historicalBatchSlice.okToRecordEvidence,
          okToCloseTask: historicalBatchSlice.okToCloseTask,
          diagnosticOnly: historicalBatchSlice.diagnosticOnly,
          missingCoverage: historicalBatchSlice.missingCoverage,
          taskSpecificValidationPasses: historicalBatchSlice.taskSpecificValidationPasses
        }
      });
    }
    effectiveHistoricalDeliveryRefs = uniqueStrings([...effectiveHistoricalDeliveryRefs, ...historicalBatchSlice.matchedCommits]);
  }
  const allowHistoricalCloseback = effectiveHistoricalDeliveryRefs.length > 0 || Boolean(options.historicalBatchRef);
  const governedHistoricalBatchCheckpoint = options.fromBatchCheckpoint === true
    && historicalBatchSlice?.okToCloseTask === true
    && options.historicalDeliveryRefs.length === 0;
  const protectedCloseFlags = [
    ...(effectiveHistoricalDeliveryRefs.length > 0 && !governedHistoricalBatchCheckpoint ? ['--historical-delivery'] : []),
    ...(options.historicalBatchRef && !governedHistoricalBatchCheckpoint ? ['--historical-batch'] : []),
    ...(options.historicalDeliveryRepo ? ['--historical-delivery-repo'] : []),
    ...(options.waiverOutOfScopeDelivery ? ['--waiver-out-of-scope-delivery'] : []),
    ...(options.allowStaleRunner ? ['--allow-stale-runner'] : [])
  ];
  const protectedCloseCommand = `node atm.mjs tasks close --task ${options.taskId} --actor ${actorId} --status ${options.status} --json`;
  const requiresProtectedCloseApproval = protectedCloseFlags.length > 0;
  const shouldDeferProtectedCloseApproval = requiresProtectedCloseApproval && !options.allowStaleRunner;
  let emergencyUse: EmergencyUseEvidence = null;
  let failedEmergencyAuditPath: string | null = null;
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
    const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>;
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
  // TASK-AAO-0057: scoped diff isolation — partition framework critical changes
  // into in-scope (must be governed) vs unrelated (advisory, isolated) so that
  // dirty/untracked files outside the task scope never hard-block close.
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
    const historicalDeliveredFiles = uniqueStrings(
      effectiveHistoricalDeliveryRefs.flatMap((ref) => inspectHistoricalDelivery({
        cwd: options.historicalDeliveryRepo ?? options.cwd,
        taskId: options.taskId,
        requestedRef: ref,
        declaredFiles: taskDeclaredFiles,
        enforceDeclaredScope: true,
        waiverOutOfScopeDelivery: options.waiverOutOfScopeDelivery === true,
        waiverReason: options.reason ?? null
      }).deliverableFiles)
    );
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
      ? closeWorktree.trackedDirtyFiles.filter((entry) =>
        taskDeclaredFiles.some((declared) => pathMatchesTaskScope(entry, declared))
      )
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
      closeScopedDiffIsolation = attachDirtyGuardToScopedDiffIsolation(
        closeScopedDiffIsolation,
        effectiveCloseDirtyGuard,
        closeWorktree.ignoredUntrackedFiles
      );
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
      details: deliverableGate as unknown as Record<string, unknown>
    });
  }

  let closurePacketPath: string | null = null;
  let closurePacket: ClosurePacket | null = null;
  let pendingClosurePacket: ClosurePacket | null = null;
  let createdClosurePacketAbsolute: string | null = null;
  const existingClosurePacketPath = typeof taskDocument.closurePacket === 'string'
    ? taskDocument.closurePacket
    : typeof taskDocument.closure_packet === 'string'
      ? taskDocument.closure_packet
      : null;
  if (options.status === 'done' && existingClosurePacketPath) {
    const packetPath = path.resolve(options.cwd, existingClosurePacketPath);
    if (!existsSync(packetPath)) {
      throw new CliError('ATM_TASK_CLOSE_CLOSURE_PACKET_MISSING', `Task ${options.taskId} references a missing closure packet.`, {
        details: { taskId: options.taskId, closurePacketPath: existingClosurePacketPath }
      });
    }
    const packet = JSON.parse(readFileSync(packetPath, 'utf8')) as ClosurePacket;
    const validation = validateClosurePacket(packet);
    if (!validation.ok) {
      // TASK-AAO-0017: 加入 TL;DR 和結構化缺失 validator 報告
      const missingReport = computeMissingValidatorReport(options.cwd, options.taskId, actorId);
      throw new CliError('ATM_TASK_CLOSE_CLOSURE_PACKET_INVALID', `Task ${options.taskId} closure packet is invalid.`, {
        details: {
          taskId: options.taskId,
          closurePacketPath: existingClosurePacketPath,
          missing: validation.missing,
          invalidFormat: validation.invalidFormat,
          tldr: missingReport.tldr,
          missingValidationPasses: missingReport.missingValidationPasses,
          blockingFindings: missingReport.blockingFindings
        }
      });
    }
    closurePacket = packet;
    closurePacketPath = existingClosurePacketPath;
  } else if (options.status === 'done' && frameworkStatus?.repoRole === 'framework') {
    const closePacketChangedFiles = deliverableGate?.deliverableFiles.length ? deliverableGate.deliverableFiles : taskDeclaredFiles;
    pendingClosurePacket = createClosurePacket({
      cwd: options.cwd,
      taskId: options.taskId,
      actorId,
      sessionId: activeSession?.sessionId ?? null,
      evidencePath: `.atm/history/evidence/${options.taskId}.json`,
      requiredGates: historicalBatchSlice?.okToCloseTask === true
        ? uniqueStrings([
          ...historicalBatchSlice.taskSpecificValidationPasses,
          ...historicalBatchSlice.batchWideValidationPasses
        ])
        : requiredValidationPassesForClosure(frameworkStatus.requiredGates, closePacketChangedFiles),
      changedFiles: closePacketChangedFiles,
      frameworkStatus,
      validationPasses: historicalBatchSlice?.okToCloseTask === true
        ? uniqueStrings([
          ...historicalBatchSlice.taskSpecificValidationPasses,
          ...historicalBatchSlice.batchWideValidationPasses,
          ...historicalBatchSlice.advisoryValidationPasses
        ])
        : undefined,
      evidenceFreshness: historicalBatchSlice?.okToCloseTask === true ? 'fresh' : undefined,
      historicalDeliveryProvenance: buildHistoricalDeliveryProvenance(
        deliverableGate?.historicalDeliveries[0] ?? null,
        options.reason
      )
    });
    const validation = validateClosurePacket(pendingClosurePacket);
    if (!validation.ok) {
      // TASK-AAO-0017: 加入 TL;DR 和結構化缺失 validator 報告
      const missingReport = computeMissingValidatorReport(options.cwd, options.taskId, actorId);
      throw new CliError('ATM_TASK_CLOSE_CLOSURE_PACKET_INVALID', `Task ${options.taskId} closure packet contract is incomplete.`, {
        details: {
          taskId: options.taskId,
          missing: validation.missing,
          invalidFormat: validation.invalidFormat,
          tldr: missingReport.tldr,
          missingValidationPasses: missingReport.missingValidationPasses,
          blockingFindings: missingReport.blockingFindings
        }
      });
    }
    closurePacket = pendingClosurePacket;
    createdClosurePacketAbsolute = path.join(options.cwd, '.atm', 'history', 'evidence', `${options.taskId}.closure-packet.json`);
  }

  if (options.status === 'done') {
    const finalPacketPath = existingClosurePacketPath || (pendingClosurePacket ? `.atm/history/evidence/${options.taskId}.closure-packet.json` : null);
    const finalPacket = closurePacket || pendingClosurePacket;
    const evaluatedMetadata = createClosureTransitionMetadata(
      finalPacketPath,
      finalPacket,
      owningBatch?.batchId ?? options.batchId,
      activeSession?.sessionId ?? null
    );
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
  const closeTransitionCommand = buildTaskTransitionCommand({
    action: options.status === 'blocked' ? 'block' : options.status === 'abandoned' ? 'abandon' : 'close',
    taskId: options.taskId,
    actorId,
    status: options.status,
    fromBatchCheckpoint: options.fromBatchCheckpoint,
    batchId: owningBatch?.batchId ?? options.batchId,
    historicalDeliveryRefs: effectiveHistoricalDeliveryRefs
  });
  const closeWriteResult = await executeTaskCloseTransaction({
    cwd: options.cwd,
    taskId: options.taskId,
    taskPath,
    phase: 'close',
    previousTaskContent,
    createdClosurePacketAbsolute,
    runWrites: () => {
      if (pendingClosurePacket) {
        closurePacketPath = writeClosurePacket(options.cwd, options.taskId, pendingClosurePacket);
        closurePacket = pendingClosurePacket;
        taskDocument.closurePacket = closurePacketPath;
      }
      const transitionPath = writeTaskDocumentWithTransition({
        cwd: options.cwd,
        taskPath,
        taskId: options.taskId,
        taskDocument,
        action: options.status === 'blocked' ? 'block' : options.status === 'abandoned' ? 'abandon' : 'close',
        actorId,
        sessionId: activeSession?.sessionId ?? null,
        previousStatus,
        closureMetadata: options.status === 'done'
          ? createClosureTransitionMetadata(closurePacketPath, closurePacket, owningBatch?.batchId ?? options.batchId, activeSession?.sessionId ?? null)
          : null,
        command: closeTransitionCommand
      });
      return { transitionPath, closurePacketPath };
    }
  });
  const transitionPath = closeWriteResult.transitionPath;
  closurePacketPath = closeWriteResult.closurePacketPath ?? closurePacketPath;
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
  // TASK-AAO-0136: register close-commit-window for done closes so the captain's
  // follow-up `git commit --task <id>` can land closure-packet + transition + ledger
  // even though the direction lock has now released.
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
  let protectedOverrideOutcome: ReturnType<typeof recordProtectedOverrideOutcome> | null = null;
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
  return makeResult({
    ok: true,
    command: 'tasks',
    cwd: options.cwd,
    messages: [message('info', 'ATM_TASKS_CLOSED', `Task ${options.taskId} moved to ${options.status}.`, {
      taskId: options.taskId,
      actorId,
      status: options.status,
      closeCommitWindowPath: closeCommitWindowPathFromClose
    })],
    evidence: {
      action: 'close',
      taskId: options.taskId,
      actorId,
      status: options.status,
      taskPath: relativePathFrom(options.cwd, taskPath),
      evidenceGate,
      closurePacketPath,
      transitionPath,
      closeCommitWindowPath: closeCommitWindowPathFromClose,
      closeCommitWindowAllowedFiles: closeArtifactFiles,
      deliverableGate: deliverableGate as unknown as Record<string, unknown> | null,
      cleanedTeamRuns,
      // TASK-AAO-0057: scoped diff isolation diagnostic — exposes which framework
      // critical changes were in-scope vs isolated as advisory unrelated changes.
      closeScopedDiffIsolation,
      emergencyUse,
      protectedOverrideOutcome,
      failedEmergencyAuditPath,
      taskQueue,
      historicalBatchSlice
    }
  });
  } catch (error) {
    if (
      shouldDeferProtectedCloseApproval
      && options.emergencyApproval
      && !emergencyUse
      && !isCliErrorWithCode(error, 'ATM_EMERGENCY_')
    ) {
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
