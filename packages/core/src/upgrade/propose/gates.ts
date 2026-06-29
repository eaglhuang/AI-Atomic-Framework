/**
 * gates.ts
 *
 * TASK-ASR-0012 — propose.ts 完整拆分
 *
 * 所有 upgrade proposal gate builders。每個 gate 決定一個面向
 * 的升級條件是否通過，結果統一為 { passed, reportId, reportPath, summary }。
 */

import { gateFailureSummary, qualityComparisonFailureReason } from './failure-reason.ts';
import { analyzePolymorphImpact } from '../../polymorph/impact.ts';
import { validateRollbackProof } from '../../registry/rollback-proof.ts';
import { validateRetirementProof } from '../../registry/retirement-proof.ts';
import { validatePropagationReport } from '../../test-runner/propagation.ts';

// ─── Shared types ──────────────────────────────────────────────────────────

/** Normalised gate result returned by all gate builders */
export interface GateResult {
  passed: boolean;
  reportId: string;
  reportPath: string;
  summary: string;
}

/** Raw gate object supplied by callers before normalisation */
interface RawGate {
  passed?: unknown;
  reportId?: unknown;
  reportPath?: unknown;
  summary?: unknown;
}

/** Target descriptor passed to gate builders */
interface GateTarget {
  kind: string;
  mapId: string;
}

/** Generic report-file input holding a parsed document and its file path */
interface ReportInput {
  document: Record<string, unknown> | null | undefined;
  path: string;
}

// ─── Gate result normalizer ────────────────────────────────────────────────

export function normalizeGateResult(gate: RawGate | null | undefined, gateName: string): GateResult | null {
  if (gate == null) {
    return null;
  }
  if (!gate || typeof gate !== 'object') {
    throw new Error(`Upgrade proposal ${gateName} gate must be an object.`);
  }
  if (typeof gate.passed !== 'boolean') {
    throw new Error(`Upgrade proposal ${gateName} gate requires a boolean passed field.`);
  }
  if (typeof gate.reportPath !== 'string' || gate.reportPath.length === 0) {
    throw new Error(`Upgrade proposal ${gateName} gate requires a reportPath.`);
  }
  if (typeof gate.summary !== 'string' || gate.summary.length === 0) {
    throw new Error(`Upgrade proposal ${gateName} gate requires a summary.`);
  }
  return {
    passed: gate.passed,
    reportId: typeof gate.reportId === 'string' && gate.reportId.length > 0 ? gate.reportId : `${gateName}.provided`,
    reportPath: gate.reportPath,
    summary: gate.summary
  };
}

// ─── Base gate builder ─────────────────────────────────────────────────────

export function buildGateResult(gateName: string, report: Record<string, unknown> | null | undefined, reportPath: string, successSummary: string): GateResult {
  const passed = report?.passed === true;
  return {
    passed,
    reportId: (report?.reportId as string | undefined) ?? `${gateName}.missing`,
    reportPath,
    summary: passed ? `pass (${successSummary})` : `blocked (${gateFailureSummary(gateName, report)})`
  };
}

// ─── Specific gate builders ────────────────────────────────────────────────

export function buildQualityComparisonGate(report: Record<string, unknown> | null | undefined, reportPath: string): GateResult {
  const passed = report?.passed === true && report?.regressed !== true;
  const propagationStatus = (report?.mapImpactScope as Record<string, unknown> | undefined)?.propagationStatus;
  const mapPropagationPassed = Array.isArray(propagationStatus)
    ? propagationStatus.every((entry: unknown) => (entry as Record<string, unknown>).integrationTestPassed !== false)
    : true;
  return {
    passed: passed && mapPropagationPassed,
    reportId: (report?.reportId as string | undefined) ?? 'quality-comparison.missing',
    reportPath,
    summary: passed && mapPropagationPassed
      ? 'pass (quality metrics improved; map propagation passed)'
      : `blocked (${qualityComparisonFailureReason(report)})`
  };
}

export function buildRegistryCandidateGate(report: Record<string, unknown> | null | undefined, reportPath: string): GateResult {
  const passed = report?.passed === true && report?.canPromote === true;
  return {
    passed,
    reportId: (report?.reportId as string | undefined) ?? 'registry-candidate.missing',
    reportPath,
    summary: passed ? 'pass (candidate can promote)' : 'blocked (candidate cannot promote)'
  };
}

