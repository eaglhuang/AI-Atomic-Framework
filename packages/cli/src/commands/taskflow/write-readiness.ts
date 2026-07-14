import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { resolveActorWorkSession } from '../actor-session.ts';
import { evaluateTaskDoneCloseAdmission } from '../tasks/lifecycle-state.ts';
import { detectHistoricalDeliveryCommit, inspectHistoricalDelivery } from '../tasks/historical-delivery.ts';
import type { TaskflowClosebackPlan } from './closeback-orchestration.ts';
import { evaluateTaskflowBranchCommitQueueGate, type TaskflowBranchCommitQueueGate } from './branch-commit-queue-gate.ts';
import { evaluateTaskflowBrokerConflictGate, type TaskflowBrokerConflictGate } from './broker-gate.ts';
import { resolvePlanningPathFromStored } from '../planning-repo-root.ts';
import { quoteCliValue } from '../shared.ts';

export interface TaskflowCloseKnownBlocker {
  readonly code: string;
  readonly summary: string;
  readonly requiredCommand: string | null;
  readonly multiTaskCloseRecipe?: string | null;
}

const SHARED_DELIVERY_WAIVER_BLOCKER_CODES = new Set([
  'ATM_TASKFLOW_CLOSE_OUT_OF_SCOPE_WAIVER_REQUIRED',
  'ATM_TASKFLOW_PRECLOSE_MIXED_DELIVERY_COMMIT',
  'ATM_TASKFLOW_PRECLOSE_MISSING_APPROVAL_LEASE'
]);

const DEMOTED_WHEN_SHARED_HISTORICAL_DELIVERY_PRESENT = new Set([
  'ATM_TASKFLOW_CLOSE_HISTORICAL_DELIVERY_REQUIRED',
  'ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED'
]);

export function buildSharedDeliveryWaiverCommand(input: {
  readonly taskId: string;
  readonly actorId: string;
  readonly historicalRef: string;
}): string {
  return `node atm.mjs taskflow close --task ${input.taskId} --actor ${quoteCliValue(input.actorId)} --historical-delivery ${input.historicalRef} --waiver-out-of-scope-delivery --reason "<reason>" --write --json`;
}

function buildSharedDeliveryCloseRecipe(input: {
  readonly historicalRef: string;
  readonly outOfScopeFiles: readonly string[];
}): string {
  if (input.outOfScopeFiles.length === 0) {
    return `Shared delivery commit ${input.historicalRef} intentionally includes sibling task files; close each co-delivered task with the same --historical-delivery and an explicit waiver reason.`;
  }
  const preview = input.outOfScopeFiles.slice(0, 3).join(', ');
  const suffix = input.outOfScopeFiles.length > 3 ? ` (+${input.outOfScopeFiles.length - 3} more)` : '';
  return `Shared delivery commit ${input.historicalRef} also touched ${preview}${suffix}. Close sibling tasks against the same --historical-delivery with --waiver-out-of-scope-delivery --reason when the batch intentionally co-delivered.`;
}

function enhanceSharedDeliveryWaiverBlocker(
  blocker: TaskflowCloseKnownBlocker,
  input: {
    readonly taskId: string;
    readonly actorId: string;
    readonly historicalRef: string;
    readonly outOfScopeFiles: readonly string[];
  }
): TaskflowCloseKnownBlocker {
  const requiredCommand = buildSharedDeliveryWaiverCommand({
    taskId: input.taskId,
    actorId: input.actorId,
    historicalRef: input.historicalRef
  });
  const multiTaskCloseRecipe = blocker.multiTaskCloseRecipe
    ?? buildSharedDeliveryCloseRecipe({
      historicalRef: input.historicalRef,
      outOfScopeFiles: input.outOfScopeFiles
    });
  return {
    ...blocker,
    summary: `Historical delivery ${input.historicalRef} is an intentional shared-delivery close for co-delivered siblings. Acknowledge out-of-scope files with --waiver-out-of-scope-delivery --reason; this is not a missing delivery.`,
    requiredCommand,
    multiTaskCloseRecipe
  };
}

