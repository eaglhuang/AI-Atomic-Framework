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
    if (historicalReport.reason === 'out-of-scope-source-files-present') {
      blockers.push({
        code: 'ATM_TASKFLOW_CLOSE_OUT_OF_SCOPE_WAIVER_REQUIRED',
        summary: `Historical delivery ${historicalRef} includes out-of-scope source files. taskflow close requires an explicit waiver reason to continue through the operator lane.`,
        requiredCommand: `node atm.mjs taskflow close --task ${input.taskId} --actor ${quoteCliValue(input.actorId || '<actor>')} --historical-delivery ${historicalRef} --waiver-out-of-scope-delivery --reason \"<reason>\" --write --json`
      });
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
