import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CliError } from '../shared.ts';
import { parseClaimRecord } from '../tasks/task-ledger-readers.ts';
import { readLaneSession, type LaneSessionDocument } from './store.ts';
import { capabilityFingerprint } from './redaction.ts';
import {
  consumeProxyReceipt,
  findUsableProxyReceipt,
  type ProxyReceiptCommandClass,
  type ProxyReceiptDocument
} from './proxy-receipt.ts';

/**
 * Lane capability authority: binds mutation authority to the executing lane
 * capability rather than to the `--actor` string alone.
 *
 * Actor id is attribution. Authority is the executing lane. A non-owner captain
 * who passes another worker's `--actor` value but executes from a different
 * lane cannot mutate a worker-owned active task unless a governed proxy/takeover
 * receipt explicitly delegates that command class.
 *
 * The gate is generalized (INV-ATM-009): no task, actor, date, or path special
 * cases. It reads the live claim's recorded owner lane and the executing lane
 * session, then classifies the attempt.
 */

export type LaneCommandClass = ProxyReceiptCommandClass;

/**
 * Where a lane decision read the owner lane from, without saying what it is.
 *
 * A refusal compares two identities and can only report one of them: the owner
 * lane is a capability and stays redacted. What it can report is the record it
 * read — already on disk in front of the caller — so a blocked actor reads one
 * file instead of probing its own lane sessions.
 *
 * `--actor` is attribution, not authority, so this description is identical for
 * every attempt. There is deliberately no branch that discloses more to a
 * caller presenting the owner actor string: that caller is, by definition, the
 * borrowed-actor attempt this gate exists to stop.
 */
export interface OwnerLaneSourceDescription {
  readonly schemaId: 'atm.laneCapabilityRefusalDisclosure.v1';
  /** Repo-relative ledger record the owner lane was read from. */
  readonly ownerClaimPath: string;
  readonly ownerLaneRecorded: boolean;
  readonly ownerLaneExportHintRecorded: boolean;
  readonly nextCommand: string;
}

export type LaneCapabilityDecisionClass =
  | 'owner-lane'
  | 'approved-proxy'
  | 'adopted-owner-lane'
  | 'redacted-capability'
  | 'borrowed-actor-blocked';

export interface LaneCapabilityDecision {
  readonly schemaId: 'atm.laneCapabilityDecision.v1';
  readonly allowed: boolean;
  readonly decisionClass: LaneCapabilityDecisionClass;
  readonly commandClass: LaneCommandClass;
  readonly taskId: string;
  readonly actorId: string;
  /** Attribution only — the owner actor recorded on the live claim. */
  readonly ownerActorId: string | null;
  readonly ownerLaneFingerprint: string | null;
  readonly executingLaneFingerprint: string | null;
  readonly proxyReceiptFingerprint: string | null;
  readonly reason: string;
  readonly laneBound: boolean;
  /**
   * Where this decision read the owner lane from. Carried on the decision so
   * every consumer reports the same source as the decision it is reporting,
   * rather than re-reading the claim to describe it (INV-ATM-012).
   */
  readonly disclosure: OwnerLaneSourceDescription;
}

export interface EvaluateLaneCapabilityInput {
  readonly cwd: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly commandClass: LaneCommandClass;
  /** Executing lane session id. Defaults to ATM_LANE_SESSION_ID. */
  readonly executingLaneSessionId?: string | null;
  readonly now?: string;
}

/**
 * Classify a mutation attempt without consuming any proxy receipt.
 * Use {@link authorizeLaneCapability} at a real mutation seam to also consume
 * an approved proxy receipt and emit an audit artifact.
 */