export function buildMapEquivalenceGate(target: GateTarget, requestedReplacementMode: string, input: ReportInput | null | undefined): GateResult | null {
  if (target.kind !== 'map' || requestedReplacementMode !== 'active') {
    return null;
  }
  if (!input) {
    return {
      passed: false,
      reportId: 'map-equivalence.missing',
      reportPath: '[missing]',
      summary: 'blocked (active replacement requires a passing map equivalence report)'
    };
  }

  const schemaValid = input.document?.schemaId === 'atm.mapEquivalenceReport';
  const mapMatches = input.document?.mapId === target.mapId;
  const passed = schemaValid && mapMatches && input.document?.passed === true;
  const reason = !schemaValid
    ? 'report schemaId must be atm.mapEquivalenceReport'
    : !mapMatches
      ? `report mapId ${String(input.document?.mapId ?? 'unknown')} does not match ${target.mapId}`
      : 'map equivalence report did not pass';

  return {
    passed,
    reportId: (input.document?.reportId as string | undefined) ?? 'map-equivalence.missing',
    reportPath: input.path,
    summary: passed
      ? 'pass (map equivalence passed for active replacement)'
      : `blocked (${reason})`
  };
}

export function buildPolymorphImpactGate(target: GateTarget, requestedReplacementMode: string, repositoryRoot: string, toVersion: string, input: ReportInput | null | undefined): GateResult | null {
  if (target.kind !== 'map' || requestedReplacementMode !== 'active') {
    return null;
  }

  const analysis = analyzePolymorphImpact({
    repositoryRoot,
    mapId: target.mapId,
    toVersion
  });
  if (!analysis.reportRequired) {
    return null;
  }

  if (!input) {
    return {
      passed: false,
      reportId: 'polymorph-impact.missing',
      reportPath: '[missing]',
      summary: 'blocked (active replacement with polymorph template members requires a passing polymorph impact report)'
    };
  }

  const schemaValid = input.document?.schemaId === 'atm.polymorphImpactReport';
  const mapMatches = input.document?.targetMapId === target.mapId;
  const versionMatches = input.document?.toVersion === analysis.toVersion;
  const rawTemplateHits = Array.isArray(input.document?.templateHits) ? input.document!.templateHits : [];
  const templateSetMatches = sameStringSet(
    (rawTemplateHits as unknown[]).map((entry: unknown) => String((entry as Record<string, unknown>)?.templateId ?? '').trim()).filter(Boolean),
    analysis.templateHits.map((entry: { templateId: string }) => entry.templateId)
  );
  const impactedSetMatches = sameStringSet(input.document?.impactedMapIds as string[] | undefined, analysis.impactedMapIds);
  const passed = schemaValid
    && mapMatches
    && versionMatches
    && templateSetMatches
    && impactedSetMatches
    && input.document?.passed === true;
  const reason = !schemaValid
    ? 'report schemaId must be atm.polymorphImpactReport'
    : !mapMatches
      ? `report targetMapId ${String(input.document?.targetMapId ?? 'unknown')} does not match ${target.mapId}`
      : !versionMatches
        ? `report toVersion ${String(input.document?.toVersion ?? 'unknown')} does not match ${analysis.toVersion}`
        : !templateSetMatches
          ? 'report templateHits do not match the current polymorph scan'
          : !impactedSetMatches
            ? 'report impactedMapIds do not match the current polymorph scan'
            : 'polymorph impact report did not pass';

  return {
    passed,
    reportId: (input.document?.reportId as string | undefined) ?? 'polymorph-impact.missing',
    reportPath: input.path,
    summary: passed
      ? 'pass (polymorph impact verified for active replacement)'
      : `blocked (${reason})`
  };
}

