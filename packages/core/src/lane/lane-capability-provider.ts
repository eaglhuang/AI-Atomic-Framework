import { createHash } from 'node:crypto';

/**
 * Lane mutation capability provider.
 *
 * `authorizeMutationCapability` is the single protected mutation authorization
 * decision for the lane-security vertical (TASK-LANE-0022). Task
 * renew/release/handoff/takeover, governed commit/push, framework-mode
 * claim/release, runner-sync reservation/publication, and taskflow close all
 * consume this one verifier through thin adapters. There is no second authority
 * policy and no actor-id-only allow branch.
 *
 * Authority is a capability token, not an identity string. Actor id, task id,
 * lane id, environment variables, disclosed lease ids, or possession of another
 * captain's command text are never sufficient. Every token is audience-,
 * operation-, task-, lane-, generation-, expiry-, and resource-bound. A
 * successful mutation consumes the token once; cross-command replay and stale
 * generations fail closed.
 *
 * The module is pure and deterministic: the caller supplies an authority
 * snapshot (owner lane, current generation, the set of validly issued token
 * records, and the append-only consumed-token ledger) and records the returned
 * the presented token id in that ledger when `consume` is true. Only fingerprints and safe metadata are ever
 * returned — never a reusable token, lease, ticket, or proxy secret.
 */

export type MutationOperation =
  | 'task-renew'
  | 'task-release'
  | 'task-handoff'
  | 'task-takeover'
  | 'governed-commit'
  | 'governed-push'
  | 'framework-mode-claim'
  | 'framework-mode-release'
  | 'runner-sync-reserve'
  | 'runner-sync-publish'
  | 'taskflow-close';

/**
 * The audience partitions operations into capability classes. A token minted
 * for one audience can never authorize an operation in another, even before the
 * per-operation subject check runs.
 */
export type MutationAudience =
  | 'task-lifecycle'
  | 'governed-git'
  | 'framework-mode'
  | 'runner-sync'
  | 'taskflow-close';

const OPERATION_AUDIENCE: Readonly<Record<MutationOperation, MutationAudience>> = {
  'task-renew': 'task-lifecycle',
  'task-release': 'task-lifecycle',
  'task-handoff': 'task-lifecycle',
  'task-takeover': 'task-lifecycle',
  'governed-commit': 'governed-git',
  'governed-push': 'governed-git',
  'framework-mode-claim': 'framework-mode',
  'framework-mode-release': 'framework-mode',
  'runner-sync-reserve': 'runner-sync',
  'runner-sync-publish': 'runner-sync',
  'taskflow-close': 'taskflow-close'
};

export function audienceForOperation(operation: MutationOperation): MutationAudience {
  return OPERATION_AUDIENCE[operation];
}

/** The immutable subject a capability token is bound to. */
export interface MutationCapabilitySubject {
  readonly audience: MutationAudience;
  readonly operation: MutationOperation;
  readonly taskId: string;
  /** The lane that holds the capability (the only lane that may execute it). */
  readonly laneId: string;
  /** Authority generation the token was minted against. */
  readonly generation: number;
  /**
   * The concrete resource the mutation targets (e.g. a sealed source sha, a
   * commit bundle id, a surface path). Binds the token so it cannot be reused
   * for a different resource of the same operation.
   */
  readonly resource: string;
  /** Non-inclusive expiry (ISO-8601). */
  readonly expiresAt: string;
}

/** A minted capability token. `tokenId` is the single-use secret handle. */
export interface MutationCapabilityToken extends MutationCapabilitySubject {
  readonly schemaId: 'atm.laneMutationCapability.v1';
  readonly tokenId: string;
  readonly issuedAt: string;
  /** sha256 over the canonical subject + tokenId; detects field tampering. */
  readonly bindingHash: string;
}

/** The server-side record proving a token was validly issued. */
export interface IssuedTokenRecord extends MutationCapabilitySubject {
  readonly tokenId: string;
  readonly bindingHash: string;
}

