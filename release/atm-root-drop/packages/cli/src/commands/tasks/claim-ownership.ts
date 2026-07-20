import {
  compareClaimLifecycleOwners,
  type ClaimOwnerComparison
} from '../next/claim-admission.ts';
import { resolveLaneSession } from '../lane-session/resolve.ts';
import { CliError } from '../shared.ts';
import type { TaskClaimRecordWithLane } from './task-ledger-readers.ts';

export function readClaimLaneSessionId(claim: {
  readonly laneSession?: { readonly laneSessionId?: string | null } | null;
} | null | undefined): string | null {
  const laneSessionId = claim?.laneSession?.laneSessionId;
  return typeof laneSessionId === 'string' && laneSessionId.trim() ? laneSessionId.trim() : null;
}

export function evaluateSameTaskClaimOwnership(input: {
  readonly currentActorId: string;
  readonly currentLaneSessionId?: string | null;
  readonly requestedActorId: string;
  readonly requestedLaneSessionId?: string | null;
}): ClaimOwnerComparison {
  return compareClaimLifecycleOwners({
    current: {
      actorId: input.currentActorId,
      laneSessionId: input.currentLaneSessionId ?? null
    },
    conflicting: {
      actorId: input.requestedActorId,
      laneSessionId: input.requestedLaneSessionId ?? null
    }
  });
}

export function buildSameTaskClaimConflictDetails(input: {
  readonly taskId: string;
  readonly currentActorId: string;
  readonly requestedActorId: string;
  readonly leaseId?: string | null;
  readonly comparison: ClaimOwnerComparison;
}): Record<string, unknown> {
  const holdingLaneSessionId = input.comparison.currentLaneSessionId;
  const requestedLaneSessionId = input.comparison.conflictingLaneSessionId;
  return {
    taskId: input.taskId,
    actorId: input.currentActorId,
    requestedActorId: input.requestedActorId,
    leaseId: input.leaseId ?? null,
    holdingLaneSessionId,
    requestedLaneSessionId,
    ownershipMode: input.comparison.mode,
    ownerComparisonReason: input.comparison.reason,
    laneAdoptCommand: holdingLaneSessionId
      ? `node atm.mjs lane adopt ${holdingLaneSessionId} --actor ${input.requestedActorId} --json`
      : null,
    recoveryHint: holdingLaneSessionId
      ? `Adopt the holding lane (${holdingLaneSessionId}) or hand off before claiming from a different lane.`
      : `Continue with the existing claim owner ${input.currentActorId}, or release/take over the task before claiming as ${input.requestedActorId}.`
  };
}

export function throwIfForeignSameTaskClaim(input: {
  readonly taskId: string;
  readonly currentActorId: string;
  readonly currentLaneSessionId?: string | null;
  readonly requestedActorId: string;
  readonly requestedLaneSessionId?: string | null;
  readonly leaseId?: string | null;
}): ClaimOwnerComparison {
  const comparison = evaluateSameTaskClaimOwnership(input);
  if (comparison.sameOwner) return comparison;
  if (input.currentActorId === input.requestedActorId) {
    return {
      schemaId: 'atm.claimOwnerComparison.v1',
      mode: 'same-actor-claim-reentry',
      sameOwner: true,
      currentActorId: input.currentActorId,
      conflictingActorId: input.requestedActorId,
      currentLaneSessionId: input.currentLaneSessionId ?? null,
      conflictingLaneSessionId: input.requestedLaneSessionId ?? null,
      reason: 'tasks claim treats same-actor reentry as idempotent even when lane ids differ; stricter lane checks still apply to renew, release, handoff, and close actions.'
    };
  }
  throw new CliError(
    'ATM_LOCK_CONFLICT',
    `Task ${input.taskId} is already claimed by ${input.currentActorId}`
      + (comparison.currentLaneSessionId ? ` on lane ${comparison.currentLaneSessionId}` : '')
      + '.',
    {
      exitCode: 1,
      details: buildSameTaskClaimConflictDetails({
        taskId: input.taskId,
        currentActorId: input.currentActorId,
        requestedActorId: input.requestedActorId,
        leaseId: input.leaseId,
        comparison
      })
    }
  );
}

