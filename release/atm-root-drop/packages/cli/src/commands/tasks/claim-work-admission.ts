import type { TaskClaimRecord, WorkItemRef } from '@ai-atomic-framework/core';
import { createLocalGovernanceAdapter } from '../../../../plugin-governance-local/src/index.ts';
import { classifyForeignGeneratedResidue, type ForeignGeneratedResidueProvenance } from '../../../../core/src/broker/foreign-generated-residue-disposition.ts';
import { isRunnerBuildOutputPath } from '../../../../core/src/broker/runner-build-output-inventory.ts';
import { issueWorkAdmissionTicket, type WorkAdmissionTicket } from '../../../../core/src/broker/work-admission-ticket.ts';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { upsertActorWorkSession, type ActorWorkSessionDocument } from '../actor-session.ts';
import { CliError, relativePathFrom, resolveValue } from '../shared.ts';
import { findActiveTaskQueue, writeTaskDirectionLock, type TaskDirectionLock } from '../task-direction.ts';
import type { LaneSessionResolution } from '../lane-session/resolve.ts';
import { writeTaskDocumentWithTransition } from './close-helpers/task-transition-writer.ts';
import { createClaimRecord, isClaimExpired } from './task-ledger-readers.ts';
import { readLatestGitHeadReceiptTaskId } from '../git-head-evidence.ts';

interface ClaimLifecyclePhase {
  readonly phase: string;
  readonly durationMs: number;
}

export type RenewalDirectionLockRecovery = Readonly<{
  status: 'not-needed' | 'restored';
  directionLock: TaskDirectionLock | null;
}>;

/**
 * Restores only a released runtime direction lock that still belongs to a
 * live renewal.  The caller has already verified actor/lane ownership; this
 * boundary additionally refuses expired or non-active claims.
 */
