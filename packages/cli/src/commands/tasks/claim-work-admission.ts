import type { TaskClaimRecord, WorkItemRef } from '@ai-atomic-framework/core';
import { createLocalGovernanceAdapter } from '../../../../plugin-governance-local/src/index.ts';
import { issueWorkAdmissionTicket, type WorkAdmissionTicket } from '../../../../core/src/broker/work-admission-ticket.ts';
import { upsertActorWorkSession, type ActorWorkSessionDocument } from '../actor-session.ts';
import { CliError, relativePathFrom, resolveValue } from '../shared.ts';
import { findActiveTaskQueue, writeTaskDirectionLock, type TaskDirectionLock } from '../task-direction.ts';
import type { LaneSessionResolution } from '../lane-session/resolve.ts';
import { writeTaskDocumentWithTransition } from './close-helpers/task-transition-writer.ts';
import { createClaimRecord } from './task-ledger-readers.ts';

interface ClaimLifecyclePhase {
  readonly phase: string;
  readonly durationMs: number;
}

export async function completeTaskClaimWithWorkAdmission(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly taskPath: string;
  readonly taskRef: WorkItemRef;
  readonly taskDocument: Record<string, unknown>;
  readonly files: readonly string[];
  readonly ttlSeconds: number;
  readonly claimIntent: string;
  readonly laneSession: LaneSessionResolution;
  readonly previousStatus: string;
  readonly planningReadOnlyPaths: readonly string[];
  readonly planningMirrorPaths: readonly string[];
  readonly allowPlanningMirror: boolean;
  readonly nowIso: string;
  readonly phases: Array<ClaimLifecyclePhase>;
}): Promise<{
  readonly claim: TaskClaimRecord & { readonly intent: string; readonly laneSession: LaneSessionResolution['envelope'] };
  readonly ticket: WorkAdmissionTicket | null;
  readonly session: ActorWorkSessionDocument;
  readonly transitionPath: string;
  readonly taskDirectionLock: TaskDirectionLock;
}> {
  const claim = {
    ...createClaimRecord({
      taskId: input.taskId,
      actorId: input.actorId,
      files: input.files,
      ttlSeconds: input.ttlSeconds,
      timestamp: input.nowIso
    }),
    intent: input.claimIntent,
    laneSession: input.laneSession.envelope
  };
  const ticket = input.claimIntent === 'write'
    ? issueWorkAdmissionTicket({
      taskId: input.taskId,
      actorId: input.actorId,
      laneSessionId: input.laneSession.session.laneId,
      claimGeneration: String(claim.leaseId),
      allowedFiles: taskScopeFiles(input.taskDocument, input.files),
      requestedRecoveryMode: readRequestedRecoveryMode(input.taskDocument),
      runnerSelection: {
        runnerKind: 'frozen',
        runnerRef: 'release/atm-onefile/atm.mjs',
        selectedAt: input.nowIso
      },
      elevatedRisk: assessElevatedRisk(input.taskDocument),
      now: input.nowIso,
      ttlSeconds: input.ttlSeconds
    })
    : null;
  const adapter = createLocalGovernanceAdapter({ repositoryRoot: input.cwd });
  try {
    const startedAt = Date.now();
    await resolveValue(adapter.stores.lockStore.acquireLock(input.taskRef, input.files, input.actorId));
    input.phases.push({ phase: 'lock-acquire', durationMs: Date.now() - startedAt });
  } catch (error) {
    if (errorCode(error) === 'ATM_LOCK_CONFLICT') {
      throw new CliError('ATM_LOCK_CONFLICT', `Task ${input.taskId} has an active conflicting lock.`, {
        exitCode: 1,
        details: errorDetails(error)
      });
    }
    throw error;
  }
  input.taskDocument.claim = claim;
  input.taskDocument.owner = input.actorId;
  input.taskDocument.startedAt = String(input.taskDocument.startedAt ?? input.nowIso);
  input.taskDocument.startedByActor = String(input.taskDocument.startedByActor ?? input.actorId);
  if (ticket) {
    input.taskDocument.workAdmissionTicket = ticket;
    input.taskDocument.workAdmission = {
      ...(readRecord(input.taskDocument.workAdmission) ?? {}),
      recoveryMode: ticket.recovery.requestedMode,
      resolvedRecoveryMode: ticket.recovery.resolvedMode,
      policyDigest: ticket.recovery.policyDigest
    };
  }
  const sessionRecord = upsertActorWorkSession({
    cwd: input.cwd,
    actorId: input.actorId,
    taskId: input.taskId,
    claimLeaseId: String(claim.leaseId),
    status: 'active',
    taskPath: relativePathFrom(input.cwd, input.taskPath),
    timestamp: input.nowIso,
    guidanceSessionId: input.laneSession.session.laneId
  });
  input.taskDocument.startedBySessionId = sessionRecord.session.sessionId;
  input.taskDocument.status = 'running';
  const directionStartedAt = Date.now();
  const directionLock = writeTaskDirectionLock({
    cwd: input.cwd,
    taskId: input.taskId,
    actorId: input.actorId,
    queue: findActiveTaskQueue(input.cwd),
    batchId: null,
    scopeKey: null,
    allowedFiles: input.files,
    planningReadOnlyPaths: input.planningReadOnlyPaths,
    planningMirrorPaths: input.planningMirrorPaths,
    allowPlanningMirror: input.allowPlanningMirror,
    prompt: input.taskId,
    sessionId: sessionRecord.session.sessionId,
    laneSession: input.laneSession.envelope
  });
  input.phases.push({ phase: 'direction-lock-write', durationMs: Date.now() - directionStartedAt });
  input.taskDocument.taskDirectionLock = directionLock;
  const transitionStartedAt = Date.now();
  const transitionPath = writeTaskDocumentWithTransition({
    cwd: input.cwd,
    taskPath: input.taskPath,
    taskId: input.taskId,
    taskDocument: input.taskDocument,
    action: 'claim',
    actorId: input.actorId,
    sessionId: sessionRecord.session.sessionId,
    previousStatus: input.previousStatus
  });
  input.phases.push({ phase: 'task-transition-write', durationMs: Date.now() - transitionStartedAt });
  return { claim, ticket, session: sessionRecord.session, transitionPath, taskDirectionLock: directionLock };
}

