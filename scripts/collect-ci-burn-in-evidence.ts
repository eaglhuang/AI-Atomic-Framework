import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import type { CiFailureLifecycle, CiRun } from './measure-product-ci-burn-in.ts';

export type CiAttempt = {
  runId: number;
  runAttempt: number;
  status: 'completed';
  conclusion: string;
  headSha: string;
  headBranch: string;
  event: 'push' | 'workflow_dispatch' | 'schedule';
  createdAt: string;
  attemptStartedAt: string;
  attemptCompletedAt: string;
  productCi: { conclusion: string };
  displayTitle?: string;
  workflowName?: string;
  failureClass?: string | null;
  eligible?: boolean;
  exclusionReason?: string | null;
};

export type CiAttemptExport = {
  schemaId: 'atm.githubCiAttemptExport.v1';
  repository: string;
  protectedBranch: string;
  attempts: CiAttempt[];
};

export type LifecycleReceipt = {
  schemaId: 'atm.ciLifecycleEvidence.v1';
  sourceDigest: string;
  receiptDigest: string;
  runs: CiRun[];
};

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

export function canonicalDigest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')}`;
}

function requiredDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error(`invalid-${field}`);
  return value;
}

function validateAttempt(raw: unknown, index: number): CiAttempt {
  if (!raw || typeof raw !== 'object') throw new Error(`attempt-${index}-not-object`);
  const attempt = raw as Partial<CiAttempt>;
  const runId = attempt.runId;
  const runAttempt = attempt.runAttempt;
  if (!Number.isSafeInteger(runId) || runId! <= 0) throw new Error(`attempt-${index}-invalid-runId`);
  if (!Number.isSafeInteger(runAttempt) || runAttempt! < 1) throw new Error(`attempt-${runId!}-invalid-runAttempt`);
  if (attempt.status !== 'completed') throw new Error(`attempt-${runId!}-not-completed`);
  if (typeof attempt.conclusion !== 'string' || attempt.conclusion.length === 0) throw new Error(`attempt-${runId!}-missing-conclusion`);
  if (typeof attempt.headSha !== 'string' || !/^[0-9a-f]{7,64}$/i.test(attempt.headSha)) throw new Error(`attempt-${runId!}-invalid-headSha`);
  if (typeof attempt.headBranch !== 'string' || attempt.headBranch.length === 0) throw new Error(`attempt-${runId!}-missing-headBranch`);
  if (!['push', 'workflow_dispatch', 'schedule'].includes(attempt.event ?? '')) throw new Error(`attempt-${runId!}-unprotected-event`);
  requiredDate(attempt.createdAt, `createdAt-${runId!}`);
  requiredDate(attempt.attemptStartedAt, `attemptStartedAt-${runId!}`);
  requiredDate(attempt.attemptCompletedAt, `attemptCompletedAt-${runId!}`);
  if (!attempt.productCi || typeof attempt.productCi.conclusion !== 'string') throw new Error(`attempt-${runId!}-missing-productCi`);
  if (attempt.eligible === false && (!attempt.exclusionReason || attempt.exclusionReason.trim().length === 0)) throw new Error(`attempt-${runId!}-missing-exclusionReason`);
  return attempt as CiAttempt;
}

function lifecycleFor(attempts: CiAttempt[]): CiFailureLifecycle {
  const failed = attempts.filter((attempt) => attempt.conclusion !== 'success');
  const firstFailure = failed[0];
  const successfulRetry = firstFailure
    ? attempts.find((attempt) => attempt.conclusion === 'success' && attempt.runAttempt > firstFailure.runAttempt)
    : undefined;
  if (firstFailure && (!firstFailure.failureClass || firstFailure.failureClass.trim().length === 0)) {
    throw new Error(`attempt-${firstFailure.runId}-missing-failureClass`);
  }
  return {
    firstFailureAt: firstFailure ? firstFailure.attemptCompletedAt : null,
    retryCount: Math.max(...attempts.map((attempt) => attempt.runAttempt)) - 1,
    lastAttemptAt: attempts[attempts.length - 1].attemptCompletedAt,
    repairAcceptedAt: successfulRetry?.attemptCompletedAt ?? null,
    failureClass: firstFailure?.failureClass ?? null,
  };
}

export function collectLifecycleEvidence(input: unknown): LifecycleReceipt {
  if (!input || typeof input !== 'object') throw new Error('export-not-object');
  const source = input as Partial<CiAttemptExport>;
  if (source.schemaId !== 'atm.githubCiAttemptExport.v1') throw new Error('unsupported-export-schema');
  if (typeof source.repository !== 'string' || source.repository.length === 0) throw new Error('missing-repository');
  if (typeof source.protectedBranch !== 'string' || source.protectedBranch.length === 0) throw new Error('missing-protectedBranch');
  if (!Array.isArray(source.attempts) || source.attempts.length === 0) throw new Error('attempts-empty');
  const attempts = source.attempts.map(validateAttempt);
  const groups = new Map<number, CiAttempt[]>();
  for (const attempt of attempts) {
    const group = groups.get(attempt.runId) ?? [];
    if (group.some((existing) => existing.runAttempt === attempt.runAttempt)) throw new Error(`duplicate-attempt-${attempt.runId}-${attempt.runAttempt}`);
    group.push(attempt);
    groups.set(attempt.runId, group);
  }
  const runs = [...groups.values()].map((group) => {
    group.sort((left, right) => left.runAttempt - right.runAttempt);
    const latest = group[group.length - 1];
    const run: CiRun = {
      databaseId: latest.runId,
      status: 'completed',
      conclusion: latest.conclusion,
      headSha: latest.headSha,
      headBranch: latest.headBranch,
      event: latest.event,
      createdAt: latest.createdAt,
      displayTitle: latest.displayTitle,
      workflowName: latest.workflowName,
      eligible: latest.eligible !== false,
      exclusionReason: latest.exclusionReason ?? null,
      lifecycle: lifecycleFor(group),
    };
    return run;
  }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const canonicalRuns = stableValue(runs) as CiRun[];
  const sourceDigest = canonicalDigest(input);
  return {
    schemaId: 'atm.ciLifecycleEvidence.v1',
    sourceDigest,
    receiptDigest: canonicalDigest(canonicalRuns),
    runs: canonicalRuns,
  };
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const inputPath = option(args, '--input');
  if (!inputPath) throw new Error('missing---input');
  const receipt = collectLifecycleEvidence(JSON.parse(await readFile(inputPath, 'utf8')));
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  const outputPath = option(args, '--output');
  if (outputPath) await writeFile(outputPath, serialized, 'utf8');
  process.stdout.write(serialized);
}

if (process.argv[1]?.endsWith('collect-ci-burn-in-evidence.ts')) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
