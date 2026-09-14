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
  productCi?: { conclusion: string };
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

export type CiWorkflowScopePolicy = {
  schemaId: 'atm.ciWorkflowScopePolicy.v1';
  policyVersion: number;
  protectedBranch: string;
  workflows: Array<{
    workflowName: string;
    displayTitle: string;
    classification: 'standard' | 'release-candidate';
  }>;
  releaseCandidateTreatment: 'include' | 'exclude';
  policyDigest: string;
};

export type LifecycleReceipt = {
  schemaId: 'atm.ciLifecycleEvidence.v1';
  sourceDigest: string;
  receiptDigest: string;
  scopePolicyDigest: string;
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

function policyPayload(policy: CiWorkflowScopePolicy): Omit<CiWorkflowScopePolicy, 'policyDigest'> {
  const { policyDigest: _policyDigest, ...payload } = policy;
  return payload;
}

export function validateScopePolicy(raw: unknown): CiWorkflowScopePolicy {
  if (!raw || typeof raw !== 'object') throw new Error('scope-policy-not-object');
  const policy = raw as Partial<CiWorkflowScopePolicy>;
  if (policy.schemaId !== 'atm.ciWorkflowScopePolicy.v1') throw new Error('unsupported-scope-policy-schema');
  if (!Number.isSafeInteger(policy.policyVersion) || policy.policyVersion! < 1) throw new Error('invalid-scope-policy-version');
  if (typeof policy.protectedBranch !== 'string' || policy.protectedBranch.length === 0) throw new Error('missing-scope-policy-branch');
  if (!Array.isArray(policy.workflows) || policy.workflows.length === 0) throw new Error('scope-policy-workflows-empty');
  if (policy.releaseCandidateTreatment !== 'include' && policy.releaseCandidateTreatment !== 'exclude') throw new Error('invalid-release-candidate-treatment');
  const seen = new Set<string>();
  for (const [index, entry] of policy.workflows.entries()) {
    if (!entry || typeof entry !== 'object') throw new Error(`scope-policy-workflow-${index}-not-object`);
    const candidate = entry as Partial<CiWorkflowScopePolicy['workflows'][number]>;
    if (typeof candidate.workflowName !== 'string' || candidate.workflowName.length === 0) throw new Error(`scope-policy-workflow-${index}-missing-name`);
    if (typeof candidate.displayTitle !== 'string' || candidate.displayTitle.length === 0) throw new Error(`scope-policy-workflow-${index}-missing-title`);
    if (candidate.classification !== 'standard' && candidate.classification !== 'release-candidate') throw new Error(`scope-policy-workflow-${index}-invalid-classification`);
    const key = `${candidate.workflowName}\u0000${candidate.displayTitle}`;
    if (seen.has(key)) throw new Error(`scope-policy-duplicate-workflow-${index}`);
    seen.add(key);
  }
  const releaseEntries = policy.workflows.filter((entry) => entry.classification === 'release-candidate');
  if (policy.releaseCandidateTreatment === 'include' && releaseEntries.length === 0) throw new Error('scope-policy-release-candidate-identity-missing');
  if (typeof policy.policyDigest !== 'string' || !/^sha256:[0-9a-f]{64}$/i.test(policy.policyDigest)) throw new Error('invalid-scope-policy-digest');
  const expectedDigest = canonicalDigest(policyPayload(policy as CiWorkflowScopePolicy));
  if (expectedDigest !== policy.policyDigest) throw new Error('scope-policy-digest-mismatch');
  return policy as CiWorkflowScopePolicy;
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
  if (attempt.productCi !== undefined && (!attempt.productCi || typeof attempt.productCi.conclusion !== 'string' || attempt.productCi.conclusion.length === 0)) throw new Error(`attempt-${runId!}-invalid-productCi`);
  if (attempt.eligible === false && (!attempt.exclusionReason || attempt.exclusionReason.trim().length === 0)) throw new Error(`attempt-${runId!}-missing-exclusionReason`);
  return attempt as CiAttempt;
}

function lifecycleFor(attempts: CiAttempt[], conclusionFor: (attempt: CiAttempt) => string): CiFailureLifecycle {
  const failed = attempts.filter((attempt) => conclusionFor(attempt) !== 'success');
  const firstFailure = failed[0];
  const successfulRetry = firstFailure
    ? attempts.find((attempt) => conclusionFor(attempt) === 'success' && attempt.runAttempt > firstFailure.runAttempt)
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

function scopeAttempt(attempt: CiAttempt, policy: CiWorkflowScopePolicy): { eligible: boolean; exclusionReason: string | null; identity: CiWorkflowScopePolicy['workflows'][number] | null } {
  if (attempt.eligible === false) return { eligible: false, exclusionReason: `source:${attempt.exclusionReason}`, identity: null };
  if (typeof attempt.workflowName !== 'string' || attempt.workflowName.trim().length === 0) return { eligible: false, exclusionReason: 'missing-workflow-identity', identity: null };
  const matches = policy.workflows.filter((entry) => entry.workflowName === attempt.workflowName && entry.displayTitle === attempt.displayTitle);
  if (matches.length !== 1) return { eligible: false, exclusionReason: matches.length === 0 ? 'out-of-scope-workflow' : 'ambiguous-workflow-identity', identity: null };
  const identity = matches[0];
  if (identity.classification === 'release-candidate' && policy.releaseCandidateTreatment === 'exclude') return { eligible: false, exclusionReason: 'release-candidate-excluded-by-policy', identity };
  if (!attempt.productCi || typeof attempt.productCi.conclusion !== 'string') throw new Error(`attempt-${attempt.runId}-missing-productCi`);
  return { eligible: true, exclusionReason: null, identity };
}

export function collectLifecycleEvidence(input: unknown, rawPolicy?: unknown): LifecycleReceipt {
  if (!input || typeof input !== 'object') throw new Error('export-not-object');
  const source = input as Partial<CiAttemptExport>;
  if (source.schemaId !== 'atm.githubCiAttemptExport.v1') throw new Error('unsupported-export-schema');
  if (typeof source.repository !== 'string' || source.repository.length === 0) throw new Error('missing-repository');
  if (typeof source.protectedBranch !== 'string' || source.protectedBranch.length === 0) throw new Error('missing-protectedBranch');
  if (!Array.isArray(source.attempts) || source.attempts.length === 0) throw new Error('attempts-empty');
  const policy = validateScopePolicy(rawPolicy ?? DEFAULT_SCOPE_POLICY);
  if (source.protectedBranch !== policy.protectedBranch) throw new Error('scope-policy-branch-mismatch');
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
    const scope = scopeAttempt(latest, policy);
    const conclusionFor = (attempt: CiAttempt) => attempt.productCi?.conclusion ?? attempt.conclusion;
    const run: CiRun = {
      databaseId: latest.runId,
      status: 'completed',
      conclusion: scope.eligible ? conclusionFor(latest) : latest.conclusion,
      headSha: latest.headSha,
      headBranch: latest.headBranch,
      event: latest.event,
      createdAt: latest.createdAt,
      displayTitle: latest.displayTitle,
      workflowName: latest.workflowName,
      workflowConclusion: latest.conclusion,
      productJobConclusion: latest.productCi?.conclusion ?? null,
      eligible: scope.eligible,
      exclusionReason: scope.exclusionReason,
      lifecycle: lifecycleFor(group, scope.eligible ? conclusionFor : (attempt) => attempt.conclusion),
    };
    return run;
  }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const canonicalRuns = stableValue(runs) as CiRun[];
  const sourceDigest = canonicalDigest(input);
  return {
    schemaId: 'atm.ciLifecycleEvidence.v1',
    sourceDigest,
    receiptDigest: canonicalDigest(canonicalRuns),
    scopePolicyDigest: policy.policyDigest,
    runs: canonicalRuns,
  };
}

export const DEFAULT_SCOPE_POLICY: CiWorkflowScopePolicy = {
  schemaId: 'atm.ciWorkflowScopePolicy.v1',
  policyVersion: 1,
  protectedBranch: 'main',
  workflows: [
    { workflowName: 'Product CI burn-in (standard)', displayTitle: 'Product CI burn-in (standard)', classification: 'standard' },
    { workflowName: 'Product CI burn-in (release-candidate)', displayTitle: 'Product CI burn-in (release-candidate)', classification: 'release-candidate' },
  ],
  releaseCandidateTreatment: 'include',
  policyDigest: 'sha256:54ed1ef6676f4b6a0e7327784f44c6009ab146c797ed6e4e1f0b5081c71e6dfe',
};

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main() {
  const args = process.argv.slice(2);
  const inputPath = option(args, '--input');
  if (!inputPath) throw new Error('missing---input');
  const scopePath = option(args, '--scope-config');
  const scopePolicy = scopePath ? JSON.parse(await readFile(scopePath, 'utf8')) : undefined;
  const receipt = collectLifecycleEvidence(JSON.parse(await readFile(inputPath, 'utf8')), scopePolicy);
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