/** Rebinds a claim ticket whenever a governed renew changes its validity window. */
export function resealWorkAdmissionTicketForRenewal(input: {
  readonly taskId: string;
  readonly actorId: string;
  readonly taskDocument: Record<string, unknown>;
  readonly claim: TaskClaimRecord;
  readonly nowIso: string;
}): WorkAdmissionTicket {
  const laneSession = readRecord((input.claim as TaskClaimRecord & { readonly laneSession?: unknown }).laneSession);
  const laneSessionId = laneSession?.laneSessionId ?? laneSession?.laneId;
  const ticket = issueWorkAdmissionTicket({
    taskId: input.taskId,
    actorId: input.actorId,
    laneSessionId: typeof laneSessionId === 'string' ? laneSessionId : null,
    claimGeneration: String(input.claim.leaseId),
    allowedFiles: taskScopeFiles(input.taskDocument, []),
    requestedRecoveryMode: readRequestedRecoveryMode(input.taskDocument),
    runnerSelection: {
      runnerKind: 'frozen',
      runnerRef: 'release/atm-onefile/atm.mjs',
      selectedAt: input.nowIso
    },
    elevatedRisk: assessElevatedRisk(input.taskDocument),
    now: input.nowIso,
    ttlSeconds: input.claim.ttlSeconds
  });
  input.taskDocument.workAdmissionTicket = ticket;
  input.taskDocument.workAdmission = {
    ...(readRecord(input.taskDocument.workAdmission) ?? {}),
    recoveryMode: ticket.recovery.requestedMode,
    resolvedRecoveryMode: ticket.recovery.resolvedMode,
    policyDigest: ticket.recovery.policyDigest
  };
  return ticket;
}

function taskScopeFiles(taskDocument: Record<string, unknown>, fallback: readonly string[]): readonly string[] {
  return Array.isArray(taskDocument.scopePaths)
    ? taskDocument.scopePaths.map(String)
    : fallback;
}

function readRequestedRecoveryMode(taskDocument: Record<string, unknown>): 'auto' | 'enabled' | 'disabled' {
  const admission = readRecord(taskDocument.workAdmission);
  const value = String(admission?.recoveryMode ?? 'auto').trim().toLowerCase();
  return value === 'enabled' || value === 'disabled' ? value : 'auto';
}

function assessElevatedRisk(taskDocument: Record<string, unknown>) {
  const paths = taskScopeFiles(taskDocument, []);
  return {
    complex: paths.length > 12,
    destructiveCapability: false,
    sharedSurface: paths.some((entry) => entry.startsWith('packages/core/') || entry.startsWith('schemas/') || entry.startsWith('docs/governance/')),
    workerEvidence: 'trusted' as const
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function errorCode(error: unknown): string | null {
  return error && typeof error === 'object' && typeof (error as { code?: unknown }).code === 'string'
    ? (error as { code: string }).code
    : null;
}

function errorDetails(error: unknown): Record<string, unknown> {
  const details = error && typeof error === 'object' ? (error as { details?: unknown }).details : null;
  return details && typeof details === 'object' && !Array.isArray(details) ? details as Record<string, unknown> : {};
}
