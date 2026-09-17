import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export type CiRun = {
  databaseId: number;
  status: string;
  conclusion: string | null;
  headSha: string;
  headBranch?: string;
  event: string;
  createdAt: string;
  displayTitle?: string;
  workflowName?: string;
  workflowConclusion?: string | null;
  productJobConclusion?: string | null;
  productJob?: CiJobProvenance | null;
  attempts?: CiAttemptRecord[];
  eligible?: boolean;
  exclusionReason?: string | null;
  lifecycle?: CiFailureLifecycle;
};

export type CiJobProvenance = {
  jobId: number;
  jobName: string;
  jobUrl: string;
};

export type CiAttemptRecord = {
  runAttempt: number;
  attemptStartedAt: string;
  attemptCompletedAt: string;
  workflowConclusion: string;
  productJobConclusion: string;
  failureClass: string | null;
  productJob: CiJobProvenance;
};

export type CiFailureLifecycle = {
  firstFailureAt: string | null;
  retryCount: number;
  lastAttemptAt: string;
  repairAcceptedAt: string | null;
  failureClass: string | null;
};

export type BurnInPolicy = {
  minCompletedRuns: number;
  minCalendarDays: number;
  protectedBranch: string;
  requireLifecycle: boolean;
  /** Optional immutable remediation boundary. Runs before it remain historical evidence. */
  baselineAt?: string;
  /** Protected-main commit that establishes the remediation boundary. */
  baselineSha?: string;
};

type LifecycleReceiptInput = {
  schemaId: 'atm.ciLifecycleEvidence.v1';
  sourceDigest: string;
  receiptDigest: string;
  scopePolicyDigest?: string;
  runs: CiRun[];
};

type NormalizedBurnInInput = {
  runs: unknown;
  sourceDigest: string;
  receiptDigest: string | null;
  scopePolicyDigest: string | null;
  requiresJobProvenance: boolean;
};

const DEFAULT_POLICY: BurnInPolicy = {
  minCompletedRuns: 90,
  minCalendarDays: 30,
  protectedBranch: 'main',
  requireLifecycle: true,
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, stableValue(entry)]),
    );
  }
  return value;
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')}`;
}

function normalizeInput(input: unknown): NormalizedBurnInInput {
  if (Array.isArray(input)) {
    return { runs: input, sourceDigest: digest(input), receiptDigest: null, scopePolicyDigest: null, requiresJobProvenance: false };
  }
  if (!input || typeof input !== 'object') throw new Error('history-empty');
  const receipt = input as Partial<LifecycleReceiptInput>;
  if (receipt.schemaId !== 'atm.ciLifecycleEvidence.v1') throw new Error('unsupported-receipt-schema');
  if (typeof receipt.sourceDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/i.test(receipt.sourceDigest)) throw new Error('invalid-sourceDigest');
  if (typeof receipt.receiptDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/i.test(receipt.receiptDigest)) throw new Error('invalid-receiptDigest');
  if (receipt.scopePolicyDigest !== undefined && (typeof receipt.scopePolicyDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/i.test(receipt.scopePolicyDigest))) throw new Error('invalid-scopePolicyDigest');
  if (!Array.isArray(receipt.runs) || receipt.runs.length === 0) throw new Error('history-empty');
  const computedReceiptDigest = digest(receipt.runs);
  if (computedReceiptDigest !== receipt.receiptDigest) throw new Error('receiptDigest-mismatch');
  return { runs: receipt.runs, sourceDigest: receipt.sourceDigest, receiptDigest: receipt.receiptDigest, scopePolicyDigest: receipt.scopePolicyDigest ?? null, requiresJobProvenance: true };
}

function parseDate(value: string, field: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`invalid-${field}`);
  return timestamp;
}

