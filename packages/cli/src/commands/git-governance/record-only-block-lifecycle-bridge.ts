// ATM-GOV-0266: narrow record-only bridge for parked block-lifecycle history.
//
// A card that is parked (blocked/released) for a governed recovery leaves two
// append-only history records behind: its ledger (`.atm/history/tasks/<ID>.json`)
// and the matching block transition event
// (`.atm/history/task-events/<ID>/<ts>-block-<hash>.json`). While an unrelated
// framework claim is active, both the governed commit wrapper
// (`ATM_GIT_COMMIT_FRAMEWORK_STAGING_AMBIGUOUS`) and the pre-commit hook
// (`ATM_CROSS_TASK_MUTATION_BLOCKED`) correctly refuse a staged file owned by
// another task.
//
// This bridge recognises exactly one complete, provably-parked block-lifecycle
// pair by parsing the *content* of both the staged ledger and the staged block
// event — never the file name alone — and only then lets a governed
// `git record-commit` persist it. Every other staged shape stays fail-closed.
//
// The classifier is pure (all IO is injected) so it can be exercised by a
// focused validator without touching git. The pre-commit hook consumes the same
// classifier plus a single-use, content-bound authorization
// (`isRecordCommitBlockBridgeAuthorized`) so a raw `git commit` of an identical
// pair — one that did not pass through the governed record-commit path — stays
// blocked.

export interface BlockBridgeLedgerRecord {
  /** `workItemId` (or `id`) declared inside the ledger document. */
  readonly workItemId: string | null;
  readonly status: string;
  readonly claimState: string | null;
  readonly claimActorId: string | null;
  readonly claimLeaseId: string | null;
}

export interface BlockBridgeEventRecord {
  readonly taskId: string | null;
  readonly action: string | null;
  readonly toStatus: string | null;
  readonly actorId: string | null;
  readonly taskPath: string | null;
}

export const BLOCK_BRIDGE_REJECTION_CODES = {
  extraRecordFiles: 'extra-record-files',
  incompletePair: 'incomplete-pair',
  multipleBlockEvents: 'multiple-block-events',
  multipleLedgers: 'multiple-ledgers',
  mixedTask: 'mixed-task',
  ledgerMissing: 'ledger-missing',
  ledgerIdMismatch: 'ledger-id-mismatch',
  ledgerNotBlockedReleased: 'ledger-not-blocked-released',
  eventUnreadable: 'event-unreadable',
  eventNotBlock: 'event-not-block',
  eventTaskMismatch: 'event-task-mismatch',
  attributionMissing: 'attribution-missing',
  attributionMismatch: 'attribution-mismatch'
} as const;

export type BlockBridgeRejectionCode =
  (typeof BLOCK_BRIDGE_REJECTION_CODES)[keyof typeof BLOCK_BRIDGE_REJECTION_CODES];

export interface BlockBridgeEligible {
  readonly kind: 'eligible';
  readonly taskId: string;
  readonly ledgerPath: string;
  readonly eventPath: string;
  readonly exemptPaths: readonly string[];
  /** Retained claim actor, proven consistent across ledger + event. */
  readonly actorId: string;
  /** Retained claim lease attribution from the live ledger. */
  readonly leaseId: string;
}

export type BlockBridgeOutcome =
  | { readonly kind: 'not-block-lifecycle' }
  | BlockBridgeEligible
  | {
      readonly kind: 'ineligible';
      readonly reasonCode: BlockBridgeRejectionCode;
      readonly reason: string;
      readonly taskId: string | null;
      readonly stagedFiles: readonly string[];
    };

const BLOCKED_STATUS = 'blocked';
const RELEASED_CLAIM_STATE = 'released';
const BLOCK_ACTION = 'block';