export function buildRollbackProofGate(target: GateTarget, requestedReplacementMode: string, input: ReportInput | null | undefined): GateResult | null {
  if (target.kind !== 'map' || requestedReplacementMode !== 'legacy-retired') {
    return null;
  }
  if (!input) {
    return {
      passed: false,
      reportId: 'rollback-proof.missing',
      reportPath: '[missing]',
      summary: 'blocked (legacy-retired replacement requires a passing rollback proof)'
    };
  }

  const schemaValid = input.document?.schemaId === 'atm.rollbackProof';
  const targetKindValid = input.document?.targetKind === 'map';
  const mapMatches = input.document?.mapId === target.mapId;
  const validation = schemaValid && targetKindValid && mapMatches
    ? safeValidateRollbackProof(input.document)
    : { ok: false, issues: [] as string[] };
  const passed = schemaValid
    && targetKindValid
    && mapMatches
    && input.document?.verificationStatus === 'passed'
    && validation.ok;
  const reason = !schemaValid
    ? 'report schemaId must be atm.rollbackProof'
    : !targetKindValid
      ? 'rollback proof targetKind must be map'
      : !mapMatches
        ? `rollback proof mapId ${String(input.document?.mapId ?? 'unknown')} does not match ${target.mapId}`
        : input.document?.verificationStatus !== 'passed'
          ? 'rollback proof verificationStatus must be passed'
          : validation.issues.join(', ') || 'rollback proof validation failed';

  return {
    passed,
    reportId: (input.document?.proofId as string | undefined) ?? 'rollback-proof.missing',
    reportPath: input.path,
    summary: passed
      ? 'pass (rollback proof verified for legacy-retired replacement)'
      : `blocked (${reason})`
  };
}

export function buildPropagationReportGate(target: GateTarget, requestedReplacementMode: string, atomId: string, input: ReportInput | null | undefined): GateResult | null {
  if (target.kind !== 'map' || requestedReplacementMode !== 'active') {
    return null;
  }
  if (!input) {
    return {
      passed: false,
      reportId: 'propagation-report.missing',
      reportPath: '[missing]',
      summary: 'blocked (active replacement requires a passing propagation report)'
    };
  }

  const validation = safeValidatePropagationReport(input.document, {
    atomId,
    mapId: target.mapId
  });
  const passed = validation.ok;
  return {
    passed,
    reportId: (input.document?.reportId as string | undefined) ?? 'propagation-report.missing',
    reportPath: input.path,
    summary: passed
      ? 'pass (propagation report verified downstream map coverage for active replacement)'
      : `blocked (${validation.issues.join(', ') || 'propagation report validation failed'})`
  };
}

export function buildReviewAdvisoryGate(target: GateTarget, requestedReplacementMode: string, proposalId: string, input: ReportInput | null | undefined): GateResult | null {
  if (target.kind !== 'map' || requestedReplacementMode !== 'active') {
    return null;
  }
  if (!input) {
    return {
      passed: false,
      reportId: 'review-advisory.missing',
      reportPath: '[missing]',
      summary: 'blocked (active replacement requires a review advisory report)'
    };
  }

  const advisoryTarget = input.document?.target as Record<string, unknown> | undefined;
  const advisoryTargetId = typeof advisoryTarget?.id === 'string' ? advisoryTarget.id : null;
  const status = String(input.document?.status ?? '').trim();
  const targetMatches = advisoryTargetId == null || advisoryTargetId === proposalId || advisoryTargetId === target.mapId;
  const passed = targetMatches
    && input.document?.advisoryUnavailable !== true
    && (status === 'ok' || status === 'warn');
  const reason = !targetMatches
    ? `review advisory target ${String(advisoryTargetId ?? 'unknown')} does not match proposal ${proposalId}`
    : input.document?.advisoryUnavailable === true || status === 'advisory-unavailable'
      ? 'review advisory is unavailable'
      : 'review advisory status must be ok or warn';

  return {
    passed,
    reportId: (input.document?.reportId as string | undefined) ?? 'review-advisory.missing',
    reportPath: input.path,
    summary: passed
      ? 'pass (review advisory completed for active replacement)'
      : `blocked (${reason})`
  };
}