function validateLifecycle(run: CiRun): CiFailureLifecycle {
  if (!run.lifecycle || typeof run.lifecycle !== 'object') throw new Error(`record-${run.databaseId}-missing-lifecycle`);
  const lifecycle = run.lifecycle;
  if (lifecycle.firstFailureAt !== null && typeof lifecycle.firstFailureAt !== 'string') throw new Error(`record-${run.databaseId}-invalid-firstFailureAt`);
  if (lifecycle.firstFailureAt !== null) parseDate(lifecycle.firstFailureAt, `firstFailureAt-${run.databaseId}`);
  if (!Number.isSafeInteger(lifecycle.retryCount) || lifecycle.retryCount < 0) throw new Error(`record-${run.databaseId}-invalid-retryCount`);
  if (typeof lifecycle.lastAttemptAt !== 'string') throw new Error(`record-${run.databaseId}-missing-lastAttemptAt`);
  const lastAttemptAt = parseDate(lifecycle.lastAttemptAt, `lastAttemptAt-${run.databaseId}`);
  const createdAt = parseDate(run.createdAt, `createdAt-${run.databaseId}`);
  if (lastAttemptAt < createdAt) throw new Error(`record-${run.databaseId}-lastAttempt-before-created`);
  if (lifecycle.repairAcceptedAt !== null && typeof lifecycle.repairAcceptedAt !== 'string') throw new Error(`record-${run.databaseId}-invalid-repairAcceptedAt`);
  if (lifecycle.repairAcceptedAt !== null) {
    const repairAcceptedAt = parseDate(lifecycle.repairAcceptedAt, `repairAcceptedAt-${run.databaseId}`);
    if (lifecycle.firstFailureAt === null) throw new Error(`record-${run.databaseId}-repair-without-first-failure`);
    if (repairAcceptedAt < parseDate(lifecycle.firstFailureAt, `firstFailureAt-${run.databaseId}`)) throw new Error(`record-${run.databaseId}-repair-before-first-failure`);
  }
  if (run.conclusion !== 'success' && lifecycle.firstFailureAt === null) throw new Error(`record-${run.databaseId}-missing-first-failure`);
  if (run.conclusion !== 'success' && (!lifecycle.failureClass || lifecycle.failureClass.trim().length === 0)) throw new Error(`record-${run.databaseId}-missing-failureClass`);
  if (run.conclusion === 'success' && lifecycle.retryCount > 0 && (lifecycle.firstFailureAt === null || lifecycle.repairAcceptedAt === null)) throw new Error(`record-${run.databaseId}-unrepaired-retry`);
  return lifecycle;
}

