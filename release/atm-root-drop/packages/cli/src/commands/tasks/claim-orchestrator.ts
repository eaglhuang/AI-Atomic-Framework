import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { TaskClaimRecord, WorkItemRef } from '@ai-atomic-framework/core';
import { createLocalGovernanceAdapter } from '../../../../plugin-governance-local/src/index.ts';
import { clearBrokerRuntimeStateForTask, removeBrokerRegistryIfEmpty } from '../../../../core/src/broker/lifecycle.ts';
import { resolveActorId } from '../actor-registry.ts';
import { upsertActorWorkSession, updateActorWorkSessionState } from '../actor-session.ts';
import { buildDependencyCloseoutRecoveryCommand, formatDependencyCloseoutBlockedMessage, assessCloseoutProvenanceGap } from './closeout-provenance.ts';
import { findTaskClaimDependencyBlockers, type TaskClaimDependencyBlocker } from './dependency-gates.ts';
import { evaluateTaskClaimAdmission } from './lifecycle-state.ts';
import { CliError, makeResult, message, relativePathFrom, resolveValue } from '../shared.ts';
import { findActiveTaskQueue, writeTaskDirectionLock } from '../task-direction.ts';
import { normalizeWorkItemStatus } from './task-transition-helpers.ts';
import { writeTaskDocumentWithTransition } from './close-helpers/task-transition-writer.ts';
import { taskPathFor } from './task-file-io-helpers.ts';
import { parseClaimRecord, createClaimRecord, isClaimExpired } from './task-ledger-readers.ts';
import { parseClaimLifecycleOptions } from './task-option-parsers.ts';
import { resolveTaskClaimIntent } from './claim-intent.ts';
import { writeTakeoverEvidence } from './takeover-evidence.ts';
import { assertPlanningSourceSealValid } from './import-task.ts';
import { resolveLaneSession } from '../lane-session/resolve.ts';

function normalizeTaskStatus(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
}

