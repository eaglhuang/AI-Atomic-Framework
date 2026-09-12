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
};

export type BurnInPolicy = {
  minCompletedRuns: number;
  minCalendarDays: number;
  protectedBranch: string;
  /** Optional immutable remediation boundary. Runs before it remain historical evidence. */
  baselineAt?: string;
  /** Protected-main commit that establishes the remediation boundary. */
  baselineSha?: string;
};

const DEFAULT_POLICY: BurnInPolicy = {
  minCompletedRuns: 90,
  minCalendarDays: 30,
  protectedBranch: 'main',
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

function parseDate(value: string, field: string): number {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`invalid-${field}`);
  return timestamp;
}

function validateRuns(input: unknown, policy: BurnInPolicy): CiRun[] {
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
    if (typeof run.event !== 'string' || !['push', 'workflow_dispatch'].includes(run.event)) throw new Error(`record-${databaseId}-unprotected-event`);
    if (run.headBranch !== policy.protectedBranch) throw new Error(`record-${databaseId}-non-protected-branch`);
    if (typeof run.createdAt !== 'string') throw new Error(`record-${databaseId}-missing-createdAt`);
    const createdAt = parseDate(run.createdAt, `createdAt-${databaseId}`);
    if (createdAt >= previousCreatedAt) throw new Error(`history-not-newest-first-${run.databaseId}`);
    previousCreatedAt = createdAt;
    runs.push(run as CiRun);
  }
  return runs;
}

export function evaluateBurnIn(input: unknown, suppliedPolicy: Partial<BurnInPolicy> = {}) {
  const policy = { ...DEFAULT_POLICY, ...suppliedPolicy };
  const sourceDigest = digest(input);
  try {
    const allRuns = validateRuns(input, policy);
    const baselineTimestamp = policy.baselineAt ? parseDate(policy.baselineAt, 'baselineAt') : null;
    if (policy.baselineSha && !/^[0-9a-f]{7,64}$/i.test(policy.baselineSha)) throw new Error('invalid-baselineSha');
    if (baselineTimestamp !== null && !policy.baselineSha) throw new Error('baselineSha-required-with-baselineAt');
    if (policy.baselineSha && baselineTimestamp === null) throw new Error('baselineAt-required-with-baselineSha');
    const runs = baselineTimestamp === null ? allRuns : allRuns.filter((run) => parseDate(run.createdAt, `createdAt-${run.databaseId}`) >= baselineTimestamp);
    if (baselineTimestamp !== null && runs.length === 0) throw new Error('baseline-no-post-boundary-runs');
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
    const reasons: string[] = [];
    if (runs.length < policy.minCompletedRuns) reasons.push('insufficient-completed-runs');
    if (calendarDays < policy.minCalendarDays) reasons.push('insufficient-calendar-window');
    if (failedRuns > 0) reasons.push('unexplained-failure-present');
    const claimStatus = reasons.length === 0 ? 'long-term-green' : failedRuns > 0 ? 'unexplained-failure' : 'insufficient-window';
    return {
      schemaId: 'atm.productCiBurnInReport.v1',
      policy,
      input: { sourceDigest, recordCount: runs.length },
      observed: {
        oldestAt: runs[runs.length - 1].createdAt,
        newestAt: runs[0].createdAt,
        calendarDays: Number(calendarDays.toFixed(6)),
        runIds: runs.map((run) => run.databaseId),
        successfulRuns,
        failedRuns,
        currentConsecutiveSuccessStreak: streak,
        releaseCandidateRuns,
        historicalRunCount: allRuns.length - runs.length,
        postBaselineRunCount: runs.length,
        baselineAt: policy.baselineAt ?? null,
        baselineSha: policy.baselineSha ?? null,
      },
      claimStatus,
      reasons,
    } as const;
  } catch (error) {
    return {
      schemaId: 'atm.productCiBurnInReport.v1',
      policy,
      input: { sourceDigest, recordCount: Array.isArray(input) ? input.length : null },
      observed: null,
      claimStatus: 'invalid-input',
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