export interface MutationAuthoritySnapshot {
  /** Owner lane recorded on the live claim (attribution + issuer authority). */
  readonly ownerLaneId: string | null;
  /** Live authority generation; tokens minted at an older generation are stale. */
  readonly currentGeneration: number;
  /** Tokens the issuer recorded as validly minted. */
  readonly issuedTokens: readonly IssuedTokenRecord[];
  /** Append-only ledger of token ids already consumed (replay protection). */
  readonly consumedTokenIds: readonly string[];
  /**
   * Executing lanes that hold the owner-lane capability lineage (governed
   * adoption or an approved proxy/takeover). The owner lane is always implied.
   */
  readonly delegatedLaneIds?: readonly string[];
}

export interface MutationCapabilityRequest {
  readonly operation: MutationOperation;
  readonly taskId: string;
  /** The lane actually executing the mutation. */
  readonly executingLaneId: string | null;
  /** Attribution only. Never contributes to the allow decision. */
  readonly actorId?: string | null;
  readonly resource: string;
  /** The capability token presented for this mutation. */
  readonly presentedToken?: MutationCapabilityToken | null;
  readonly now?: string;
}

export interface MutationCapabilityPolicy {
  /** Require a capability token for every protected mutation. Default true. */
  readonly requireCapabilityToken?: boolean;
  /** Allowed clock skew (ms) applied to expiry. Default 0. */
  readonly clockSkewMs?: number;
}

export type MutationCapabilityDecisionClass =
  | 'capability-verified'
  | 'capability-required'
  | 'capability-subject-mismatch'
  | 'capability-replayed'
  | 'borrowed-actor-blocked';

export type MutationCapabilityErrorCode =
  | 'ATM_LANE_CAPABILITY_REQUIRED'
  | 'ATM_LANE_CAPABILITY_SUBJECT_MISMATCH'
  | 'ATM_LANE_CAPABILITY_REPLAYED'
  | null;

export interface MutationCapabilityDecision {
  readonly schemaId: 'atm.laneMutationCapabilityDecision.v1';
  readonly allowed: boolean;
  readonly decisionClass: MutationCapabilityDecisionClass;
  readonly errorCode: MutationCapabilityErrorCode;
  readonly operation: MutationOperation;
  readonly audience: MutationAudience;
  readonly taskId: string;
  /** Attribution only. */
  readonly actorId: string | null;
  readonly executingLaneFingerprint: string | null;
  readonly ownerLaneFingerprint: string | null;
  readonly tokenFingerprint: string | null;
  readonly resourceFingerprint: string;
  /**
   * True when the caller must append the presented token's id to the consumed
   * ledger (single-use). The raw token id is never echoed here — the caller
   * already holds the token it presented — so the decision leaks no reusable
   * secret.
   */
  readonly consume: boolean;
  readonly reason: string;
}

/**
 * Fingerprint any capability value to a non-invertible, human-readable handle.
 * Shared shape with the lane-session redaction layer so status, diagnostics,
 * dashboards, and receipts expose only fingerprints.
 */
export function capabilityValueFingerprint(value: string | null | undefined, kind: string): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const digest = createHash('sha256').update(`${kind}\n${value}`).digest('hex').slice(0, 16);
  return `${kind}fp:${digest}`;
}

function canonicalSubject(subject: MutationCapabilitySubject, tokenId: string): string {
  return [
    subject.audience,
    subject.operation,
    subject.taskId,
    subject.laneId,
    String(subject.generation),
    subject.resource,
    subject.expiresAt,
    tokenId
  ].join('');
}

export function computeBindingHash(subject: MutationCapabilitySubject, tokenId: string): string {
  return createHash('sha256').update(canonicalSubject(subject, tokenId)).digest('hex');
}

export interface IssueMutationCapabilityInput {
  readonly operation: MutationOperation;
  readonly taskId: string;
  readonly laneId: string;
  readonly generation: number;
  readonly resource: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  /** Unique, unguessable token id (caller supplies from a CSPRNG). */
  readonly tokenId: string;
}