export function buildHumanReviewGate(target: GateTarget, requestedReplacementMode: string, proposalId: string, atomId: string, input: ReportInput | null | undefined): GateResult | null {
  if (target.kind !== 'map' || requestedReplacementMode !== 'active') {
    return null;
  }
  if (!input) {
    return {
      passed: false,
      reportId: 'human-review.missing',
      reportPath: '[missing]',
      summary: 'blocked (active replacement requires an approved human review decision)'
    };
  }

  const doc = input.document;
  const queueRecord = doc?.queueRecord as Record<string, unknown> | undefined;
  const schemaValid = doc?.schemaId === 'atm.humanReviewDecision';
  const proposalMatches = doc?.proposalId === proposalId || queueRecord?.proposalId === proposalId;
  const atomMatches = doc?.atomId === atomId || queueRecord?.atomId === atomId;
  const queueProposal = queueRecord?.proposal as Record<string, unknown> | undefined;
  const queueProposalTarget = queueProposal?.target as Record<string, unknown> | undefined;
  const docProposal = doc?.proposal as Record<string, unknown> | undefined;
  const docProposalTarget = docProposal?.target as Record<string, unknown> | undefined;
  const reviewedMapId = (queueProposalTarget?.mapId ?? docProposalTarget?.mapId ?? null) as string | null;
  const mapMatches = reviewedMapId == null || reviewedMapId === target.mapId;
  const decisionApproved = doc?.decision === 'approve';
  const queueApproved = queueRecord?.status === 'approved';
  const passed = schemaValid && proposalMatches && atomMatches && mapMatches && decisionApproved && queueApproved;
  const reason = !schemaValid
    ? 'human review decision schemaId must be atm.humanReviewDecision'
    : !proposalMatches
      ? `human review proposalId ${String(doc?.proposalId ?? queueRecord?.proposalId ?? 'unknown')} does not match ${proposalId}`
      : !atomMatches
        ? `human review atomId ${String(doc?.atomId ?? queueRecord?.atomId ?? 'unknown')} does not match ${atomId}`
        : !mapMatches
          ? `human review target map ${String(reviewedMapId ?? 'unknown')} does not match ${target.mapId}`
          : !decisionApproved || !queueApproved
            ? 'human review decision must be approve with queueRecord.status approved'
            : 'human review validation failed';

  return {
    passed,
    reportId: (doc?.evidenceId as string | undefined) ?? (doc?.proposalId as string | undefined) ?? 'human-review.missing',
    reportPath: input.path,
    summary: passed
      ? 'pass (human review approved active replacement)'
      : `blocked (${reason})`
  };
}

export function buildRetirementProofGate(target: GateTarget, requestedReplacementMode: string, input: ReportInput | null | undefined): GateResult | null {
  if (target.kind !== 'map' || requestedReplacementMode !== 'legacy-retired') {
    return null;
  }
  if (!input) {
    return {
      passed: false,
      reportId: 'retirement-proof.missing',
      reportPath: '[missing]',
      summary: 'blocked (legacy-retired replacement requires a passing retirement proof)'
    };
  }

  const schemaValid = input.document?.schemaId === 'atm.retirementProof';
  const mapMatches = input.document?.mapId === target.mapId;
  const validation = schemaValid && mapMatches
    ? safeValidateRetirementProof(input.document)
    : { ok: false, issues: [] as string[] };
  const passed = schemaValid
    && mapMatches
    && input.document?.verificationStatus === 'passed'
    && validation.ok;
  const reason = !schemaValid
    ? 'retirement proof schemaId must be atm.retirementProof'
    : !mapMatches
      ? `retirement proof mapId ${String(input.document?.mapId ?? 'unknown')} does not match ${target.mapId}`
      : input.document?.verificationStatus !== 'passed'
        ? 'retirement proof verificationStatus must be passed'
        : validation.issues.join(', ') || 'retirement proof validation failed';

  return {
    passed,
    reportId: (input.document?.proofId as string | undefined) ?? 'retirement-proof.missing',
    reportPath: input.path,
    summary: passed
      ? 'pass (retirement proof cleared caller and entrypoint risk for legacy-retired replacement)'
      : `blocked (${reason})`
  };
}

// ─── Safe validators（private helpers）────────────────────────────────────

function safeValidateRollbackProof(document: Record<string, unknown> | null | undefined): { ok: boolean; issues: string[] } {
  try {
    return validateRollbackProof(document);
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : String(error)]
    };
  }
}

function safeValidateRetirementProof(document: Record<string, unknown> | null | undefined): { ok: boolean; issues: string[] } {
  try {
    return validateRetirementProof(document);
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : String(error)]
    };
  }
}

function safeValidatePropagationReport(document: Record<string, unknown> | null | undefined, options: { atomId: string; mapId: string }): { ok: boolean; issues: string[] } {
  try {
    return validatePropagationReport(document, options);
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : String(error)]
    };
  }
}

// ─── String set utilities（used by buildPolymorphImpactGate）──────────────

function sameStringSet(left: string[] | undefined, right: string[] | undefined): boolean {
  const leftValues = normalizeStringSet(left);
  const rightValues = normalizeStringSet(right);
  if (leftValues.length !== rightValues.length) {
    return false;
  }
  return leftValues.every((value, index) => value === rightValues[index]);
}

function normalizeStringSet(values: string[] | null | undefined): string[] {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value ?? '').trim())
    .filter(Boolean))].sort();
}