export function evaluateLaneCapability(input: EvaluateLaneCapabilityInput): LaneCapabilityDecision {
  const cwd = path.resolve(input.cwd);
  const commandClass = input.commandClass;
  const taskId = input.taskId.trim();
  const actorId = input.actorId.trim();

  const claim = readActiveClaim(cwd, taskId);
  const ownerLaneId = claim?.laneSession?.laneSessionId ?? null;
  const ownerActorId = claim?.actorId ?? null;
  const ownerLaneFingerprint = capabilityFingerprint(ownerLaneId, 'lane');
  // Described from the same claim read that decides the outcome, so the source
  // a consumer reports cannot drift from the source that was consulted.
  const disclosure = describeOwnerLaneSource(taskId, claim);

  const executingLaneSessionId = normalizeOptionalString(input.executingLaneSessionId)
    ?? normalizeOptionalString(process.env.ATM_LANE_SESSION_ID);
  const executingLaneFingerprint = capabilityFingerprint(executingLaneSessionId, 'lane');

  // No lane-bound claim: capability binding does not apply. Attribution-only
  // flows (e.g. framework work with no owner-lane claim) are not blocked here.
  if (!ownerLaneId) {
    return decision({
      allowed: true,
      decisionClass: 'owner-lane',
      commandClass,
      taskId,
      actorId,
      ownerActorId,
      ownerLaneFingerprint,
      executingLaneFingerprint,
      proxyReceiptFingerprint: null,
      reason: 'No lane-bound active claim; capability binding does not apply.',
      laneBound: false,
      disclosure
    });
  }

  // Owner lane: the executing lane holds the exact live-claim capability.
  // Actor metadata drift is irrelevant — authority follows the lane.
  if (executingLaneSessionId && executingLaneSessionId === ownerLaneId) {
    return decision({
      allowed: true,
      decisionClass: 'owner-lane',
      commandClass,
      taskId,
      actorId,
      ownerActorId,
      ownerLaneFingerprint,
      executingLaneFingerprint,
      proxyReceiptFingerprint: null,
      reason: 'Executing lane matches the live-claim owner lane capability.',
      laneBound: true,
      disclosure
    });
  }

  // Adopted owner lane: the executing lane is a governed adoption of the owner
  // lane (same capability lineage), even before claim rebind has landed.
  if (executingLaneSessionId && isAdoptionOf(cwd, executingLaneSessionId, ownerLaneId)) {
    return decision({
      allowed: true,
      decisionClass: 'adopted-owner-lane',
      commandClass,
      taskId,
      actorId,
      ownerActorId,
      ownerLaneFingerprint,
      executingLaneFingerprint,
      proxyReceiptFingerprint: null,
      reason: 'Executing lane is a governed adoption of the owner lane capability.',
      laneBound: true,
      disclosure
    });
  }

  // Approved proxy/takeover: a governed receipt delegates this command class
  // from the owner lane to the executing lane.
  if (executingLaneSessionId) {
    const usable = findUsableProxyReceipt({
      cwd,
      taskId,
      ownerLaneId,
      executorLaneId: executingLaneSessionId,
      commandClass,
      now: input.now
    });
    if (usable) {
      return decision({
        allowed: true,
        decisionClass: 'approved-proxy',
        commandClass,
        taskId,
        actorId,
        ownerActorId,
        ownerLaneFingerprint,
        executingLaneFingerprint,
        proxyReceiptFingerprint: proxyFingerprint(usable),
        reason: `Approved ${usable.grantKind} receipt delegates ${commandClass} from owner lane to executing lane.`,
        laneBound: true,
        disclosure
      });
    }
  }

  // Borrowed actor: the attempt trusts an actor string it does not hold the
  // lane capability for. Fail closed.
  return decision({
    allowed: false,
    decisionClass: 'borrowed-actor-blocked',
    commandClass,
    taskId,
    actorId,
    ownerActorId,
    ownerLaneFingerprint,
    executingLaneFingerprint,
    proxyReceiptFingerprint: null,
    reason: executingLaneSessionId
      ? 'Executing lane does not match the owner lane capability and no proxy/takeover receipt delegates this command class.'
      : 'No executing lane capability is present; mutation authority cannot be bound to an actor string alone.',
    laneBound: true,
    disclosure
  });
}

export interface AuthorizeLaneCapabilityResult {
  readonly decision: LaneCapabilityDecision;
  /** Present only when an approved proxy/takeover receipt was consumed. */
  readonly auditPath: string | null;
}

