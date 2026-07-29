import { createRegistryFromSnapshot, readRunnerRegistrySnapshotValue } from './runner-registry-snapshot.ts';
import {
  selectRunnerVersion,
  type PublishedRunnerVersion
} from './runner-version-registry.ts';
import type {
  RunnerSelectionQualificationCaseResult,
  RunnerSelectionQualificationFinding,
  RunnerSelectionQualificationReport,
  RunnerSelectionQualificationVerdict,
  RunnerSelectionVerificationCase,
  RunnerSelectionVerificationPorts
} from './runner-selection-verification-ports.ts';
import type { RunnerVersionRequirement, RunnerVersionSelectionReceipt } from './runner-version-contract.ts';

const REQUIRED_RECEIPT_FIELDS = [
  'policyVersion',
  'registrySnapshotDigest',
  'selection.orderedCandidates'
] as const;

export function verifyRunnerSelection(input: {
  readonly ports: RunnerSelectionVerificationPorts;
  readonly generatedAt: string;
  readonly policyVersion?: string;
  readonly sealedIndependentReport?: boolean;
  readonly ownerApprovedPromotionRecord?: boolean;
}): RunnerSelectionQualificationReport {
  const results = input.ports.readCases().map((entry) => verifyRunnerSelectionCase(entry, input.generatedAt));
  const verdictCounts = buildVerdictCounts(results);
  const falseCompatible = results.filter((result) => result.findings.some((finding) => finding.code === 'selection-mismatch')).length;
  const falseReject = results.filter((result) => result.verdict === 'revalidation-required' && result.expectedVerdict === 'qualified').length;
  const pendingFieldGaps = countPendingFieldGaps(results);
  const explicitCounterfactualCoverage = results.some((result) => result.coverageTags.includes('counterfactual'));
  const zeroPendingContract = verdictCounts['pending-contract'] === 0;
  const zeroFalseCompatible = falseCompatible === 0;
  const ownerApprovedPromotionRecord = input.ownerApprovedPromotionRecord === true;
  return {
    schemaId: 'atm.runnerSelectionQualificationReport.v1',
    specVersion: '0.1.0',
    generatedAt: input.generatedAt,
    policyVersion: input.policyVersion ?? 'runner-selection-qualification@0.1.0',
    caseCount: results.length,
    verdictCounts,
    metrics: {
      selectionAgeMs: summarizeAges(results.map((result) => result.selectionAgeMs).filter((value): value is number => value !== null)),
      latestVersionGapMax: Math.max(0, ...results.map((result) => result.latestVersionGap)),
      revalidationRate: ratio(verdictCounts['revalidation-required'], results.length),
      fallbackRate: ratio(results.filter((result) => result.selectionOutcome === 'aggregate-hash-match').length, results.length),
      falseRejectRate: ratio(falseReject, results.length),
      falseCompatibleRate: ratio(falseCompatible, results.length),
      perCapabilityCoverage: countCoverage(results),
      pendingContractFieldGapCounts: pendingFieldGaps
    },
    promotionPreconditions: {
      sealedIndependentReport: input.sealedIndependentReport === true,
      zeroFalseCompatible,
      explicitCounterfactualCoverage,
      zeroPendingContract,
      ownerApprovedPromotionRecord,
      promotionAllowed: input.sealedIndependentReport === true && zeroFalseCompatible && explicitCounterfactualCoverage && zeroPendingContract && ownerApprovedPromotionRecord
    },
    results
  };
}

export function verifyRunnerSelectionCase(
  verificationCase: RunnerSelectionVerificationCase,
  generatedAt: string
): RunnerSelectionQualificationCaseResult {
  const findings: RunnerSelectionQualificationFinding[] = [];
  let rebuilt;
  try {
    rebuilt = selectRunnerVersion(createRegistryFromSnapshot(readRunnerRegistrySnapshotValue(verificationCase.sealedRegistrySnapshot)), verificationCase.receipt.requirement);
  } catch (error) {
    findings.push({ code: 'historical-snapshot-invalid', message: error instanceof Error ? error.message : String(error) });
    return buildResult(verificationCase, 'unqualified', null, null, generatedAt, findings, []);
  }

  const missingFields = missingContractFields(verificationCase.receipt);
  for (const field of missingFields) {
    findings.push({ code: 'missing-contract-field', field, message: `Receipt is missing required contract field '${field}'.` });
  }

  const receiptSelection = verificationCase.receipt.selection;
  if (
    rebuilt.outcome !== receiptSelection.outcome ||
    rebuilt.sealedSourceSha !== receiptSelection.sealedSourceSha ||
    JSON.stringify(rebuilt.selectedSurfaces) !== JSON.stringify(receiptSelection.selectedSurfaces)
  ) {
    findings.push({
      code: 'selection-mismatch',
      message: 'Independent verifier recomputed a different selection from the sealed registry snapshot.'
    });
  }
  const selectedCandidate = rebuilt.orderedCandidates?.find((candidate) => candidate.sealedSourceSha === rebuilt.sealedSourceSha);
  if (selectedCandidate && (
    !selectedCandidate.trusted ||
    !selectedCandidate.compatible ||
    !selectedCandidate.coversRequiredSurfaces ||
    selectedCandidate.missingValidatorCapabilities.length > 0 ||
    selectedCandidate.missingSchemaCapabilities.length > 0
  )) {
    findings.push({
      code: 'qualification-gate-failed',
      message: selectedCandidate.rejectionReason ?? 'Selected runner did not satisfy the independent qualification gates.'
    });
  }

  if (verificationCase.expectedVerdict) {
    const actual = classifyVerdict({ findings, receipt: verificationCase.receipt, rebuiltOutcome: rebuilt.outcome, verificationCase, generatedAt });
    if (actual !== verificationCase.expectedVerdict) {
      findings.push({
        code: 'counterfactual-mismatch',
        message: `Counterfactual expected ${verificationCase.expectedVerdict} but verifier produced ${actual}.`
      });
    }
  }

  const verdict = classifyVerdict({ findings, receipt: verificationCase.receipt, rebuiltOutcome: rebuilt.outcome, verificationCase, generatedAt });
  const latestGap = latestVersionGap(verificationCase.sealedRegistrySnapshot.versions, rebuilt.sealedSourceSha);
  return buildResult(verificationCase, verdict, rebuilt.sealedSourceSha, rebuilt.outcome, generatedAt, findings, verificationCase.coverageTags ?? [], latestGap);
}