export interface IssuedMutationCapability {
  readonly token: MutationCapabilityToken;
  readonly record: IssuedTokenRecord;
  readonly tokenFingerprint: string;
}

/**
 * Mint a capability token bound to a single operation/task/lane/generation/
 * resource/expiry. Only the owner lane (or a governed delegate) should call
 * this; the returned `record` is what the verifier trusts.
 */
export function issueMutationCapability(input: IssueMutationCapabilityInput): IssuedMutationCapability {
  const subject: MutationCapabilitySubject = {
    audience: audienceForOperation(input.operation),
    operation: input.operation,
    taskId: input.taskId,
    laneId: input.laneId,
    generation: input.generation,
    resource: input.resource,
    expiresAt: input.expiresAt
  };
  const bindingHash = computeBindingHash(subject, input.tokenId);
  const token: MutationCapabilityToken = {
    schemaId: 'atm.laneMutationCapability.v1',
    ...subject,
    tokenId: input.tokenId,
    issuedAt: input.issuedAt,
    bindingHash
  };
  const record: IssuedTokenRecord = { ...subject, tokenId: input.tokenId, bindingHash };
  return {
    token,
    record,
    tokenFingerprint: capabilityValueFingerprint(input.tokenId, 'capability') ?? 'capabilityfp:unknown'
  };
}

/**
 * The single protected mutation authorization decision. Fail-closed on every
 * ambiguity. Never trusts an actor string, environment variable, or lease id.
 */