function validateJobProvenance(job: unknown, field: string): CiJobProvenance {
  if (!job || typeof job !== 'object') throw new Error(`${field}-missing-productJob`);
  const candidate = job as Partial<CiJobProvenance>;
  if (!Number.isSafeInteger(candidate.jobId) || candidate.jobId! <= 0) throw new Error(`${field}-invalid-jobId`);
  if (typeof candidate.jobName !== 'string' || candidate.jobName.trim().length === 0) throw new Error(`${field}-invalid-jobName`);
  if (typeof candidate.jobUrl !== 'string' || !/^https?:\/\//i.test(candidate.jobUrl)) throw new Error(`${field}-invalid-jobUrl`);
  return candidate as CiJobProvenance;
}

function validateAttemptProvenance(run: CiRun): void {
  if (!Array.isArray(run.attempts) || run.attempts.length === 0) throw new Error(`record-${run.databaseId}-missing-attempt-provenance`);
  const seen = new Set<number>();
  for (const [index, raw] of run.attempts.entries()) {
    if (!raw || typeof raw !== 'object') throw new Error(`record-${run.databaseId}-attempt-${index}-not-object`);
    const attempt = raw as Partial<CiAttemptRecord>;
    if (!Number.isSafeInteger(attempt.runAttempt) || attempt.runAttempt! < 1 || seen.has(attempt.runAttempt!)) throw new Error(`record-${run.databaseId}-attempt-${index}-invalid-runAttempt`);
    seen.add(attempt.runAttempt!);
    if (typeof attempt.attemptStartedAt !== 'string' || !Number.isFinite(Date.parse(attempt.attemptStartedAt))) throw new Error(`record-${run.databaseId}-attempt-${index}-invalid-start`);
    if (typeof attempt.attemptCompletedAt !== 'string' || !Number.isFinite(Date.parse(attempt.attemptCompletedAt))) throw new Error(`record-${run.databaseId}-attempt-${index}-invalid-completed`);
    if (typeof attempt.workflowConclusion !== 'string' || attempt.workflowConclusion.length === 0) throw new Error(`record-${run.databaseId}-attempt-${index}-missing-workflow-conclusion`);
    if (typeof attempt.productJobConclusion !== 'string' || attempt.productJobConclusion.length === 0) throw new Error(`record-${run.databaseId}-attempt-${index}-missing-product-conclusion`);
    if (attempt.failureClass !== null && typeof attempt.failureClass !== 'string') throw new Error(`record-${run.databaseId}-attempt-${index}-invalid-failureClass`);
    validateJobProvenance(attempt.productJob, `record-${run.databaseId}-attempt-${index}`);
  }
}

function validateRuns(input: unknown, policy: BurnInPolicy, requiresJobProvenance = false): CiRun[] {
  if (!Array.isArray(input) || input.length === 0) throw new Error('history-empty');
  const seenIds = new Set<number>();
  let previousCreatedAt = Number.POSITIVE_INFINITY;
  const runs: CiRun[] = [];

  for (const [index, raw] of input.entries()) {
    if (!raw || typeof raw !== 'object') throw new Error(`record-${index}-not-object`);
    const run = raw as Partial<CiRun>;
    if (typeof run.databaseId !== 'number' || !Number.isSafeInteger(run.databaseId) || run.databaseId <= 0) throw new Error(`record-${index}-missing-databaseId`);
    const databaseId: number = run.databaseId;
    if (seenIds.has(databaseId)) throw new Error(`duplicate-databaseId-${databaseId}`);
    seenIds.add(databaseId);
    if (run.status !== 'completed') throw new Error(`record-${databaseId}-not-completed`);
    if (typeof run.conclusion !== 'string' || run.conclusion.length === 0) throw new Error(`record-${databaseId}-missing-conclusion`);
    if (typeof run.headSha !== 'string' || !/^[0-9a-f]{7,64}$/i.test(run.headSha)) throw new Error(`record-${databaseId}-missing-headSha`);
    // Scheduled protected-main observations are part of the product burn-in:
    // ci.yml uses them to keep the window alive when no contributor push lands.
    if (typeof run.event !== 'string' || !['push', 'workflow_dispatch', 'schedule'].includes(run.event)) throw new Error(`record-${databaseId}-unprotected-event`);
    if (run.headBranch !== policy.protectedBranch) throw new Error(`record-${databaseId}-non-protected-branch`);
    if (typeof run.createdAt !== 'string') throw new Error(`record-${databaseId}-missing-createdAt`);
    const createdAt = parseDate(run.createdAt, `createdAt-${databaseId}`);
    if (createdAt >= previousCreatedAt) throw new Error(`history-not-newest-first-${run.databaseId}`);
    const eligible = run.eligible !== false;
    if (!eligible && (!run.exclusionReason || run.exclusionReason.trim().length === 0)) throw new Error(`record-${databaseId}-missing-exclusionReason`);
    if (policy.requireLifecycle) validateLifecycle(run as CiRun);
    if (eligible && run.productJobConclusion !== undefined && run.productJobConclusion !== run.conclusion) throw new Error(`record-${databaseId}-product-conclusion-mismatch`);
    // The collector deliberately omits attempt provenance for scope-excluded
    // runs.  Validate provenance for eligible observations only; excluded
    // records still need their exclusion reason and lifecycle validated above.
    if (requiresJobProvenance && eligible) validateAttemptProvenance(run as CiRun);
    previousCreatedAt = createdAt;
    runs.push(run as CiRun);
  }
  return runs;
}

export function evaluateBurnIn(input: unknown, suppliedPolicy: Partial<BurnInPolicy> = {}) {
  const policy = { ...DEFAULT_POLICY, ...suppliedPolicy };
  let normalized: NormalizedBurnInInput;
  try {
    normalized = normalizeInput(input);
    const allRuns = validateRuns(normalized.runs, policy, normalized.requiresJobProvenance);
    const baselineTimestamp = policy.baselineAt ? parseDate(policy.baselineAt, 'baselineAt') : null;
    if (policy.baselineSha && !/^[0-9a-f]{7,64}$/i.test(policy.baselineSha)) throw new Error('invalid-baselineSha');
    if (baselineTimestamp !== null && !policy.baselineSha) throw new Error('baselineSha-required-with-baselineAt');
    if (policy.baselineSha && baselineTimestamp === null) throw new Error('baselineAt-required-with-baselineSha');
    const scopedRuns = baselineTimestamp === null ? allRuns : allRuns.filter((run) => parseDate(run.createdAt, `createdAt-${run.databaseId}`) >= baselineTimestamp);
    const excludedRuns = scopedRuns.filter((run) => run.eligible === false);
    const runs = scopedRuns.filter((run) => run.eligible !== false);
    if (baselineTimestamp !== null && runs.length === 0) throw new Error('baseline-no-post-boundary-runs');
    if (runs.length === 0) throw new Error('no-eligible-runs');
    if (baselineTimestamp !== null && !runs.some((run) => run.headSha.toLowerCase() === policy.baselineSha!.toLowerCase())) throw new Error('baselineSha-not-observed-on-protected-main');
    const newest = parseDate(runs[0].createdAt, 'newest-createdAt');
    const oldest = parseDate(runs[runs.length - 1].createdAt, 'oldest-createdAt');
    const calendarDays = (newest - oldest) / 86_400_000;
    const successfulRuns = runs.filter((run) => run.conclusion === 'success').length;
    const failedRuns = runs.length - successfulRuns;
    let streak = 0;
    for (const run of runs) {
      if (run.conclusion !== 'success') break;
      streak += 1;
    }
    const releaseCandidateRuns = runs.filter((run) => /release[- ]candidate/i.test(run.displayTitle ?? '')).length;
    const excludedRunReasons = Object.fromEntries([...excludedRuns.reduce((counts, run) => {
      const reason = run.exclusionReason ?? 'unspecified';
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
      return counts;
    }, new Map<string, number>())].sort(([left], [right]) => left.localeCompare(right)));
    const lifecycles = runs.map((run) => run.lifecycle).filter((lifecycle): lifecycle is CiFailureLifecycle => lifecycle !== undefined);
    const retriedRuns = lifecycles.filter((lifecycle) => lifecycle.retryCount > 0).length;
    const retryCount = lifecycles.reduce((total, lifecycle) => total + lifecycle.retryCount, 0);
    const unresolvedFailures = runs.filter((run) => run.conclusion !== 'success' && run.lifecycle?.repairAcceptedAt === null).length;
    const repairTimesMs = lifecycles
      .filter((lifecycle) => lifecycle.firstFailureAt !== null && lifecycle.repairAcceptedAt !== null)
      .map((lifecycle) => parseDate(lifecycle.repairAcceptedAt!, 'repairAcceptedAt') - parseDate(lifecycle.firstFailureAt!, 'firstFailureAt'));
    if (repairTimesMs.some((duration) => duration < 0)) throw new Error('negative-repair-time');
    const reasons: string[] = [];
    if (runs.length < policy.minCompletedRuns) reasons.push('insufficient-completed-runs');
    if (calendarDays < policy.minCalendarDays) reasons.push('insufficient-calendar-window');
    if (failedRuns > 0) reasons.push('unexplained-failure-present');
    const claimStatus = reasons.length === 0 ? 'long-term-green' : failedRuns > 0 ? 'unexplained-failure' : 'insufficient-window';
    return {
      schemaId: 'atm.productCiBurnInReport.v1',
      policy,
      input: { sourceDigest: normalized.sourceDigest, receiptDigest: normalized.receiptDigest, scopePolicyDigest: normalized.scopePolicyDigest, recordCount: runs.length },
      observed: {
        oldestAt: runs[runs.length - 1].createdAt,
        newestAt: runs[0].createdAt,
        calendarDays: Number(calendarDays.toFixed(6)),
        runIds: runs.map((run) => run.databaseId),
        successfulRuns,
        failedRuns,
        currentConsecutiveSuccessStreak: streak,
        releaseCandidateRuns,
        excludedRunCount: excludedRuns.length,
        excludedRunIds: excludedRuns.map((run) => run.databaseId),
        excludedRunReasons,
        retriedRuns,
        retryCount,
        unresolvedFailures,
        repairTimeMs: repairTimesMs,
        averageRepairTimeMs: repairTimesMs.length > 0 ? Math.round(repairTimesMs.reduce((total, duration) => total + duration, 0) / repairTimesMs.length) : null,
        historicalRunCount: allRuns.length - scopedRuns.length,
        postBaselineRunCount: runs.length,
        baselineAt: policy.baselineAt ?? null,
        baselineSha: policy.baselineSha ?? null,
      },
      claimStatus: reasons.length === 0 && unresolvedFailures > 0 ? 'unexplained-failure' : claimStatus,
      semanticVerdict: reasons.length === 0 && unresolvedFailures === 0 ? 'accept' : 'reject',
      reasons,
    } as const;
  } catch (error) {
    const sourceDigest = digest(input);
    const recordCount = Array.isArray(input)
      ? input.length
      : input && typeof input === 'object' && Array.isArray((input as { runs?: unknown }).runs)
        ? (input as { runs: unknown[] }).runs.length
        : null;
    return {
      schemaId: 'atm.productCiBurnInReport.v1',
      policy,
      input: { sourceDigest, receiptDigest: null, recordCount },
      observed: null,
      claimStatus: 'invalid-input',
      semanticVerdict: 'reject',
      reasons: [error instanceof Error ? error.message : 'invalid-input'],
    } as const;
  }
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const inputPath = option(args, '--input');
  let rawInput: string;
  if (args.includes('--stdin')) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    rawInput = Buffer.concat(chunks).toString('utf8');
  } else {
    if (!inputPath) throw new Error('missing---input');
    rawInput = await readFile(inputPath, 'utf8');
  }
  const input = JSON.parse(rawInput);
  const report = evaluateBurnIn(input, {
    minCompletedRuns: Number(option(args, '--min-runs') ?? DEFAULT_POLICY.minCompletedRuns),
    minCalendarDays: Number(option(args, '--min-days') ?? DEFAULT_POLICY.minCalendarDays),
    protectedBranch: option(args, '--branch') ?? DEFAULT_POLICY.protectedBranch,
    baselineAt: option(args, '--baseline-at'),
    baselineSha: option(args, '--baseline-sha'),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  // Report-only mode is for collecting a durable negative observation. The
  // default remains a fail-closed gate for CI callers.
  if (report.claimStatus !== 'long-term-green' && !args.includes('--report-only')) process.exitCode = 1;
}

if (process.argv[1]?.endsWith('measure-product-ci-burn-in.ts')) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
