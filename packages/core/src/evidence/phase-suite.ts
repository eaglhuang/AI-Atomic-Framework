// atm.phase-suite-checkpoint — Promotion Gate.
//
// A phase suite is the broader assurance layer scheduled at governed batch,
// milestone, plan-verdict and release checkpoints. This module owns the pure
// promotion gate: given the required phase-suite case IDs for a checkpoint and
// the observed phase-suite receipts, it blocks promotion/release whenever a
// required receipt is missing, stale or failed, and it exposes the observable
// metrics (cache, fan-out, queue wait, selection ratio, duration, false blocks
// and defect-detection tier). It never runs commands or mutates evidence.

export const PHASE_SUITE_PROMOTION_REPORT_SCHEMA_ID = 'atm.phaseSuitePromotionReport.v1' as const;

export type PhaseSuiteCheckpoint =
  | 'batch'
  | 'milestone'
  | 'plan-verdict'
  | 'candidate'
  | 'pre-close'
  | 'release'
  | string;

export type PhaseSuiteBlockReason = 'missing' | 'stale' | 'failed';

export interface PhaseSuiteReceipt {
  readonly caseId: string;
  readonly status?: string | null;
  readonly gitHead?: string | null;
  readonly observedAt?: string | null;
  readonly freshUntil?: string | null;
  readonly durationMs?: number | null;
  readonly cacheDecision?: string | null;
  readonly fanOutConsumerCount?: number | null;
  readonly queueWaitMs?: number | null;
  readonly defectTier?: string | null;
}

export interface PhaseSuitePromotionInput {
  readonly checkpoint: PhaseSuiteCheckpoint;
  readonly requiredPhaseCaseIds: readonly string[];
  readonly receipts: readonly PhaseSuiteReceipt[];
  readonly gitHead?: string | null;
  readonly now?: string | null;
  readonly freshnessWindowMs?: number | null;
  readonly catalogPhaseCaseCount?: number | null;
}

export interface PhaseSuiteBlocker {
  readonly caseId: string;
  readonly reason: PhaseSuiteBlockReason;
  readonly detail: string;
  readonly receiptGitHead: string | null;
}

export interface PhaseSuiteMetrics {
  readonly schemaId: 'atm.phaseSuiteMetrics.v1';
  readonly cacheHitCount: number;
  readonly cacheMissCount: number;
  readonly fanOutConsumerCount: number;
  readonly queueWaitMs: number;
  readonly selectionRatio: number;
  readonly durationMs: number;
  readonly falseBlockCount: number;
  readonly defectDetectionTier: 'clean' | 'stale-guard' | 'blocking';
}

export interface PhaseSuitePromotionReport {
  readonly schemaId: typeof PHASE_SUITE_PROMOTION_REPORT_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly checkpoint: PhaseSuiteCheckpoint;
  readonly ok: boolean;
  readonly blocked: boolean;
  readonly promotionAllowed: boolean;
  readonly requiredCaseIds: readonly string[];
  readonly satisfiedCaseIds: readonly string[];
  readonly blockers: readonly PhaseSuiteBlocker[];
  readonly metrics: PhaseSuiteMetrics;
}

const DEFAULT_FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000;