export function authorizeMutationCapability(
  request: MutationCapabilityRequest,
  snapshot: MutationAuthoritySnapshot,
  policy: MutationCapabilityPolicy = {}
): MutationCapabilityDecision {
  const audience = audienceForOperation(request.operation);
  const requireToken = policy.requireCapabilityToken ?? true;
  const executingLaneFingerprint = capabilityValueFingerprint(request.executingLaneId, 'lane');
  const ownerLaneFingerprint = capabilityValueFingerprint(snapshot.ownerLaneId, 'lane');
  const resourceFingerprint = capabilityValueFingerprint(request.resource, 'resource') ?? 'resourcefp:none';
  const actorId = normalize(request.actorId);

  const base = {
    schemaId: 'atm.laneMutationCapabilityDecision.v1' as const,
    operation: request.operation,
    audience,
    taskId: request.taskId,
    actorId,
    executingLaneFingerprint,
    ownerLaneFingerprint,
    resourceFingerprint
  };

  const token = request.presentedToken ?? null;

  // 1. A capability token is mandatory. Identity alone is never authority.
  if (!token) {
    if (!requireToken) {
      return {
        ...base,
        allowed: true,
        decisionClass: 'capability-verified',
        errorCode: null,
        tokenFingerprint: null,
        consume: false,
        reason: 'Policy does not require a capability token for this operation.'
      };
    }
    return {
      ...base,
      allowed: false,
      decisionClass: 'capability-required',
      errorCode: 'ATM_LANE_CAPABILITY_REQUIRED',
      tokenFingerprint: null,
      consume: false,
      reason: 'No mutation capability token was presented; actor, lane, env, or lease identity is not sufficient authority.'
    };
  }

  const tokenFingerprint = capabilityValueFingerprint(token.tokenId, 'capability');

  // 2. The token must correspond to a validly issued record with an intact
  //    binding hash. An unknown or forged token grants nothing.
  const record = snapshot.issuedTokens.find((entry) => entry.tokenId === token.tokenId) ?? null;
  const expectedBinding = computeBindingHash(subjectOf(token), token.tokenId);
  if (!record || record.bindingHash !== token.bindingHash || expectedBinding !== token.bindingHash) {
    return {
      ...base,
      allowed: false,
      decisionClass: 'capability-required',
      errorCode: 'ATM_LANE_CAPABILITY_REQUIRED',
      tokenFingerprint,
      consume: false,
      reason: 'Presented token is unknown or its binding hash does not verify against the issued subject.'
    };
  }

  // 3. Subject binding: audience, operation, task, lane, and resource must all
  //    match both the request and the issued record. Any drift is a mismatch —
  //    a token for one mutation can never authorize another.
  const subjectMismatch =
    record.audience !== audience ||
    record.operation !== request.operation ||
    record.taskId !== request.taskId ||
    record.resource !== request.resource ||
    token.audience !== audience ||
    token.operation !== request.operation ||
    token.taskId !== request.taskId ||
    token.resource !== request.resource ||
    token.laneId !== record.laneId;
  if (subjectMismatch) {
    return {
      ...base,
      allowed: false,
      decisionClass: 'capability-subject-mismatch',
      errorCode: 'ATM_LANE_CAPABILITY_SUBJECT_MISMATCH',
      tokenFingerprint,
      consume: false,
      reason: 'Capability subject does not match the requested operation, task, lane, or resource.'
    };
  }

  // 4. Replay + generation: an already-consumed token or a stale generation
  //    fails closed.
  const stale = record.generation !== snapshot.currentGeneration || token.generation !== snapshot.currentGeneration;
  const alreadyConsumed = snapshot.consumedTokenIds.includes(token.tokenId);
  if (stale || alreadyConsumed) {
    return {
      ...base,
      allowed: false,
      decisionClass: 'capability-replayed',
      errorCode: 'ATM_LANE_CAPABILITY_REPLAYED',
      tokenFingerprint,
      consume: false,
      reason: alreadyConsumed
        ? 'Capability token was already consumed; single-use tokens cannot be replayed.'
        : 'Capability token generation is stale; authority has advanced since it was issued.'
    };
  }

  // 5. Expiry.
  if (isExpired(record.expiresAt, request.now, policy.clockSkewMs ?? 0)) {
    return {
      ...base,
      allowed: false,
      decisionClass: 'capability-replayed',
      errorCode: 'ATM_LANE_CAPABILITY_REPLAYED',
      tokenFingerprint,
      consume: false,
      reason: 'Capability token has expired.'
    };
  }

  // 6. Lane binding: only the lane the token is bound to may execute it, and
  //    that lane must be the owner lane or a governed delegate of it. A second
  //    actor cannot borrow the token from a different lane.
  const executingLaneId = normalize(request.executingLaneId);
  const authorizedLanes = new Set<string>([token.laneId]);
  if (snapshot.ownerLaneId) authorizedLanes.add(snapshot.ownerLaneId);
  for (const lane of snapshot.delegatedLaneIds ?? []) authorizedLanes.add(lane);
  const laneHolds = Boolean(executingLaneId) && executingLaneId === token.laneId;
  const laneAuthorized =
    snapshot.ownerLaneId == null || token.laneId === snapshot.ownerLaneId || authorizedLanes.has(token.laneId);
  if (!laneHolds || !laneAuthorized) {
    return {
      ...base,
      allowed: false,
      decisionClass: 'borrowed-actor-blocked',
      errorCode: 'ATM_LANE_CAPABILITY_SUBJECT_MISMATCH',
      tokenFingerprint,
      consume: false,
      reason: 'Executing lane does not hold the capability token, or the token lane is not an authorized owner/delegate lane.'
    };
  }

  // Verified: authorize once and instruct the caller to consume the token.
  return {
    ...base,
    allowed: true,
    decisionClass: 'capability-verified',
    errorCode: null,
    tokenFingerprint,
    consume: true,
    reason: 'Capability token verified: subject-bound, generation-current, unexpired, and lane-held. Consume once.'
  };
}

function subjectOf(token: MutationCapabilityToken): MutationCapabilitySubject {
  return {
    audience: token.audience,
    operation: token.operation,
    taskId: token.taskId,
    laneId: token.laneId,
    generation: token.generation,
    resource: token.resource,
    expiresAt: token.expiresAt
  };
}

function isExpired(expiresAt: string, now: string | undefined, skewMs: number): boolean {
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) return true;
  const at = now ? Date.parse(now) : Date.now();
  if (Number.isNaN(at)) return true;
  return at >= expiry + skewMs;
}

function normalize(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