export async function runTasksClaimLifecycle(action: 'claim' | 'renew' | 'release' | 'handoff' | 'takeover', argv: string[]) {
  const claimLifecycleStartedAt = Date.now();
  const claimLifecyclePhases: Array<{ readonly phase: string; readonly durationMs: number }> = [];
  const options = parseClaimLifecycleOptions(action, argv);
  const resolvedActor = resolveActorId(options.actorId ?? undefined, options.cwd);
  if (!resolvedActor) {
    throw new CliError('ATM_ACTOR_ID_MISSING', 'tasks claim lifecycle requires --actor or ATM_ACTOR_ID (legacy alias: AGENT_IDENTITY).', { exitCode: 2 });
  }
  const actorId = resolvedActor.actorId;
  const taskPath = taskPathFor(options.cwd, options.taskId);
  if (!existsSync(taskPath)) {
    throw new CliError('ATM_TASK_NOT_FOUND', `Task file not found for ${options.taskId}.`, {
      exitCode: 2,
      details: { taskPath: relativePathFrom(options.cwd, taskPath), taskId: options.taskId }
    });
  }
  const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8')) as Record<string, unknown>;
  let planningSourceSealValidation: ReturnType<typeof assertPlanningSourceSealValid> | null = null;
  const nowIso = new Date().toISOString();
  const adapter = createLocalGovernanceAdapter({ repositoryRoot: options.cwd });
  const existingTask = await resolveValue(adapter.stores.taskStore.getTask(options.taskId));
  const taskRef: WorkItemRef = existingTask ?? {
    workItemId: options.taskId,
    title: String(taskDocument.title ?? options.taskId),
    status: normalizeWorkItemStatus(taskDocument.status)
  };
  const relativeTaskPath = relativePathFrom(options.cwd, taskPath);
  const files = options.files.length > 0 ? options.files : [relativeTaskPath];
  const currentClaim = parseClaimRecord(taskDocument.claim);
  if (action === 'claim') {
    planningSourceSealValidation = assertPlanningSourceSealValid({
      cwd: options.cwd,
      taskDocument,
      surface: 'claim'
    });
    if (currentClaim && currentClaim.state === 'active' && currentClaim.actorId !== actorId) {
      throw new CliError('ATM_LOCK_CONFLICT', `Task ${options.taskId} is already claimed by ${currentClaim.actorId}.`, {
        exitCode: 1,
        details: { taskId: options.taskId, actorId: currentClaim.actorId, leaseId: currentClaim.leaseId }
      });
    }
    const claimIntentResolution = resolveTaskClaimIntent({
      cwd: options.cwd,
      taskId: options.taskId,
      taskDocument,
      requestedClaimIntent: options.claimIntent,
      autoIntent: options.autoIntent === true && options.claimIntentExplicit !== true,
      explicitClaimIntent: options.claimIntentExplicit === true
    });
    claimLifecyclePhases.push({ phase: 'claim-intent-resolution', durationMs: 0 });
    if (options.claimIntentExplicit === true
      && options.claimIntent === 'closeout-only'
      && claimIntentResolution.dirtyInScopeFiles.length > 0) {
      throw new CliError('ATM_CLAIM_INTENT_CONFLICT', `closeout-only claim requires a clean in-scope source tree. Found dirty: ${claimIntentResolution.dirtyInScopeFiles.join(', ')}. Re-claim with --claim-intent write or revert those changes first.`, {
        exitCode: 1,
        details: {
          taskId: options.taskId,
          claimIntent: options.claimIntent,
          dirtyInScopeFiles: claimIntentResolution.dirtyInScopeFiles,
          requiredCommand: `node atm.mjs tasks claim --task ${options.taskId} --actor ${actorId} --claim-intent write --files <scoped-files> --json`
        }
      });
    }
    const claimAdmission = evaluateTaskClaimAdmission({
      taskId: options.taskId,
      actorId,
      status: String(taskDocument.status ?? ''),
      claimIntent: claimIntentResolution.resolvedClaimIntent,
      currentClaimActorId: currentClaim?.actorId ?? null,
      currentClaimState: currentClaim?.state ?? null
    });
    claimLifecyclePhases.push({ phase: 'claim-admission', durationMs: 0 });
    if (!claimAdmission.ok) {
      throw new CliError(claimAdmission.code, claimAdmission.message, {
        exitCode: 1,
        details: claimAdmission.details
      });
    }
    const dependencyBlockers = findTaskClaimDependencyBlockers(options.cwd, options.taskId, taskDocument);
    claimLifecyclePhases.push({ phase: 'dependency-gate', durationMs: 0 });
    if (dependencyBlockers.length > 0) {
      const firstBlocker = dependencyBlockers[0];
      const closeoutBlocker = firstBlocker as TaskClaimDependencyBlocker;
      const requiredCmd = closeoutBlocker.requiredCommand
        ?? (closeoutBlocker.status === 'incomplete-closeout' || closeoutBlocker.status === 'source-done-governance-incomplete'
          ? buildDependencyCloseoutRecoveryCommand(closeoutBlocker)
          : `node atm.mjs tasks status --task ${firstBlocker.taskId} --json`);
      const blockerMessage = closeoutBlocker.status === 'source-done-governance-incomplete'
        ? formatDependencyCloseoutBlockedMessage(closeoutBlocker)
        : `Task ${options.taskId} cannot be claimed until prerequisite task(s) close.`;
      throw new CliError('ATM_TASK_CLAIM_DEPENDENCY_BLOCKED', blockerMessage, {
        exitCode: 1,
        details: {
          taskId: options.taskId,
          dependencyTaskIds: dependencyBlockers.map((entry) => entry.taskId),
          dependencyStatuses: dependencyBlockers,
          requiredCommand: requiredCmd,
          closeoutGap: firstBlocker.status === 'source-done-governance-incomplete'
            ? assessCloseoutProvenanceGap(options.cwd, firstBlocker.taskId, JSON.parse(readFileSync(firstBlocker.taskPath, 'utf8')) as Record<string, unknown>)
            : null
        }
      });
    }
    const laneSession = resolveLaneSession({
      cwd: options.cwd,
      actorId,
      taskId: options.taskId,
      command: `node atm.mjs tasks claim --task ${options.taskId} --actor ${actorId} --json`
    });
    // TASK-CID-0024: persist the declared claim intent so downstream gates
    // (next --claim parallel preflight, hook pre-commit ownership checks) can
    // distinguish mutating write claims from non-mutating closeout-only claims.
    const claim = {
      ...createClaimRecord({
        taskId: options.taskId,
        actorId,
        files,
        ttlSeconds: options.ttlSeconds,
        timestamp: nowIso
      }),
      intent: claimIntentResolution.resolvedClaimIntent,
      laneSession: laneSession.envelope
    };
    try {
      const lockAcquireStartedAt = Date.now();
      await resolveValue(adapter.stores.lockStore.acquireLock(taskRef, files, actorId));
      claimLifecyclePhases.push({ phase: 'lock-acquire', durationMs: Date.now() - lockAcquireStartedAt });
    } catch (error) {
      const code = extractErrorCode(error);
      if (code === 'ATM_LOCK_CONFLICT') {
        throw new CliError('ATM_LOCK_CONFLICT', `Task ${options.taskId} has an active conflicting lock.`, {
          exitCode: 1,
          details: extractErrorDetails(error)
        });
      }
      throw error;
    }
    taskDocument.claim = claim;
    taskDocument.owner = actorId;
    taskDocument.startedAt = String(taskDocument.startedAt ?? nowIso);
    taskDocument.startedByActor = String(taskDocument.startedByActor ?? actorId);
    const sessionRecord = upsertActorWorkSession({
      cwd: options.cwd,
      actorId,
      taskId: options.taskId,
      claimLeaseId: claim.leaseId,
      status: 'active',
      taskPath: relativeTaskPath,
      timestamp: nowIso,
      guidanceSessionId: laneSession.session.laneId
    });
    taskDocument.startedBySessionId = sessionRecord.session.sessionId;
    const previousStatus = String(taskDocument.status ?? '');
    taskDocument.status = 'running';
    const directionLockStartedAt = Date.now();
    const directionLock = writeTaskDirectionLock({
      cwd: options.cwd,
      taskId: options.taskId,
      actorId,
      queue: findActiveTaskQueue(options.cwd),
      batchId: null,
      scopeKey: null,
      allowedFiles: files,
      planningReadOnlyPaths: Array.isArray(taskDocument.planningReadOnlyPaths) ? taskDocument.planningReadOnlyPaths as string[] : [],
      planningMirrorPaths: Array.isArray(taskDocument.planningMirrorPaths) ? taskDocument.planningMirrorPaths as string[] : [],
      allowPlanningMirror: taskDocument.allowPlanningMirror === true,
      prompt: options.taskId,
      sessionId: sessionRecord.session.sessionId,
      laneSession: laneSession.envelope
    });
    claimLifecyclePhases.push({ phase: 'direction-lock-write', durationMs: Date.now() - directionLockStartedAt });
    taskDocument.taskDirectionLock = directionLock;
    const transitionStartedAt = Date.now();
    const transitionPath = writeTaskDocumentWithTransition({
      cwd: options.cwd,
      taskPath,
      taskId: options.taskId,
      taskDocument,
      action,
      actorId,
      sessionId: sessionRecord.session.sessionId,
      previousStatus
    });
    claimLifecyclePhases.push({ phase: 'task-transition-write', durationMs: Date.now() - transitionStartedAt });
    return makeResult({
      ok: true,
      command: 'tasks',
      cwd: options.cwd,
      messages: [message('info', 'ATM_TASKS_CLAIM_ACQUIRED', `Claim acquired for ${options.taskId}.`, {
        taskId: options.taskId,
        actorId,
        claimIntent: claimIntentResolution.resolvedClaimIntent,
        laneSessionId: laneSession.session.laneId
      }), ...laneSession.messages],
      evidence: {
        action,
        taskId: options.taskId,
        actorId,
        claimIntent: claimIntentResolution.resolvedClaimIntent,
        planningSourceSealValidation,
        claimIntentResolution,
        claim,
        taskPath: relativeTaskPath,
        transitionPath,
        sessionId: sessionRecord.session.sessionId,
        session: sessionRecord.session,
        laneSession: laneSession.envelope,
        taskDirectionLock: directionLock,
        claimLatency: {
          schemaId: 'atm.claimLatencyTelemetry.v1',
          totalMs: Date.now() - claimLifecycleStartedAt,
          phases: claimLifecyclePhases
        }
      }
    });
}

  if (!currentClaim && action === 'release' && options.reservedOk && normalizeTaskStatus(taskDocument.status) === 'reserved') {
    const previousStatus = String(taskDocument.status ?? '');
    taskDocument.status = 'open';
    taskDocument.owner = actorId;
    if (options.reason) taskDocument.releaseReason = options.reason;
    const transitionPath = writeTaskDocumentWithTransition({
      cwd: options.cwd,
      taskPath,
      taskId: options.taskId,
      taskDocument,
      action,
      actorId,
      previousStatus
    });
    const sessionRecord = updateActorWorkSessionState({
      cwd: options.cwd,
      actorId,
      taskId: options.taskId,
      claimLeaseId: null,
      status: 'released',
      reason: options.reason ?? null,
      timestamp: nowIso
    });
    return makeResult({
      ok: true,
      command: 'tasks',
      cwd: options.cwd,
      messages: [message('info', 'ATM_TASKS_RESERVED_RELEASED', `Reserved task ${options.taskId} released back to open.`, {
        taskId: options.taskId,
        actorId
      })],
      evidence: {
        action,
        taskId: options.taskId,
        actorId,
        previousStatus,
        status: 'open',
        transitionPath
      }
    });
  }

  if (!currentClaim) {
    throw new CliError('ATM_TASK_CLAIM_MISSING', `Task ${options.taskId} has no active claim record.`, {
      exitCode: 1,
      details: {
        taskId: options.taskId,
        requiredCommand: `node atm.mjs tasks reset --task ${options.taskId} --actor ${actorId} --to open --reason "rollback cleanup" --json`
      }
    });
  }

  if (action === 'renew') {
    if (currentClaim.actorId !== actorId) {
      throw new CliError('ATM_TASK_CLAIM_OWNER_MISMATCH', `Task ${options.taskId} is claimed by ${currentClaim.actorId}, not ${actorId}.`, {
        exitCode: 1,
        details: { taskId: options.taskId, currentActor: currentClaim.actorId, actorId }
      });
    }
    const renewed: TaskClaimRecord = {
      ...currentClaim,
      heartbeatAt: nowIso,
      ttlSeconds: options.ttlSeconds > 0 ? options.ttlSeconds : currentClaim.ttlSeconds,
      state: 'active'
    };
    taskDocument.claim = renewed;
    const sessionRecord = updateActorWorkSessionState({
      cwd: options.cwd,
      actorId,
      taskId: options.taskId,
      claimLeaseId: currentClaim.leaseId,
      status: 'active',
      timestamp: nowIso
    });
    const previousStatus = String(taskDocument.status ?? '');
    taskDocument.status = 'running';
    const transitionPath = writeTaskDocumentWithTransition({
      cwd: options.cwd,
      taskPath,
      taskId: options.taskId,
      taskDocument,
      action,
      actorId,
      sessionId: sessionRecord?.session.sessionId ?? null,
      previousStatus
    });
    clearBrokerRuntimeStateForTask({
      cwd: options.cwd,
      taskId: options.taskId
    });
    removeBrokerRegistryIfEmpty(options.cwd);
    return makeResult({
      ok: true,
      command: 'tasks',
      cwd: options.cwd,
      messages: [message('info', 'ATM_TASKS_CLAIM_RENEWED', `Claim renewed for ${options.taskId}.`, { taskId: options.taskId, actorId })],
      evidence: {
        action,
        taskId: options.taskId,
        actorId,
        claim: renewed,
        transitionPath,
        sessionId: sessionRecord?.session.sessionId ?? null,
        session: sessionRecord?.session ?? null
      }
    });
  }

  if (action === 'release') {
    if (currentClaim.actorId !== actorId) {
      throw new CliError('ATM_TASK_CLAIM_OWNER_MISMATCH', `Task ${options.taskId} is claimed by ${currentClaim.actorId}, not ${actorId}.`, {
        exitCode: 1,
        details: { taskId: options.taskId, currentActor: currentClaim.actorId, actorId }
      });
    }
    const releasedClaim: TaskClaimRecord = {
      ...currentClaim,
      heartbeatAt: nowIso,
      state: 'released',
      reason: options.reason ?? currentClaim.reason
    };
    await resolveValue(adapter.stores.lockStore.releaseLock(options.taskId, actorId));
    taskDocument.claim = releasedClaim;
    const sessionRecord = updateActorWorkSessionState({
      cwd: options.cwd,
      actorId,
      taskId: options.taskId,
      claimLeaseId: currentClaim.leaseId,
      status: 'released',
      reason: options.reason ?? currentClaim.reason ?? null,
      timestamp: nowIso
    });
    const previousStatus = String(taskDocument.status ?? '');
    if (String(taskDocument.status ?? '') === 'running') {
      taskDocument.status = 'open';
    }
    const transitionPath = writeTaskDocumentWithTransition({
      cwd: options.cwd,
      taskPath,
      taskId: options.taskId,
      taskDocument,
      action,
      actorId,
      sessionId: sessionRecord?.session.sessionId ?? null,
      previousStatus
    });
    clearBrokerRuntimeStateForTask({
      cwd: options.cwd,
      taskId: options.taskId
    });
    removeBrokerRegistryIfEmpty(options.cwd);
    return makeResult({
      ok: true,
      command: 'tasks',
      cwd: options.cwd,
      messages: [message('info', 'ATM_TASKS_CLAIM_RELEASED', `Claim released for ${options.taskId}.`, { taskId: options.taskId, actorId })],
      evidence: {
        action,
        taskId: options.taskId,
        actorId,
        claim: releasedClaim,
        transitionPath,
        sessionId: sessionRecord?.session.sessionId ?? null,
        session: sessionRecord?.session ?? null
      }
    });
  }

  if (action === 'handoff') {
    if (!options.handoffTo) {
      throw new CliError('ATM_CLI_USAGE', 'tasks handoff requires --to <actor-id>.', { exitCode: 2 });
    }
    if (currentClaim.actorId !== actorId) {
      throw new CliError('ATM_TASK_CLAIM_OWNER_MISMATCH', `Task ${options.taskId} is claimed by ${currentClaim.actorId}, not ${actorId}.`, {
        exitCode: 1,
        details: { taskId: options.taskId, currentActor: currentClaim.actorId, actorId }
      });
    }
    await resolveValue(adapter.stores.lockStore.releaseLock(options.taskId, actorId));
    const handedOff: TaskClaimRecord = {
      ...currentClaim,
      heartbeatAt: nowIso,
      state: 'handoff',
      handoffTo: options.handoffTo,
      reason: options.reason ?? 'handoff'
    };
    taskDocument.claim = handedOff;
    taskDocument.owner = options.handoffTo;
    const sessionRecord = updateActorWorkSessionState({
      cwd: options.cwd,
      actorId,
      taskId: options.taskId,
      claimLeaseId: currentClaim.leaseId,
      status: 'handoff',
      reason: options.reason ?? 'handoff',
      timestamp: nowIso
    });
    const previousStatus = String(taskDocument.status ?? '');
    taskDocument.status = 'open';
    const transitionPath = writeTaskDocumentWithTransition({
      cwd: options.cwd,
      taskPath,
      taskId: options.taskId,
      taskDocument,
      action,
      actorId,
      sessionId: sessionRecord?.session.sessionId ?? null,
      previousStatus
    });
    clearBrokerRuntimeStateForTask({
      cwd: options.cwd,
      taskId: options.taskId
    });
    removeBrokerRegistryIfEmpty(options.cwd);
    return makeResult({
      ok: true,
      command: 'tasks',
      cwd: options.cwd,
      messages: [message('info', 'ATM_TASKS_CLAIM_HANDOFF', `Claim for ${options.taskId} handed off to ${options.handoffTo}.`, {
        taskId: options.taskId,
        from: actorId,
        to: options.handoffTo
      })],
      evidence: {
        action,
        taskId: options.taskId,
        actorId,
        handoffTo: options.handoffTo,
        claim: handedOff,
        transitionPath,
        sessionId: sessionRecord?.session.sessionId ?? null,
        session: sessionRecord?.session ?? null
      }
    });
  }

  if (currentClaim.actorId === actorId) {
    throw new CliError('ATM_TASKS_TAKEOVER_SELF', `tasks takeover is intended for a different actor; ${actorId} already owns ${options.taskId}.`, {
      exitCode: 2,
      details: { taskId: options.taskId, actorId }
    });
  }
  if (!options.reason || options.reason.trim().length === 0) {
    throw new CliError('ATM_CLI_USAGE', 'tasks takeover requires --reason <text>.', { exitCode: 2 });
  }
  if (!isClaimExpired(currentClaim, nowIso)) {
    throw new CliError('ATM_TASKS_TAKEOVER_NOT_ALLOWED', `Claim for ${options.taskId} is still active under ${currentClaim.actorId}.`, {
      exitCode: 1,
      details: {
        taskId: options.taskId,
        currentActor: currentClaim.actorId,
        heartbeatAt: currentClaim.heartbeatAt,
        ttlSeconds: currentClaim.ttlSeconds
      }
    });
  }
  await resolveValue(adapter.stores.lockStore.releaseLock(options.taskId, actorId));
  const takeoverClaim: TaskClaimRecord = {
    ...createClaimRecord({
      taskId: options.taskId,
      actorId,
      files,
      ttlSeconds: options.ttlSeconds,
      timestamp: nowIso
    }),
    reason: options.reason ?? `takeover from ${currentClaim.actorId}`
  };
  await resolveValue(adapter.stores.lockStore.acquireLock(taskRef, files, actorId));
  taskDocument.claim = { ...takeoverClaim, state: 'taken_over' };
  taskDocument.owner = actorId;
  const sessionRecord = upsertActorWorkSession({
    cwd: options.cwd,
    actorId,
    taskId: options.taskId,
    claimLeaseId: takeoverClaim.leaseId,
    status: 'taken_over',
    taskPath: relativeTaskPath,
    reason: options.reason ?? `takeover from ${currentClaim.actorId}`,
    timestamp: nowIso
  });
  const previousStatus = String(taskDocument.status ?? '');
  taskDocument.status = 'running';
  const transitionPath = writeTaskDocumentWithTransition({
    cwd: options.cwd,
    taskPath,
    taskId: options.taskId,
    taskDocument,
    action,
    actorId,
    sessionId: sessionRecord.session.sessionId,
    previousStatus
  });
  writeTakeoverEvidence(options.cwd, options.taskId, actorId, currentClaim, takeoverClaim);
  return makeResult({
    ok: true,
    command: 'tasks',
    cwd: options.cwd,
    messages: [message('info', 'ATM_TASKS_CLAIM_TAKEOVER', `Takeover completed for ${options.taskId}.`, {
      taskId: options.taskId,
      actorId,
      previousActor: currentClaim.actorId
    })],
    evidence: {
      action,
      taskId: options.taskId,
      actorId,
      previousClaim: currentClaim,
      claim: takeoverClaim,
      evidencePath: `.atm/history/evidence/${options.taskId}.json`,
      transitionPath,
      sessionId: sessionRecord.session.sessionId,
      session: sessionRecord.session
    }
  });
}





function extractErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.trim().length > 0 ? code : null;
}

function extractErrorDetails(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') return {};
  const details = (error as { details?: unknown }).details;
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {};
  return details as Record<string, unknown>;
}