export function prioritizeSharedHistoricalDeliveryBlockers(
  blockers: readonly TaskflowCloseKnownBlocker[],
  input: {
    readonly taskId: string;
    readonly actorId: string;
    readonly historicalDeliveryRef: string | null;
    readonly outOfScopeFiles?: readonly string[];
  }
): TaskflowCloseKnownBlocker[] {
  const historicalRef = input.historicalDeliveryRef;
  if (!historicalRef) return [...blockers];
  const waiverBlockers = blockers.filter((entry) => SHARED_DELIVERY_WAIVER_BLOCKER_CODES.has(entry.code));
  if (waiverBlockers.length === 0) return [...blockers];
  const filtered = blockers.filter((entry) => !DEMOTED_WHEN_SHARED_HISTORICAL_DELIVERY_PRESENT.has(entry.code));
  const enhancedWaiverBlockers = waiverBlockers.map((entry) => enhanceSharedDeliveryWaiverBlocker(entry, {
    taskId: input.taskId,
    actorId: input.actorId,
    historicalRef,
    outOfScopeFiles: input.outOfScopeFiles ?? []
  }));
  const remainder = filtered.filter((entry) => !SHARED_DELIVERY_WAIVER_BLOCKER_CODES.has(entry.code));
  return [...enhancedWaiverBlockers, ...remainder];
}

export interface TaskflowCloseWriteReadinessHint {
  readonly schemaId: 'atm.taskflowCloseWriteReadinessHint.v1';
  readonly status: 'ready' | 'blocked';
  readonly summary: string;
  readonly blockers: readonly TaskflowCloseKnownBlocker[];
  readonly nextCommand: string | null;
  readonly operatorLane: 'taskflow close';
  readonly brokerConflictGate: TaskflowBrokerConflictGate;
  readonly branchCommitQueueGate: TaskflowBranchCommitQueueGate;
}

function normalizeTaskflowLifecycleStatus(value: unknown): string {
  return String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
}

function readTaskflowClaimContext(taskDocument: Record<string, unknown>) {
  const claim = taskDocument.claim;
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) {
    return { state: null, actorId: null, leaseId: null };
  }
  const record = claim as Record<string, unknown>;
  return {
    state: typeof record.state === 'string' ? record.state : null,
    actorId: typeof record.actorId === 'string' ? record.actorId : null,
    leaseId: typeof record.leaseId === 'string' ? record.leaseId : null
  };
}

function resolvePlanningPath(cwd: string, planningMirrorPath: string | null): { repoRoot: string | null; relativePath: string | null } {
  const resolved = resolvePlanningPathFromStored(cwd, planningMirrorPath);
  return {
    repoRoot: resolved.repoRoot,
    relativePath: resolved.relativePath
  };
}

