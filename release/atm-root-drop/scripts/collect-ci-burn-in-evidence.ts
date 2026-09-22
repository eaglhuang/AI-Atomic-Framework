import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

import type { CiAttemptRecord, CiFailureLifecycle, CiJobProvenance, CiRun, CiStepCoverage } from './measure-product-ci-burn-in.ts';

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
  productCi?: { conclusion: string; job?: CiJobProvenance };
  displayTitle?: string;
  workflowName?: string;
  failureClass?: string | null;
  eligible?: boolean;
  exclusionReason?: string | null;
};

/**
 * Root cause and fix-forward repair for a protected-main failure that was not
 * rescued by a rerun. Part of the export, so it is bound into sourceDigest.
 */
export type CiFailureDisposition = {
  runId: number;
  failureClass: string;
  rootCause: string;
  repairRunId: number;
};

export type CiAttemptExport = {
  schemaId: 'atm.githubCiAttemptExport.v1';
  repository: string;
  protectedBranch: string;
  attempts: CiAttempt[];
  failureDispositions?: CiFailureDisposition[];
};

function applyFailureDispositions(runs: CiRun[], dispositions: unknown): void {
  if (dispositions === undefined) return;
  if (!Array.isArray(dispositions)) throw new Error('failureDispositions-not-array');
  const byId = new Map(runs.map((run) => [run.databaseId, run]));
  const seen = new Set<number>();
  for (const raw of dispositions) {
    const disposition = raw as Partial<CiFailureDisposition>;
    const runId = disposition?.runId;
    if (!Number.isSafeInteger(runId)) throw new Error('failureDisposition-invalid-runId');
    const id = runId as number;
    if (seen.has(id)) throw new Error(`failureDisposition-${id}-duplicate`);
    seen.add(id);
    if (typeof disposition.failureClass !== 'string' || disposition.failureClass.trim().length === 0 || disposition.failureClass.trim() === 'unknown-failure') {
      throw new Error(`failureDisposition-${id}-requires-specific-failureClass`);
    }
    if (typeof disposition.rootCause !== 'string' || disposition.rootCause.trim().length === 0) throw new Error(`failureDisposition-${id}-missing-rootCause`);
    const failed = byId.get(id);
    if (!failed || !failed.eligible) throw new Error(`failureDisposition-${id}-not-an-eligible-run`);
    if (failed.conclusion === 'success') throw new Error(`failureDisposition-${id}-run-did-not-fail`);
    const repair = Number.isSafeInteger(disposition.repairRunId) ? byId.get(disposition.repairRunId as number) : undefined;
    if (!repair || !repair.eligible) throw new Error(`failureDisposition-${id}-repair-run-not-eligible`);
    if (repair.conclusion !== 'success') throw new Error(`failureDisposition-${id}-repair-run-not-successful`);
    if (Date.parse(repair.createdAt) <= Date.parse(failed.createdAt)) throw new Error(`failureDisposition-${id}-repair-run-not-later`);
    failed.lifecycle = {
      ...failed.lifecycle!,
      failureClass: disposition.failureClass.trim(),
      rootCause: disposition.rootCause.trim(),
      repairRunId: repair.databaseId,
      repairAcceptedAt: repair.lifecycle!.lastAttemptAt,
    };
  }
}

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
  requiredProductCiSteps: Array<{ stepName: string; command: string }>;
  policyDigest: string;
};