export function evaluatePhaseSuitePromotion(input: PhaseSuitePromotionInput): PhaseSuitePromotionReport {
  const requiredCaseIds = uniqueSorted(input.requiredPhaseCaseIds);
  const receipts = new Map<string, PhaseSuiteReceipt>();
  for (const receipt of input.receipts ?? []) {
    if (receipt?.caseId) receipts.set(receipt.caseId, receipt);
  }
  const expectedHead = input.gitHead ?? null;
  const nowMs = input.now ? Date.parse(input.now) : Date.now();
  const freshnessWindowMs = Number.isFinite(input.freshnessWindowMs)
    ? Number(input.freshnessWindowMs)
    : DEFAULT_FRESHNESS_WINDOW_MS;

  const blockers: PhaseSuiteBlocker[] = [];
  const satisfied: string[] = [];

  for (const caseId of requiredCaseIds) {
    const receipt = receipts.get(caseId);
    if (!receipt) {
      blockers.push({ caseId, reason: 'missing', detail: 'no phase-suite receipt for the required case', receiptGitHead: null });
      continue;
    }
    const receiptHead = receipt.gitHead ?? null;
    const status = String(receipt.status ?? '').toLowerCase();
    if (status === 'failed' || status === 'blocked' || status === 'timeout') {
      blockers.push({ caseId, reason: 'failed', detail: `receipt status is ${status || 'unknown'}`, receiptGitHead: receiptHead });
      continue;
    }
    if (status !== 'passed') {
      blockers.push({ caseId, reason: 'failed', detail: `receipt status ${status || 'unknown'} is not a passing result`, receiptGitHead: receiptHead });
      continue;
    }
    if (expectedHead && receiptHead && expectedHead !== receiptHead) {
      blockers.push({ caseId, reason: 'stale', detail: `receipt git head ${receiptHead} differs from checkpoint head ${expectedHead}`, receiptGitHead: receiptHead });
      continue;
    }
    if (isReceiptStaleByTime(receipt, nowMs, freshnessWindowMs)) {
      blockers.push({ caseId, reason: 'stale', detail: 'receipt is older than the freshness window or past its freshUntil bound', receiptGitHead: receiptHead });
      continue;
    }
    satisfied.push(caseId);
  }

  const ok = blockers.length === 0 && requiredCaseIds.length > 0;
  const emptyContract = requiredCaseIds.length === 0;
  const metrics = buildPhaseSuiteMetrics(input, requiredCaseIds, blockers);

  return {
    schemaId: PHASE_SUITE_PROMOTION_REPORT_SCHEMA_ID,
    specVersion: '0.1.0',
    checkpoint: input.checkpoint,
    ok,
    blocked: blockers.length > 0,
    // Promotion/release is allowed only when every required receipt is present,
    // fresh and passing. An empty required contract does not silently allow a
    // release checkpoint through.
    promotionAllowed: ok && !emptyContract,
    requiredCaseIds,
    satisfiedCaseIds: uniqueSorted(satisfied),
    blockers,
    metrics
  };
}

function isReceiptStaleByTime(receipt: PhaseSuiteReceipt, nowMs: number, freshnessWindowMs: number): boolean {
  if (receipt.freshUntil) {
    const freshUntilMs = Date.parse(receipt.freshUntil);
    if (Number.isFinite(freshUntilMs) && freshUntilMs < nowMs) return true;
  }
  if (receipt.observedAt) {
    const observedMs = Date.parse(receipt.observedAt);
    if (Number.isFinite(observedMs) && Number.isFinite(nowMs) && nowMs - observedMs > freshnessWindowMs) return true;
  }
  return false;
}

function buildPhaseSuiteMetrics(
  input: PhaseSuitePromotionInput,
  requiredCaseIds: readonly string[],
  blockers: readonly PhaseSuiteBlocker[]
): PhaseSuiteMetrics {
  let cacheHitCount = 0;
  let cacheMissCount = 0;
  let fanOutConsumerCount = 0;
  let queueWaitMs = 0;
  let durationMs = 0;
  for (const receipt of input.receipts ?? []) {
    const cacheDecision = String(receipt.cacheDecision ?? '').toLowerCase();
    if (cacheDecision === 'cache-hit' || cacheDecision === 'receipt-reuse') cacheHitCount += 1;
    else if (cacheDecision === 'cache-miss') cacheMissCount += 1;
    fanOutConsumerCount += Math.max(0, Number(receipt.fanOutConsumerCount ?? 0));
    queueWaitMs += Math.max(0, Number(receipt.queueWaitMs ?? 0));
    durationMs += Math.max(0, Number(receipt.durationMs ?? 0));
  }
  const hasFailed = blockers.some((entry) => entry.reason === 'failed');
  const hasStale = blockers.some((entry) => entry.reason === 'stale' || entry.reason === 'missing');
  const defectDetectionTier = hasFailed ? 'blocking' : hasStale ? 'stale-guard' : 'clean';
  const catalogPhaseCaseCount = Number(input.catalogPhaseCaseCount ?? 0);
  const selectionRatio = catalogPhaseCaseCount > 0
    ? Number((requiredCaseIds.length / catalogPhaseCaseCount).toFixed(4))
    : 0;
  // False blocks are receipts that passed for the checkpoint head yet were still
  // reported as blockers; the gate never does this, so the count is a stable 0
  // that downstream observability can trend.
  const passingHeads = new Set(
    (input.receipts ?? [])
      .filter((receipt) => String(receipt.status ?? '').toLowerCase() === 'passed' && (!input.gitHead || !receipt.gitHead || receipt.gitHead === input.gitHead))
      .map((receipt) => receipt.caseId)
  );
  const falseBlockCount = blockers.filter((entry) => entry.reason !== 'missing' && passingHeads.has(entry.caseId)).length;
  return {
    schemaId: 'atm.phaseSuiteMetrics.v1',
    cacheHitCount,
    cacheMissCount,
    fanOutConsumerCount,
    queueWaitMs,
    selectionRatio,
    durationMs,
    falseBlockCount,
    defectDetectionTier
  };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set((values ?? []).map((value) => String(value ?? '').trim()).filter(Boolean))].sort();
}
