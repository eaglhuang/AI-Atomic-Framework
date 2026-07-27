// ATM-GOV-0266: narrow record-only bridge for parked block-lifecycle history.
//
// A card that is parked (blocked/released) for a governed recovery leaves two
// append-only history records behind: its ledger (`.atm/history/tasks/<ID>.json`)
// and the matching block transition event
// (`.atm/history/task-events/<ID>/<ts>-block-<hash>.json`). While an unrelated
// framework claim is active, the governed commit wrapper correctly refuses any
// staged file outside that claim's scope (`ATM_GIT_COMMIT_FRAMEWORK_STAGING_AMBIGUOUS`).
//
// This bridge recognises exactly one complete, provably-parked block-lifecycle
// pair as data (paths + live ledger state, never hard-coded task ids) and lets
// `git record-commit` persist it through an active framework claim. Every other
// staged shape stays fail-closed. The classifier is pure so it can be exercised
// by a focused validator without touching git.

export interface BlockBridgeLedgerState {
  readonly status: string;
  readonly claimState: string | null;
}

export const BLOCK_BRIDGE_REJECTION_CODES = {
  extraRecordFiles: 'extra-record-files',
  incompletePair: 'incomplete-pair',
  multipleBlockEvents: 'multiple-block-events',
  multipleLedgers: 'multiple-ledgers',
  mixedTask: 'mixed-task',
  ledgerMissing: 'ledger-missing',
  ledgerNotBlockedReleased: 'ledger-not-blocked-released'
} as const;

export type BlockBridgeRejectionCode =
  (typeof BLOCK_BRIDGE_REJECTION_CODES)[keyof typeof BLOCK_BRIDGE_REJECTION_CODES];

export type BlockBridgeOutcome =
  | { readonly kind: 'not-block-lifecycle' }
  | {
      readonly kind: 'eligible';
      readonly taskId: string;
      readonly ledgerPath: string;
      readonly eventPath: string;
      readonly exemptPaths: readonly string[];
    }
  | {
      readonly kind: 'ineligible';
      readonly reasonCode: BlockBridgeRejectionCode;
      readonly reason: string;
      readonly taskId: string | null;
      readonly stagedFiles: readonly string[];
    };

const BLOCKED_STATUS = 'blocked';
const RELEASED_CLAIM_STATE = 'released';

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

/**
 * Classify a staged record-only set. Returns `not-block-lifecycle` when the set
 * shows no block-lifecycle intent (leave existing record-commit behaviour
 * untouched), `eligible` for exactly one complete blocked/released pair, or
 * `ineligible` with a specific reason when a block-lifecycle attempt is
 * malformed.
 */
export function classifyBlockLifecycleRecordBundle(input: {
  readonly stagedFiles: readonly string[];
  readonly readLedgerState: (taskId: string) => BlockBridgeLedgerState | null;
}): BlockBridgeOutcome {
  const stagedFiles = input.stagedFiles.map(normalize).filter((entry) => entry.length > 0);

  const ledgerFiles: string[] = [];
  const blockEventFiles: string[] = [];
  const otherRecordFiles: string[] = [];
  const ledgerIds = new Set<string>();
  const blockEventIds: string[] = [];

  for (const filePath of stagedFiles) {
    const ledgerId = ledgerTaskId(filePath);
    if (ledgerId) {
      ledgerFiles.push(filePath);
      ledgerIds.add(ledgerId);
      continue;
    }
    const ref = eventRef(filePath);
    if (ref && ref.action === 'block') {
      blockEventFiles.push(filePath);
      blockEventIds.push(ref.taskId);
      continue;
    }
    otherRecordFiles.push(filePath);
  }

  // No block-lifecycle intent: a blocked-status ledger, or a block event.
  const blockedLedgerIds = [...ledgerIds].filter((taskId) => {
    const state = input.readLedgerState(taskId);
    return state?.status === BLOCKED_STATUS;
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
    ledgerIds.size === 1 ? [...ledgerIds][0] : blockEventIds.length > 0 ? blockEventIds[0] : null;

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
  if (blockEventIds[0] !== taskId) {
    return reject(
      BLOCK_BRIDGE_REJECTION_CODES.mixedTask,
      `record-only block bridge requires the ledger and block event to share a card; ledger ${taskId} vs event ${blockEventIds[0]}.`,
      taskId
    );
  }

  const state = input.readLedgerState(taskId);
  if (!state) {
    return reject(
      BLOCK_BRIDGE_REJECTION_CODES.ledgerMissing,
      `record-only block bridge could not read live ledger state for ${taskId}.`,
      taskId
    );
  }
  if (state.status !== BLOCKED_STATUS || state.claimState !== RELEASED_CLAIM_STATE) {
    return reject(
      BLOCK_BRIDGE_REJECTION_CODES.ledgerNotBlockedReleased,
      `record-only block bridge requires status=blocked and claimState=released; ${taskId} is status=${state.status} claimState=${state.claimState ?? 'null'}.`,
      taskId
    );
  }

  return {
    kind: 'eligible',
    taskId,
    ledgerPath: ledgerFiles[0],
    eventPath: blockEventFiles[0],
    exemptPaths: [ledgerFiles[0], blockEventFiles[0]].sort((left, right) => left.localeCompare(right))
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