function normalize(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function ledgerTaskId(filePath: string): string | null {
  const match = normalize(filePath).match(/^\.atm\/history\/tasks\/([^/]+)\.json$/i);
  return match ? match[1] : null;
}

interface EventRef {
  readonly taskId: string;
  readonly action: string;
}

function eventRef(filePath: string): EventRef | null {
  const normalized = normalize(filePath);
  const match = normalized.match(
    /^\.atm\/history\/task-events\/([^/]+)\/[^/]*Z-([a-z][a-z-]*)-[0-9a-f]{6,}\.json$/i
  );
  if (!match) return null;
  return { taskId: match[1], action: match[2].toLowerCase() };
}

function nonEmpty(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Classify a staged record-only set. Returns `not-block-lifecycle` when the set
 * shows no block-lifecycle intent (leave existing record-commit behaviour
 * untouched), `eligible` for exactly one complete blocked/released pair whose
 * ledger and event *content* agree on task id, block action, and retained
 * actor/lease attribution, or `ineligible` with a specific reason.
 *
 * Authorization never rests on the file name alone: the block event filename
 * only routes a candidate; its parsed `action`/`toStatus`/`taskId` and the
 * ledger's parsed `workItemId`/`status`/`claim` decide eligibility.
 */
export function classifyBlockLifecycleRecordBundle(input: {
  readonly stagedFiles: readonly string[];
  readonly readLedgerRecord: (taskId: string) => BlockBridgeLedgerRecord | null;
  readonly readEventRecord: (eventPath: string) => BlockBridgeEventRecord | null;
}): BlockBridgeOutcome {
  const stagedFiles = input.stagedFiles.map(normalize).filter((entry) => entry.length > 0);

  const ledgerFiles: string[] = [];
  const blockEventFiles: string[] = [];
  const otherRecordFiles: string[] = [];
  const ledgerIds = new Set<string>();
  const blockEventPathIds: string[] = [];

  for (const filePath of stagedFiles) {
    const ledgerId = ledgerTaskId(filePath);
    if (ledgerId) {
      ledgerFiles.push(filePath);
      ledgerIds.add(ledgerId);
      continue;
    }
    const ref = eventRef(filePath);
    if (ref && ref.action === BLOCK_ACTION) {
      blockEventFiles.push(filePath);
      blockEventPathIds.push(ref.taskId);
      continue;
    }
    otherRecordFiles.push(filePath);
  }

  // Block-lifecycle intent: a block event, or a ledger whose live status is
  // blocked. Absent intent, leave existing record-commit behaviour untouched.
  const blockedLedgerIds = [...ledgerIds].filter((taskId) => {
    const record = input.readLedgerRecord(taskId);
    return record?.status === BLOCKED_STATUS;
  });
  const hasBlockIntent = blockEventFiles.length > 0 || blockedLedgerIds.length > 0;
  if (!hasBlockIntent) {
    return { kind: 'not-block-lifecycle' };
  }

  const reject = (
    reasonCode: BlockBridgeRejectionCode,
    reason: string,
    taskId: string | null
  ): BlockBridgeOutcome => ({ kind: 'ineligible', reasonCode, reason, taskId, stagedFiles });

  const candidateTaskId =
    ledgerIds.size === 1 ? [...ledgerIds][0] : blockEventPathIds.length > 0 ? blockEventPathIds[0] : null;

  if (otherRecordFiles.length > 0) {
    return reject(
      BLOCK_BRIDGE_REJECTION_CODES.extraRecordFiles,
      `record-only block bridge accepts only one ledger + one block event; extra record file(s) present: ${otherRecordFiles.join(', ')}.`,
      candidateTaskId
    );
  }
  if (ledgerIds.size > 1) {
    return reject(
      BLOCK_BRIDGE_REJECTION_CODES.multipleLedgers,
      `record-only block bridge accepts a single card; multiple ledgers staged: ${[...ledgerIds].sort().join(', ')}.`,
      null
    );
  }
  if (blockEventFiles.length === 0) {
    return reject(
      BLOCK_BRIDGE_REJECTION_CODES.incompletePair,
      'record-only block bridge requires the matching block event; ledger staged without its block event.',
      candidateTaskId
    );
  }
  if (ledgerFiles.length === 0) {
    return reject(
      BLOCK_BRIDGE_REJECTION_CODES.incompletePair,
      'record-only block bridge requires the card ledger; block event staged without its ledger.',
      candidateTaskId
    );
  }
  if (blockEventFiles.length > 1) {
    return reject(
      BLOCK_BRIDGE_REJECTION_CODES.multipleBlockEvents,
      `record-only block bridge accepts exactly one block event; ${blockEventFiles.length} staged.`,
      candidateTaskId
    );
  }

  const taskId = [...ledgerIds][0];
  const ledgerPath = ledgerFiles[0];
  const eventPath = blockEventFiles[0];

  // Filename path segment of the event must already point at the same card.
  if (blockEventPathIds[0] !== taskId) {
    return reject(
      BLOCK_BRIDGE_REJECTION_CODES.mixedTask,
      `record-only block bridge requires the ledger and block event to share a card; ledger ${taskId} vs event path ${blockEventPathIds[0]}.`,
      taskId
    );
  }

  const ledger = input.readLedgerRecord(taskId);
  if (!ledger) {
    return reject(
      BLOCK_BRIDGE_REJECTION_CODES.ledgerMissing,
      `record-only block bridge could not read live ledger state for ${taskId}.`,
      taskId
    );
  }

  // Ledger document must self-identify as this card (never trust the file name).
  if (!nonEmpty(ledger.workItemId) || ledger.workItemId !== taskId) {
    return reject(
      BLOCK_BRIDGE_REJECTION_CODES.ledgerIdMismatch,
      `record-only block bridge requires the ledger document workItemId to equal its path id; path ${taskId} vs document ${ledger.workItemId ?? 'null'}.`,
      taskId
    );
  }

  if (ledger.status !== BLOCKED_STATUS || ledger.claimState !== RELEASED_CLAIM_STATE) {
    return reject(
      BLOCK_BRIDGE_REJECTION_CODES.ledgerNotBlockedReleased,
      `record-only block bridge requires status=blocked and claimState=released; ${taskId} is status=${ledger.status} claimState=${ledger.claimState ?? 'null'}.`,
      taskId
    );
  }

  // Parse and validate the block event content — the file name is not authority.
  const event = input.readEventRecord(eventPath);
  if (!event) {
    return reject(
      BLOCK_BRIDGE_REJECTION_CODES.eventUnreadable,
      `record-only block bridge could not parse the staged block event ${eventPath}.`,
      taskId
    );
  }
  if (event.action !== BLOCK_ACTION || event.toStatus !== BLOCKED_STATUS) {
    return reject(
      BLOCK_BRIDGE_REJECTION_CODES.eventNotBlock,
      `record-only block bridge requires the event to be a block transition; event action=${event.action ?? 'null'} toStatus=${event.toStatus ?? 'null'}.`,
      taskId
    );
  }
  if (event.taskId !== taskId || (nonEmpty(event.taskPath) && normalize(event.taskPath) !== ledgerPath)) {
    return reject(
      BLOCK_BRIDGE_REJECTION_CODES.eventTaskMismatch,
      `record-only block bridge requires the event content to name the same card and ledger; event taskId=${event.taskId ?? 'null'} taskPath=${event.taskPath ?? 'null'} vs ${taskId}/${ledgerPath}.`,
      taskId
    );
  }

  // Retained actor + lease attribution must be present and internally consistent.
  if (!nonEmpty(ledger.claimActorId) || !nonEmpty(ledger.claimLeaseId) || !nonEmpty(event.actorId)) {
    return reject(
      BLOCK_BRIDGE_REJECTION_CODES.attributionMissing,
      `record-only block bridge requires retained actor + lease attribution; ledger actor=${ledger.claimActorId ?? 'null'} lease=${ledger.claimLeaseId ?? 'null'} event actor=${event.actorId ?? 'null'}.`,
      taskId
    );
  }
  if (event.actorId !== ledger.claimActorId) {
    return reject(
      BLOCK_BRIDGE_REJECTION_CODES.attributionMismatch,
      `record-only block bridge requires the block event actor to match the retained ledger claim actor; event ${event.actorId} vs ledger ${ledger.claimActorId}.`,
      taskId
    );
  }

  return {
    kind: 'eligible',
    taskId,
    ledgerPath,
    eventPath,
    actorId: ledger.claimActorId,
    leaseId: ledger.claimLeaseId,
    exemptPaths: [ledgerPath, eventPath].sort((left, right) => left.localeCompare(right))
  };
}

/**
 * True only when the bridge granted a non-empty exempt set that fully covers the
 * out-of-claim staged files. Any staged file outside the exempt set keeps the
 * framework-staging-ambiguous gate fail-closed.
 */
export function recordOnlyClaimScopeExemptCovers(
  exemptPaths: readonly string[] | undefined,
  outOfScopeStagedFiles: readonly string[]
): boolean {
  if (!exemptPaths || exemptPaths.length === 0) return false;
  const exempt = new Set(exemptPaths.map(normalize));
  const candidates = outOfScopeStagedFiles.map(normalize);
  if (candidates.length === 0) return false;
  return candidates.every((filePath) => exempt.has(filePath));
}

// --- Governed record-commit context authorization (pre-commit hook parity) ---
//
// The pre-commit hook cannot tell a governed `git record-commit` apart from a
// raw `git commit` of the same two files by staged content alone. The governed
// path therefore writes a single-use, content-bound authorization artifact and
// passes only its nonce to the hook via the commit environment. Authority lives
// in the artifact (actor + exact exempt paths + content digests + freshness),
// never in the mere presence of the environment variable.

export const RECORD_COMMIT_BLOCK_BRIDGE_AUTH_ENV = 'ATM_RECORD_COMMIT_BLOCK_BRIDGE_AUTH';
export const RECORD_COMMIT_BLOCK_BRIDGE_AUTH_DIR = '.atm/runtime/record-commit-block-bridge';
export const RECORD_COMMIT_BLOCK_BRIDGE_DEFAULT_TTL_MS = 120_000;

export interface RecordCommitBlockBridgeAuthorization {
  readonly nonce: string;
  readonly actorId: string;
  readonly taskId: string;
  readonly exemptPaths: readonly string[];
  readonly ledgerPath: string;
  readonly ledgerSha256: string;
  readonly eventPath: string;
  readonly eventSha256: string;
  readonly createdAtMs: number;
  readonly ttlMs: number;
}

function sameStringSet(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const l = [...left].map(normalize).sort();
  const r = [...right].map(normalize).sort();
  return l.every((value, index) => value === r[index]);
}

/**
 * Pure predicate the pre-commit hook uses to decide whether an eligible
 * block-lifecycle pair was produced through the governed record-commit path.
 * All IO (reading the artifact, hashing staged blobs, the clock) is performed by
 * the caller and passed in, so the decision is deterministic and testable.
 */
export function isRecordCommitBlockBridgeAuthorized(input: {
  readonly eligible: BlockBridgeEligible;
  readonly authorization: RecordCommitBlockBridgeAuthorization | null;
  readonly committingActorId: string | null;
  readonly ledgerSha256: string;
  readonly eventSha256: string;
  readonly nowMs: number;
}): { readonly authorized: boolean; readonly reason: string } {
  const { authorization: auth, eligible } = input;
  if (!auth) {
    return { authorized: false, reason: 'no governed record-commit authorization artifact was presented' };
  }
  if (auth.taskId !== eligible.taskId) {
    return { authorized: false, reason: `authorization task ${auth.taskId} does not match eligible card ${eligible.taskId}` };
  }
  if (!nonEmpty(auth.actorId) || auth.actorId !== eligible.actorId) {
    return { authorized: false, reason: 'authorization actor does not match the retained ledger claim actor' };
  }
  if (nonEmpty(input.committingActorId) && input.committingActorId !== auth.actorId) {
    return { authorized: false, reason: 'committing actor does not match the authorization actor' };
  }
  if (!sameStringSet(auth.exemptPaths, eligible.exemptPaths)) {
    return { authorized: false, reason: 'authorization exempt paths do not match the eligible pair' };
  }
  if (auth.ledgerSha256 !== input.ledgerSha256 || auth.eventSha256 !== input.eventSha256) {
    return { authorized: false, reason: 'staged content digests do not match the authorization' };
  }
  const age = input.nowMs - auth.createdAtMs;
  if (!Number.isFinite(age) || age < 0 || age > auth.ttlMs) {
    return { authorized: false, reason: 'authorization is expired or not yet valid' };
  }
  return { authorized: true, reason: 'governed record-commit authorization verified' };
}
