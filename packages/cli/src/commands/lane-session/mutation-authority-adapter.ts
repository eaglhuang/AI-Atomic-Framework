import {
  authorizeMutationCapability,
  audienceForOperation,
  type MutationAuthoritySnapshot,
  type MutationCapabilityDecision,
  type MutationCapabilityPolicy,
  type MutationCapabilityToken,
  type MutationOperation
} from '@ai-atomic-framework/core';
import { evaluateLaneCapability, type LaneCapabilityDecision, type LaneCommandClass } from './capability-authority.ts';

/**
 * Thin adapter: the single mutation-authorization surface every protected lane
 * mutation consumes. It composes the two lane-security layers so there is one
 * decision and no duplicate authority policy:
 *
 *   1. Lane binding (TASK-LANE-0021): the executing lane must hold the live
 *      claim's owner-lane capability, an adopted owner lane, or an approved
 *      proxy/takeover receipt. Actor id is attribution only.
 *   2. Capability binding (TASK-LANE-0022): a single-use, audience-, operation-,
 *      task-, lane-, generation-, expiry-, and resource-bound capability token
 *      must verify for the concrete resource.
 *
 * A mutation is authorized only when BOTH layers allow it. Either layer failing
 * closed blocks the mutation. The adapter returns only fingerprints and safe
 * metadata.
 */

/** Maps a fine-grained mutation operation onto the lane-binding command class. */
const OPERATION_TO_LANE_COMMAND: Readonly<Record<MutationOperation, LaneCommandClass>> = {
  'task-renew': 'governed-commit',
  'task-release': 'governed-commit',
  'task-handoff': 'governed-commit',
  'task-takeover': 'governed-commit',
  'governed-commit': 'governed-commit',
  'governed-push': 'push',
  'framework-mode-claim': 'framework-mode',
  'framework-mode-release': 'framework-mode',
  'runner-sync-reserve': 'runner-sync',
  'runner-sync-publish': 'runner-sync',
  'taskflow-close': 'taskflow-close-write'
};

export function laneCommandClassForOperation(operation: MutationOperation): LaneCommandClass {
  return OPERATION_TO_LANE_COMMAND[operation];
}

export interface LaneMutationAuthorizationInput {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly operation: MutationOperation;
  readonly resource: string;
  readonly executingLaneSessionId?: string | null;
  readonly presentedToken?: MutationCapabilityToken | null;
  /**
   * Authority snapshot for the capability layer. When omitted, the capability
   * layer is advisory (`requireCapabilityToken` defaults to false) so the lane
   * layer alone governs — used by read-only diagnostics that do not carry a
   * token store. Live mutation seams pass a real snapshot + policy.
   */
  readonly capabilitySnapshot?: MutationAuthoritySnapshot;
  readonly capabilityPolicy?: MutationCapabilityPolicy;
  readonly now?: string;
}

export interface LaneMutationDecision {
  readonly schemaId: 'atm.laneMutationDecision.v1';
  readonly allowed: boolean;
  readonly operation: MutationOperation;
  readonly taskId: string;
  readonly actorId: string;
  readonly laneDecision: LaneCapabilityDecision;
  readonly capabilityDecision: MutationCapabilityDecision;
  /** The first blocking layer, or null when both allow. */
  readonly blockedBy: 'lane' | 'capability' | null;
  readonly reason: string;
}

/**
 * The single mutation authorization decision. Evaluates lane binding and
 * capability binding and allows only when both succeed. Pure with respect to
 * capability state; the lane layer reads the live claim + lane sessions.
 */
export function evaluateLaneMutation(input: LaneMutationAuthorizationInput): LaneMutationDecision {
  const laneCommandClass = laneCommandClassForOperation(input.operation);
  const laneDecision = evaluateLaneCapability({
    cwd: input.cwd,
    taskId: input.taskId,
    actorId: input.actorId,
    commandClass: laneCommandClass,
    executingLaneSessionId: input.executingLaneSessionId,
    now: input.now
  });

  const capabilitySnapshot: MutationAuthoritySnapshot =
    input.capabilitySnapshot ?? {
      ownerLaneId: null,
      currentGeneration: 0,
      issuedTokens: [],
      consumedTokenIds: []
    };
  const capabilityPolicy: MutationCapabilityPolicy = input.capabilityPolicy ?? {
    requireCapabilityToken: input.capabilitySnapshot != null
  };
  const capabilityDecision = authorizeMutationCapability(
    {
      operation: input.operation,
      taskId: input.taskId,
      executingLaneId: normalizeLane(input.executingLaneSessionId),
      actorId: input.actorId,
      resource: input.resource,
      presentedToken: input.presentedToken ?? null,
      now: input.now
    },
    capabilitySnapshot,
    capabilityPolicy
  );

  const blockedBy: 'lane' | 'capability' | null = !laneDecision.allowed
    ? 'lane'
    : !capabilityDecision.allowed
      ? 'capability'
      : null;

  return {
    schemaId: 'atm.laneMutationDecision.v1',
    allowed: laneDecision.allowed && capabilityDecision.allowed,
    operation: input.operation,
    taskId: input.taskId,
    actorId: input.actorId,
    laneDecision,
    capabilityDecision,
    blockedBy,
    reason:
      blockedBy === 'lane'
        ? laneDecision.reason
        : blockedBy === 'capability'
          ? capabilityDecision.reason
          : `Authorized for ${input.operation} (audience ${audienceForOperation(input.operation)}): lane capability held and mutation capability verified.`
  };
}

function normalizeLane(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? value.trim()
    : (typeof process.env.ATM_LANE_SESSION_ID === 'string' && process.env.ATM_LANE_SESSION_ID.trim().length > 0
        ? process.env.ATM_LANE_SESSION_ID.trim()
        : null);
}