export function restoreReleasedDirectionLockForRenewal(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly claim: TaskClaimRecord;
  readonly taskDocument: Record<string, unknown>;
  readonly nowIso: string;
}): RenewalDirectionLockRecovery {
  if (input.claim.state !== 'active' || isClaimExpired(input.claim, input.nowIso)) {
    return { status: 'not-needed', directionLock: null };
  }
  const lockPath = path.join(input.cwd, '.atm', 'runtime', 'locks', `${input.taskId}.lock.json`);
  if (!existsSync(lockPath)) return { status: 'not-needed', directionLock: null };
  let outerLock: Record<string, unknown>;
  try {
    outerLock = JSON.parse(readFileSync(lockPath, 'utf8')) as Record<string, unknown>;
  } catch {
    return { status: 'not-needed', directionLock: null };
  }
  if (outerLock.released !== true && outerLock.status !== 'released') {
    return { status: 'not-needed', directionLock: null };
  }
  const priorDirectionLock = outerLock.taskDirectionLock;
  if (!priorDirectionLock || typeof priorDirectionLock !== 'object' || Array.isArray(priorDirectionLock)) {
    return { status: 'not-needed', directionLock: null };
  }
  const prior = priorDirectionLock as Record<string, unknown>;
  const allowedFiles = Array.from(new Set([
    ...input.claim.files,
    ...(Array.isArray(prior.allowedFiles) ? prior.allowedFiles.filter((value): value is string => typeof value === 'string') : [])
  ]));
  const directionLock = writeTaskDirectionLock({
    cwd: input.cwd,
    taskId: input.taskId,
    actorId: input.actorId,
    queue: findActiveTaskQueue(input.cwd, undefined, { taskId: input.taskId }),
    allowedFiles,
    planningReadOnlyPaths: Array.isArray(prior.planningReadOnlyPaths) ? prior.planningReadOnlyPaths.filter((value): value is string => typeof value === 'string') : [],
    planningMirrorPaths: Array.isArray(prior.planningMirrorPaths) ? prior.planningMirrorPaths.filter((value): value is string => typeof value === 'string') : [],
    allowPlanningMirror: prior.allowPlanningMirror === true,
    prompt: input.taskId,
    sessionId: typeof input.taskDocument.startedBySessionId === 'string' ? input.taskDocument.startedBySessionId : null
  });
  input.taskDocument.taskDirectionLock = directionLock;
  return { status: 'restored', directionLock };
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
      allowedFiles: resolveTaskWorkAdmissionFiles(input.taskDocument, input.files, input.cwd),
      requestedRecoveryMode: readRequestedRecoveryMode(input.taskDocument),
      runnerSelection: {
        runnerKind: 'frozen',
        runnerRef: 'release/atm-onefile/atm.mjs',
        selectedAt: input.nowIso
      },
      elevatedRisk: assessElevatedRisk(input.taskDocument),
      deferredForeignResidue: collectDeferredForeignGeneratedResidue(input.cwd, input.taskId),
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
  readonly cwd: string;
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
    allowedFiles: resolveTaskWorkAdmissionFiles(input.taskDocument, [], input.cwd),
    requestedRecoveryMode: readRequestedRecoveryMode(input.taskDocument),
    runnerSelection: {
      runnerKind: 'frozen',
      runnerRef: 'release/atm-onefile/atm.mjs',
      selectedAt: input.nowIso
    },
    elevatedRisk: assessElevatedRisk(input.taskDocument),
    deferredForeignResidue: collectDeferredForeignGeneratedResidue(input.cwd, input.taskId),
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

function collectDeferredForeignGeneratedResidue(cwd: string, candidateTaskId: string): readonly ForeignGeneratedResidueProvenance[] {
  const result = spawnSync('git', ['diff', '--name-only'], { cwd, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) return [];
  return String(result.stdout ?? '').split(/\r?\n/)
    .map((entry) => entry.replace(/\\/g, '/').trim())
    .filter((entry) => entry.startsWith('artifacts/generated/'))
    .flatMap((entry) => {
      const absolute = path.join(cwd, entry);
      if (!existsSync(absolute)) return [];
      const content = readFileSync(absolute, 'utf8');
      const producerTaskId = readProducerTaskId(content);
      const disposition = classifyForeignGeneratedResidue({
        path: entry,
        content,
        candidateTaskId,
        producerDeclaresPath: producerTaskId ? producerDeclaresArtifactPath(cwd, producerTaskId, entry) : false,
        runnerInventoryMember: isRunnerBuildOutputPath(entry)
      });
      return disposition.state === 'deferred' && disposition.provenance ? [disposition.provenance] : [];
    });
}

function readProducerTaskId(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { taskId?: unknown };
    return typeof parsed.taskId === 'string' && parsed.taskId.trim() ? parsed.taskId.trim() : null;
  } catch { return null; }
}

function producerDeclaresArtifactPath(cwd: string, taskId: string, artifactPath: string): boolean {
  const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
  if (!existsSync(taskPath)) return false;
  try {
    const task = JSON.parse(readFileSync(taskPath, 'utf8')) as { scopePaths?: unknown; deliverables?: unknown };
    const values = [...(Array.isArray(task.scopePaths) ? task.scopePaths : []), ...(Array.isArray(task.deliverables) ? task.deliverables : [])];
    return values.some((entry) => String(entry).replace(/\\/g, '/') === artifactPath);
  } catch { return false; }
}

export function resolveTaskWorkAdmissionFiles(taskDocument: Record<string, unknown>, fallback: readonly string[], cwd?: string): readonly string[] {
  const directionLock = readRecord(taskDocument.taskDirectionLock);
  const declaredFiles = Array.isArray(directionLock?.allowedFiles)
    ? directionLock.allowedFiles.map(String)
    : Array.isArray(taskDocument.scopePaths)
    ? taskDocument.scopePaths.map(String)
    : fallback;
  const taskId = normalizeTaskId(taskDocument.workItemId ?? taskDocument.taskId);
  return taskId
    ? [...new Set([...declaredFiles, ...taskLifecycleArtifactPaths(taskId, cwd)])]
    : declaredFiles;
}

function taskLifecycleArtifactPaths(taskId: string, cwd?: string): readonly string[] {
  return [
    ...(cwd && readLatestGitHeadReceiptTaskId(cwd) === taskId ? ['.atm/history/evidence/git-head.jsonl'] : []),
    `.atm/history/evidence/${taskId}.*`,
    `.atm/history/task-events/${taskId}/**`,
    `.atm/history/tasks/${taskId}.json`
  ];
}

function normalizeTaskId(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readRequestedRecoveryMode(taskDocument: Record<string, unknown>): 'auto' | 'enabled' | 'disabled' {
  const admission = readRecord(taskDocument.workAdmission);
  const value = String(admission?.recoveryMode ?? 'auto').trim().toLowerCase();
  return value === 'enabled' || value === 'disabled' ? value : 'auto';
}

function assessElevatedRisk(taskDocument: Record<string, unknown>) {
  const paths = resolveTaskWorkAdmissionFiles(taskDocument, []);
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