function classifyVerdict(input: {
  readonly findings: readonly RunnerSelectionQualificationFinding[];
  readonly receipt: RunnerVersionSelectionReceipt;
  readonly rebuiltOutcome: string;
  readonly verificationCase: RunnerSelectionVerificationCase;
  readonly generatedAt: string;
}): RunnerSelectionQualificationVerdict {
  if (input.findings.some((finding) => finding.code === 'missing-contract-field')) return 'pending-contract';
  if (isRevalidationExpired(input.receipt, input.generatedAt)) return 'revalidation-required';
  if (input.rebuiltOutcome === 'seal-revalidation-required' || input.rebuiltOutcome === 'no-candidate') return 'revalidation-required';
  if (input.findings.some((finding) => finding.code === 'qualification-gate-failed')) return 'revalidation-required';
  if (input.findings.some((finding) => finding.code === 'selection-mismatch' || finding.code === 'historical-snapshot-invalid')) return 'unqualified';
  return 'qualified';
}

function missingContractFields(receipt: RunnerVersionSelectionReceipt): readonly string[] {
  const missing: string[] = [];
  if (!receipt.policyVersion) missing.push('policyVersion');
  if (!receipt.registrySnapshotDigest) missing.push('registrySnapshotDigest');
  if (!receipt.selection.orderedCandidates) missing.push('selection.orderedCandidates');
  return missing.filter((field) => (REQUIRED_RECEIPT_FIELDS as readonly string[]).includes(field));
}

function isRevalidationExpired(receipt: RunnerVersionSelectionReceipt, generatedAt: string): boolean {
  const boundary = (receipt.selection as { readonly revalidationBoundaryGeneration?: string | null }).revalidationBoundaryGeneration;
  if (!boundary) return false;
  return String(boundary) < generatedAt;
}

function buildResult(
  verificationCase: RunnerSelectionVerificationCase,
  verdict: RunnerSelectionQualificationVerdict,
  selectedRunner: string | null,
  selectionOutcome: string | null,
  generatedAt: string,
  findings: readonly RunnerSelectionQualificationFinding[],
  coverageTags: readonly string[],
  latestVersionGap = 0
): RunnerSelectionQualificationCaseResult {
  return {
    caseId: verificationCase.caseId,
    verdict,
    expectedVerdict: verificationCase.expectedVerdict ?? null,
    selectedRunner,
    selectionOutcome,
    selectionAgeMs: ageMs(verificationCase.receipt.issuedAt, generatedAt),
    latestVersionGap,
    coverageTags: [...new Set(coverageTags)].sort((a, b) => a.localeCompare(b)),
    findings
  };
}

function latestVersionGap(versions: readonly PublishedRunnerVersion[], selectedSha: string): number {
  const ordered = [...versions].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const index = ordered.findIndex((version) => version.sealedSourceSha === selectedSha);
  return index < 0 ? ordered.length : index;
}

function ageMs(issuedAt: string, generatedAt: string): number | null {
  const start = Date.parse(issuedAt);
  const end = Date.parse(generatedAt);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : null;
}

function buildVerdictCounts(results: readonly RunnerSelectionQualificationCaseResult[]): Record<RunnerSelectionQualificationVerdict, number> {
  return {
    qualified: results.filter((result) => result.verdict === 'qualified').length,
    unqualified: results.filter((result) => result.verdict === 'unqualified').length,
    'pending-contract': results.filter((result) => result.verdict === 'pending-contract').length,
    'revalidation-required': results.filter((result) => result.verdict === 'revalidation-required').length
  };
}

function summarizeAges(ages: readonly number[]) {
  if (ages.length === 0) return { min: null, max: null, average: null };
  return {
    min: Math.min(...ages),
    max: Math.max(...ages),
    average: ages.reduce((sum, value) => sum + value, 0) / ages.length
  };
}

function countCoverage(results: readonly RunnerSelectionQualificationCaseResult[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const result of results) {
    for (const tag of result.coverageTags) counts[tag] = (counts[tag] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function countPendingFieldGaps(results: readonly RunnerSelectionQualificationCaseResult[]): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const result of results) {
    for (const finding of result.findings) {
      if (finding.code === 'missing-contract-field' && finding.field) counts[finding.field] = (counts[finding.field] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function ratio(count: number, total: number): number {
  return total === 0 ? 0 : count / total;
}