/**
 * Enforce lane capability at a mutation seam. Throws
 * `ATM_LANE_BORROWED_ACTOR_BLOCKED` when the executing lane lacks authority.
 * When an approved proxy receipt authorizes the attempt, it is consumed
 * (single-use) and an audit artifact path is returned.
 */
export function authorizeLaneCapability(input: EvaluateLaneCapabilityInput): AuthorizeLaneCapabilityResult {
  const evaluated = evaluateLaneCapability(input);
  if (!evaluated.allowed) {
    throw new CliError('ATM_LANE_BORROWED_ACTOR_BLOCKED', evaluated.reason, {
      exitCode: 1,
      details: {
        decision: evaluated,
        // Consumed from the decision, not recomputed: the refusal reports the
        // source the refusal itself consulted (INV-ATM-012).
        disclosure: evaluated.disclosure,
        remediation: 'Execute from the owner lane, adopt the owner lane through governance, or supply a proxy/takeover receipt via node atm.mjs lane proxy grant. The owner lane is recorded on the live claim; read it with the disclosed nextCommand rather than trying lane sessions in turn.'
      }
    });
  }

  if (evaluated.decisionClass === 'approved-proxy') {
    const executingLaneSessionId = normalizeOptionalString(input.executingLaneSessionId)
      ?? normalizeOptionalString(process.env.ATM_LANE_SESSION_ID);
    const claim = readActiveClaim(path.resolve(input.cwd), input.taskId.trim());
    const ownerLaneId = claim?.laneSession?.laneSessionId ?? null;
    if (executingLaneSessionId && ownerLaneId) {
      const consumed = consumeProxyReceipt({
        cwd: input.cwd,
        taskId: input.taskId.trim(),
        ownerLaneId,
        executorLaneId: executingLaneSessionId,
        commandClass: input.commandClass,
        now: input.now,
        executingActorId: input.actorId
      });
      return { decision: evaluated, auditPath: consumed?.auditPath ?? null };
    }
  }

  return { decision: evaluated, auditPath: null };
}

/**
 * Describe the record a decision was read from. Takes the claim the caller
 * already read rather than reading it again, so the described source and the
 * consulted source are the same observation (INV-ATM-012).
 */
function describeOwnerLaneSource(
  taskId: string,
  claim: ReturnType<typeof parseClaimRecord>
): OwnerLaneSourceDescription {
  const laneSession = claim?.laneSession ?? null;
  return {
    schemaId: 'atm.laneCapabilityRefusalDisclosure.v1',
    ownerClaimPath: `.atm/history/tasks/${taskId}.json`,
    ownerLaneRecorded: Boolean(laneSession?.laneSessionId),
    ownerLaneExportHintRecorded: Boolean(laneSession?.exportHint),
    nextCommand: `node atm.mjs tasks status --task ${taskId} --json`
  };
}

function readActiveClaim(cwd: string, taskId: string): ReturnType<typeof parseClaimRecord> {
  const absolutePath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
  if (!existsSync(absolutePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(absolutePath, 'utf8')) as Record<string, unknown>;
    const claim = parseClaimRecord(parsed.claim);
    return claim && claim.state === 'active' ? claim : null;
  } catch {
    return null;
  }
}

function isAdoptionOf(cwd: string, executingLaneSessionId: string, ownerLaneId: string): boolean {
  const seen = new Set<string>();
  let current: LaneSessionDocument | null = readLaneSession(cwd, executingLaneSessionId);
  while (current && !seen.has(current.laneId)) {
    seen.add(current.laneId);
    const source = current.adoptionSource;
    if (source && (source.kind === 'adoption' || source.kind === 'handoff')) {
      if (source.sourceLaneId === ownerLaneId) return true;
      if (!source.sourceLaneId) break;
      current = readLaneSession(cwd, source.sourceLaneId);
      continue;
    }
    break;
  }
  return false;
}

function proxyFingerprint(receipt: ProxyReceiptDocument): string | null {
  return capabilityFingerprint(receipt.receiptId, 'capability');
}

function decision(input: Omit<LaneCapabilityDecision, 'schemaId'>): LaneCapabilityDecision {
  return { schemaId: 'atm.laneCapabilityDecision.v1', ...input };
}

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