export function throwIfClaimOwnerMismatch(input: {
  readonly taskId: string;
  readonly currentActorId: string;
  readonly currentLaneSessionId?: string | null;
  readonly requestedActorId: string;
  readonly requestedLaneSessionId?: string | null;
}): ClaimOwnerComparison {
  const comparison = evaluateSameTaskClaimOwnership(input);
  if (comparison.sameOwner) return comparison;
  throw new CliError(
    'ATM_TASK_CLAIM_OWNER_MISMATCH',
    `Task ${input.taskId} is claimed by ${input.currentActorId}, not ${input.requestedActorId}.`,
    {
      exitCode: 1,
      details: {
        taskId: input.taskId,
        currentActor: input.currentActorId,
        actorId: input.requestedActorId,
        holdingLaneSessionId: comparison.currentLaneSessionId,
        requestedLaneSessionId: comparison.conflictingLaneSessionId,
        ownershipMode: comparison.mode,
        laneAdoptCommand: comparison.currentLaneSessionId
          ? `node atm.mjs lane adopt ${comparison.currentLaneSessionId} --actor ${input.requestedActorId} --json`
          : null
      }
    }
  );
}

export function assertCurrentClaimOwnerForAction(input: {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly action: 'renew' | 'release' | 'handoff';
  readonly currentClaim: TaskClaimRecordWithLane;
}) {
  const laneSession = resolveLaneSession({
    cwd: input.cwd,
    actorId: input.actorId,
    taskId: input.taskId,
    command: `node atm.mjs tasks ${input.action} --task ${input.taskId} --actor ${input.actorId} --json`
  });
  throwIfClaimOwnerMismatch({
    taskId: input.taskId,
    currentActorId: input.currentClaim.actorId,
    currentLaneSessionId: readClaimLaneSessionId(input.currentClaim),
    requestedActorId: input.actorId,
    requestedLaneSessionId: laneSession.session.laneId
  });
  return laneSession;
}

export function throwIfNextClaimForeignActiveOwner(input: {
  readonly taskId: string;
  readonly existingClaimActorId: string | null | undefined;
  readonly existingClaimLaneSessionId?: string | null;
  readonly requestedActorId: string;
  readonly requestedLaneSessionId?: string | null;
  readonly actorResolution: {
    readonly repoDefaultActorId?: string | null;
  };
}): boolean {
  if (!input.existingClaimActorId) return false;
  const ownership = evaluateSameTaskClaimOwnership({
    currentActorId: input.existingClaimActorId,
    currentLaneSessionId: input.existingClaimLaneSessionId,
    requestedActorId: input.requestedActorId,
    requestedLaneSessionId: input.requestedLaneSessionId
  });
  if (ownership.sameOwner) return true;
  const recoveryHint = ownership.currentLaneSessionId
    ? `Adopt the holding lane (${ownership.currentLaneSessionId}) or hand off before claiming from a different lane.`
    : input.existingClaimActorId === input.actorResolution.repoDefaultActorId
      ? `Continue with the existing claim owner ${input.existingClaimActorId}, or rerun with --actor ${input.existingClaimActorId}.`
      : `Continue with the existing claim owner ${input.existingClaimActorId}, or release/take over the task before claiming as ${input.requestedActorId}.`;
  throw new CliError(
    'ATM_LOCK_CONFLICT',
    `Task ${input.taskId} is already claimed by ${input.existingClaimActorId}`
      + (ownership.currentLaneSessionId ? ` on lane ${ownership.currentLaneSessionId}` : '')
      + '.',
    {
      exitCode: 1,
      details: {
        ...buildSameTaskClaimConflictDetails({
          taskId: input.taskId,
          currentActorId: input.existingClaimActorId,
          requestedActorId: input.requestedActorId,
          comparison: ownership
        }),
        actorResolution: input.actorResolution,
        recoveryHint
      }
    }
  );
}