export function buildTaskflowCloseWriteReadinessHint(input: {
  cwd: string;
  taskId: string;
  actorId: string;
  taskDocument: Record<string, unknown>;
  declaredFiles: readonly string[];
  closebackPlan: TaskflowClosebackPlan;
  previewCommitBundle: {
    targetDeliveryFiles: readonly string[];
  };
  historicalDeliveryRefs: readonly string[];
  waiverOutOfScopeDelivery?: boolean;
  waiverReason?: string | null;
  planningAuthorityDeliveryGate: {
    required: boolean;
    ok: boolean;
    repoRoot: string | null;
    matchedFiles: string[];
    reason: string | null;
  };
}): TaskflowCloseWriteReadinessHint {
  const blockers: TaskflowCloseKnownBlocker[] = [];
  const brokerConflictGate = evaluateTaskflowBrokerConflictGate({
    cwd: input.cwd,
    taskId: input.taskId,
    declaredFiles: input.declaredFiles,
    actorId: input.actorId
  });
  const branchCommitQueueGate = evaluateTaskflowBranchCommitQueueGate({
    cwd: input.cwd,
    taskId: input.taskId,
    actorId: input.actorId
  });
  const taskStatus = normalizeTaskflowLifecycleStatus(input.taskDocument.status);
  const claim = readTaskflowClaimContext(input.taskDocument);
  const activeSession = input.actorId
    ? resolveActorWorkSession(input.cwd, {
      actorId: input.actorId,
      taskId: input.taskId,
      claimLeaseId: claim.leaseId,
      includeNonActive: true
    })
    : null;

  if (!input.actorId) {
    blockers.push({
      code: 'ATM_TASKFLOW_CLOSE_ACTOR_REQUIRED',
      summary: 'taskflow close --write requires --actor before ATM can verify claim ownership and active session context.',
      requiredCommand: `node atm.mjs taskflow close --task ${input.taskId} --actor <actor> --write --json`
    });
  } else {
    const admission = evaluateTaskDoneCloseAdmission({
      taskId: input.taskId,
      actorId: input.actorId,
      status: taskStatus,
      claimState: claim.state,
      claimActorId: claim.actorId,
      hasActiveSession: Boolean(activeSession?.sessionId),
      allowHistoricalCloseback: input.historicalDeliveryRefs.length > 0
    });
    if (!admission.ok) {
      blockers.push({
        code: admission.code,
        summary: admission.message,
        requiredCommand: typeof admission.details.requiredCommand === 'string'
          ? admission.details.requiredCommand
          : null
      });
    }
  }

  const planningMirrorPath = input.closebackPlan.writerBoundary.planningMirrorPath
    ?? input.closebackPlan.closebackPathResolution?.planningMirrorPath
    ?? null;
  const planningResolved = resolvePlanningPath(input.cwd, planningMirrorPath);

  // ATM-BUG-2026-07-07-050: `taskflow close --write` hard-fails via
  // assertClosebackPlanningPathReady() when the closeback path resolution route
  // is 'missing' or 'ambiguous' (e.g. a stale source.planPath with no usable
  // fallback), but dry-run never evaluated that same gate, so it reported
  // `ready` right up until the write attempt. Surface it here too so dry-run
  // and --write agree on whether this task can actually close.
  const closebackRoute = input.closebackPlan.closebackPathResolution?.route ?? null;
  if (closebackRoute === 'missing' || closebackRoute === 'ambiguous') {
    const resolution = input.closebackPlan.closebackPathResolution!;
    blockers.push({
      code: resolution.diagnostics.codes[0] ?? 'ATM_TASKFLOW_CLOSE_PLANNING_PATH_MISSING',
      summary: resolution.diagnostics.messages.join(' ') || 'taskflow close could not resolve a usable closeback planning path.',
      requiredCommand: `node atm.mjs taskflow close --task ${input.taskId} --actor ${quoteCliValue(input.actorId || '<actor>')} --profile <taskflow-profile.json> --write --json`
    });
  }
  const hasUncommittedDeliverables = input.previewCommitBundle.targetDeliveryFiles.length > 0;
  if (
    input.closebackPlan.historicalDeliveryGate.required
    && !hasUncommittedDeliverables
    && input.historicalDeliveryRefs.length === 0
  ) {
    const detectedDelivery = detectHistoricalDeliveryCommit({
      cwd: input.cwd,
      taskId: input.taskId,
      declaredFiles: [...input.declaredFiles],
      planningRepoRoot: planningResolved.repoRoot,
      planningRelativePath: planningResolved.relativePath
    });
    const historicalRefHint = detectedDelivery.ref ?? '<commit>';
    const detectedSummary = detectedDelivery.ref
      ? `Framework delivery already landed at ${detectedDelivery.ref}; taskflow close --write requires --historical-delivery before backend close can proceed.`
      : 'Framework delivery already landed; taskflow close --write will require --historical-delivery before backend close can proceed.';
    blockers.push({
      code: 'ATM_TASKFLOW_CLOSE_HISTORICAL_DELIVERY_REQUIRED',
      summary: detectedSummary,
      requiredCommand: `node atm.mjs taskflow close --task ${input.taskId} --actor ${quoteCliValue(input.actorId || '<actor>')} --historical-delivery ${historicalRefHint} --write --json`
    });
  }

  if (input.planningAuthorityDeliveryGate.required && !input.planningAuthorityDeliveryGate.ok) {
    blockers.push({
      code: 'ATM_TASKFLOW_CLOSE_PLANNING_DELIVERY_REQUIRED',
      summary: input.planningAuthorityDeliveryGate.reason
        ? `Planning-authority closeback is blocked: ${input.planningAuthorityDeliveryGate.reason}.`
        : 'Planning-authority closeback could not verify a valid planning-repo delivery commit.',
      requiredCommand: `node atm.mjs taskflow close --task ${input.taskId} --actor ${quoteCliValue(input.actorId || '<actor>')} --historical-delivery <commit> --write --json`
    });
  }

  const historicalRef = input.historicalDeliveryRefs[0] ?? null;
  if (historicalRef && input.declaredFiles.length > 0) {
    const historicalReport = inspectHistoricalDelivery({
      cwd: input.cwd,
      taskId: input.taskId,
      requestedRef: historicalRef,
      declaredFiles: [...input.declaredFiles],
      enforceDeclaredScope: true,
      waiverOutOfScopeDelivery: input.waiverOutOfScopeDelivery === true,
      waiverReason: input.waiverReason ?? null
    });
    if (
      historicalReport.reason === 'out-of-scope-source-files-present'
      || historicalReport.reason === 'out-of-scope-waiver-reason-required'
    ) {
      blockers.push(enhanceSharedDeliveryWaiverBlocker({
        code: historicalReport.reason === 'out-of-scope-waiver-reason-required'
          ? 'ATM_TASKFLOW_PRECLOSE_MISSING_APPROVAL_LEASE'
          : 'ATM_TASKFLOW_CLOSE_OUT_OF_SCOPE_WAIVER_REQUIRED',
        summary: '',
        requiredCommand: null
      }, {
        taskId: input.taskId,
        actorId: input.actorId || '<actor>',
        historicalRef,
        outOfScopeFiles: historicalReport.fileBuckets.outOfScopeSourceFiles
      }));
    }
  }

  if (brokerConflictGate.verdict === 'confirmedConflict') {
    blockers.push({
      code: 'ATM_TASKFLOW_CLOSE_BROKER_CONFIRMED_CONFLICT',
      summary: brokerConflictGate.summary,
      requiredCommand: brokerConflictGate.requiredCommand
    });
  } else if (brokerConflictGate.verdict === 'takeoverRequired') {
    blockers.push({
      code: 'ATM_TASKFLOW_CLOSE_BROKER_TAKEOVER_REQUIRED',
      summary: brokerConflictGate.summary,
      requiredCommand: brokerConflictGate.requiredCommand
    });
  } else if (brokerConflictGate.verdict === 'insufficientMutationIntent') {
    blockers.push({
      code: 'ATM_TASKFLOW_CLOSE_BROKER_CONFLICT_BLOCKED',
      summary: brokerConflictGate.summary,
      requiredCommand: brokerConflictGate.requiredCommand
    });
  }

  if (branchCommitQueueGate.status === 'busy') {
    blockers.push({
      code: 'ATM_TASKFLOW_CLOSE_BRANCH_COMMIT_QUEUE_BUSY',
      summary: branchCommitQueueGate.summary,
      requiredCommand: branchCommitQueueGate.requiredCommand
    });
  }

  return {
    schemaId: 'atm.taskflowCloseWriteReadinessHint.v1',
    status: blockers.length > 0 ? 'blocked' : 'ready',
    summary: blockers.length > 0
      ? `taskflow close --write has ${blockers.length} known blocker(s) that dry-run can already disclose.`
      : 'taskflow close --write has no known blockers.',
    blockers,
    nextCommand: blockers[0]?.requiredCommand ?? null,
    operatorLane: 'taskflow close',
    brokerConflictGate,
    branchCommitQueueGate
  };
}