export type LifecycleReceipt = {
  schemaId: 'atm.ciLifecycleEvidence.v1';
  sourceDigest: string;
  receiptDigest: string;
  scopePolicyDigest: string;
  requiresStepCoverage: true;
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
  if (!Array.isArray(policy.requiredProductCiSteps) || policy.requiredProductCiSteps.length === 0) throw new Error('required-product-ci-steps-empty');
  const requiredStepNames = new Set<string>();
  for (const [index, step] of policy.requiredProductCiSteps.entries()) {
    if (!step || typeof step !== 'object') throw new Error(`required-product-ci-step-${index}-not-object`);
    if (typeof step.stepName !== 'string' || step.stepName.trim().length === 0) throw new Error(`required-product-ci-step-${index}-missing-name`);
    if (typeof step.command !== 'string' || step.command.trim().length === 0) throw new Error(`required-product-ci-step-${index}-missing-command`);
    if (requiredStepNames.has(step.stepName)) throw new Error(`required-product-ci-step-${index}-duplicate-name`);
    requiredStepNames.add(step.stepName);
  }
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

function validateProductJob(job: unknown, runId: number, runAttempt: number): CiJobProvenance {
  if (!job || typeof job !== 'object') throw new Error(`attempt-${runId}-attempt-${runAttempt}-missing-productJob`);
  const candidate = job as Partial<CiJobProvenance>;
  if (!Number.isSafeInteger(candidate.jobId) || candidate.jobId! <= 0) throw new Error(`attempt-${runId}-attempt-${runAttempt}-invalid-jobId`);
  if (typeof candidate.jobName !== 'string' || candidate.jobName.trim().length === 0) throw new Error(`attempt-${runId}-attempt-${runAttempt}-invalid-jobName`);
  if (typeof candidate.jobUrl !== 'string' || !/^https?:\/\//i.test(candidate.jobUrl)) throw new Error(`attempt-${runId}-attempt-${runAttempt}-invalid-jobUrl`);
  if (candidate.steps !== undefined) {
    if (!Array.isArray(candidate.steps)) throw new Error(`attempt-${runId}-attempt-${runAttempt}-invalid-steps`);
    for (const [index, rawStep] of candidate.steps.entries()) {
      if (!rawStep || typeof rawStep !== 'object') throw new Error(`attempt-${runId}-attempt-${runAttempt}-step-${index}-not-object`);
      const step = rawStep as { name?: unknown; status?: unknown; conclusion?: unknown };
      if (typeof step.name !== 'string' || step.name.trim().length === 0) throw new Error(`attempt-${runId}-attempt-${runAttempt}-step-${index}-invalid-name`);
      if (typeof step.status !== 'string' || step.status.trim().length === 0) throw new Error(`attempt-${runId}-attempt-${runAttempt}-step-${index}-invalid-status`);
      if (step.conclusion !== null && typeof step.conclusion !== 'string') throw new Error(`attempt-${runId}-attempt-${runAttempt}-step-${index}-invalid-conclusion`);
    }
  }
  return candidate as CiJobProvenance;
}

function stepCoverage(job: CiJobProvenance, policy: CiWorkflowScopePolicy): CiStepCoverage {
  const missing: string[] = [];
  const ambiguous: string[] = [];
  const unsuccessful: string[] = [];
  const steps = Array.isArray(job.steps) ? job.steps : [];
  for (const required of policy.requiredProductCiSteps) {
    const matches = steps.filter((step) => step.name === required.stepName);
    if (matches.length === 0) {
      missing.push(required.stepName);
    } else if (matches.length > 1) {
      ambiguous.push(required.stepName);
    } else if (matches[0].status !== 'completed' || matches[0].conclusion !== 'success') {
      unsuccessful.push(required.stepName);
    }
  }
  // Coverage completeness answers whether every required step is present
  // exactly once.  A failed required step is still useful lifecycle evidence;
  // its outcome is validated against the product-job conclusion below rather
  // than being discarded as if the step were missing.
  return { complete: missing.length === 0 && ambiguous.length === 0, missing, ambiguous, unsuccessful };
}

function productJobEvidence(attempt: CiAttempt, policy: CiWorkflowScopePolicy): { job: CiJobProvenance | null; coverage: CiStepCoverage; exclusionReason: string | null } {
  const missingCoverage = { complete: false, missing: policy.requiredProductCiSteps.map((step) => step.stepName), ambiguous: [], unsuccessful: [] } satisfies CiStepCoverage;
  if (!attempt.productCi?.job) return { job: null, coverage: missingCoverage, exclusionReason: 'missing-product-job-coverage' };
  let job: CiJobProvenance;
  try {
    job = validateProductJob(attempt.productCi.job, attempt.runId, attempt.runAttempt);
  } catch (error) {
    if (error instanceof Error && error.message.includes('missing-productJob')) return { job: null, coverage: missingCoverage, exclusionReason: 'missing-product-job-coverage' };
    throw error;
  }
  const coverage = stepCoverage(job, policy);
  let exclusionReason: string | null = null;
  if (coverage.missing.length > 0) exclusionReason = 'missing-required-step-coverage';
  else if (coverage.ambiguous.length > 0) exclusionReason = 'ambiguous-required-step-coverage';
  // Keep a failed product job eligible so its first failure and later repair
  // can be measured.  A successful product job with an unsuccessful required
  // step is contradictory and remains excluded as invalid coverage.
  else if (coverage.unsuccessful.length > 0 && attempt.productCi.conclusion === 'success') {
    exclusionReason = 'unsuccessful-required-step-coverage';
  }
  return { job: { ...job, stepCoverage: coverage }, coverage, exclusionReason };
}

function attemptRecord(attempt: CiAttempt, job: CiJobProvenance): CiAttemptRecord {
  if (!attempt.productCi) throw new Error(`attempt-${attempt.runId}-attempt-${attempt.runAttempt}-missing-productCi`);
  return {
    runAttempt: attempt.runAttempt,
    attemptStartedAt: attempt.attemptStartedAt,
    attemptCompletedAt: attempt.attemptCompletedAt,
    workflowConclusion: attempt.conclusion,
    productJobConclusion: attempt.productCi.conclusion,
    failureClass: attempt.failureClass ?? null,
    productJob: job,
  };
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
  if (!attempt.productCi || typeof attempt.productCi.conclusion !== 'string') return { eligible: false, exclusionReason: 'missing-product-job-coverage', identity };
  const evidence = productJobEvidence(attempt, policy);
  if (evidence.exclusionReason) return { eligible: false, exclusionReason: evidence.exclusionReason, identity };
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
    let scope = scopeAttempt(latest, policy);
    let productJobs: CiJobProvenance[] | undefined;
    if (scope.eligible) {
      const evidences = group.map((attempt) => productJobEvidence(attempt, policy));
      const incomplete = evidences.find((evidence) => evidence.exclusionReason || !evidence.job);
      if (incomplete) scope = { ...scope, eligible: false, exclusionReason: incomplete.exclusionReason };
      else productJobs = evidences.map((evidence) => evidence.job!);
    }
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
      productJob: scope.eligible ? productJobs![productJobs!.length - 1] : null,
      attempts: scope.eligible ? group.map((attempt, index) => attemptRecord(attempt, productJobs![index])) : undefined,
      eligible: scope.eligible,
      exclusionReason: scope.exclusionReason,
      lifecycle: lifecycleFor(group, scope.eligible ? conclusionFor : (attempt) => attempt.conclusion),
    };
    return run;
  }).sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  applyFailureDispositions(runs, source.failureDispositions);
  const canonicalRuns = stableValue(runs) as CiRun[];
  const sourceDigest = canonicalDigest(input);
  return {
    schemaId: 'atm.ciLifecycleEvidence.v1',
    sourceDigest,
    receiptDigest: canonicalDigest(canonicalRuns),
    scopePolicyDigest: policy.policyDigest,
    requiresStepCoverage: true,
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
  requiredProductCiSteps: [
    { stepName: 'Clean install', command: 'npm ci' },
    { stepName: 'Build', command: 'npm run build' },
    { stepName: 'Typecheck', command: 'npm run typecheck' },
    { stepName: 'Lint', command: 'npx eslint scripts/validate-ci-product-lane.ts tests/cli/ci-product-lane-contract.test.ts' },
    { stepName: 'Full test', command: 'npm test' },
    { stepName: 'Package skeleton smoke', command: 'validate-package-skeleton.ts' },
    { stepName: 'Clean-install packed CLI smoke', command: 'npm run validate:package-install' },
    { stepName: 'Workspace package smoke', command: 'npm pack --workspaces --dry-run' },
    { stepName: 'Clean-install repeat smoke', command: 'npm ci --ignore-scripts' },
  ],
  policyDigest: 'sha256:39a058e23bfe864620ca8b37f7c3d60e3195835d315d8585efae955c6dd11236',
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
