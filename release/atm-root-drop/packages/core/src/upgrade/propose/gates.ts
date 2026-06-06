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

// ─── Gate result normalizer ────────────────────────────────────────────────

export function normalizeGateResult(gate: any, gateName: any) {
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

export function buildGateResult(gateName: any, report: any, reportPath: any, successSummary: any) {
  const passed = report?.passed === true;
  return {
    passed,
    reportId: report?.reportId ?? `${gateName}.missing`,
    reportPath,
    summary: passed ? `pass (${successSummary})` : `blocked (${gateFailureSummary(gateName, report)})`
  };
}

// ─── Specific gate builders ────────────────────────────────────────────────

export function buildQualityComparisonGate(report: any, reportPath: any) {
  const passed = report?.passed === true && report?.regressed !== true;
  const mapPropagationPassed = report?.mapImpactScope?.propagationStatus?.every((entry: any) => entry.integrationTestPassed !== false) ?? true;
  return {
    passed: passed && mapPropagationPassed,
    reportId: report?.reportId ?? 'quality-comparison.missing',
    reportPath,
    summary: passed && mapPropagationPassed
      ? 'pass (quality metrics improved; map propagation passed)'
      : `blocked (${qualityComparisonFailureReason(report)})`
  };
}

export function buildRegistryCandidateGate(report: any, reportPath: any) {
  const passed = report?.passed === true && report?.canPromote === true;
  return {
    passed,
    reportId: report?.reportId ?? 'registry-candidate.missing',
    reportPath,
    summary: passed ? 'pass (candidate can promote)' : 'blocked (candidate cannot promote)'
  };
}

export function buildMapEquivalenceGate(target: any, requestedReplacementMode: any, input: any) {
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
    reportId: input.document?.reportId ?? 'map-equivalence.missing',
    reportPath: input.path,
    summary: passed
      ? 'pass (map equivalence passed for active replacement)'
      : `blocked (${reason})`
  };
}

export function buildPolymorphImpactGate(target: any, requestedReplacementMode: any, repositoryRoot: any, toVersion: any, input: any) {
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
  const templateSetMatches = sameStringSet(
    (Array.isArray(input.document?.templateHits) ? input.document.templateHits : []).map((entry: any) => String(entry?.templateId ?? '').trim()).filter(Boolean),
    analysis.templateHits.map((entry: any) => entry.templateId)
  );
  const impactedSetMatches = sameStringSet(input.document?.impactedMapIds, analysis.impactedMapIds);
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
    reportId: input.document?.reportId ?? 'polymorph-impact.missing',
    reportPath: input.path,
    summary: passed
      ? 'pass (polymorph impact verified for active replacement)'
      : `blocked (${reason})`
  };
}

export function buildRollbackProofGate(target: any, requestedReplacementMode: any, input: any) {
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
    : { ok: false, issues: [] };
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
    reportId: input.document?.proofId ?? 'rollback-proof.missing',
    reportPath: input.path,
    summary: passed
      ? 'pass (rollback proof verified for legacy-retired replacement)'
      : `blocked (${reason})`
  };
}

export function buildPropagationReportGate(target: any, requestedReplacementMode: any, atomId: any, input: any) {
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
    reportId: input.document?.reportId ?? 'propagation-report.missing',
    reportPath: input.path,
    summary: passed
      ? 'pass (propagation report verified downstream map coverage for active replacement)'
      : `blocked (${validation.issues.join(', ') || 'propagation report validation failed'})`
  };
}

export function buildReviewAdvisoryGate(target: any, requestedReplacementMode: any, proposalId: any, input: any) {
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

  const advisoryTargetId = typeof input.document?.target?.id === 'string' ? input.document.target.id : null;
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
    reportId: input.document?.reportId ?? 'review-advisory.missing',
    reportPath: input.path,
    summary: passed
      ? 'pass (review advisory completed for active replacement)'
      : `blocked (${reason})`
  };
}

export function buildHumanReviewGate(target: any, requestedReplacementMode: any, proposalId: any, atomId: any, input: any) {
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

  const schemaValid = input.document?.schemaId === 'atm.humanReviewDecision';
  const proposalMatches = input.document?.proposalId === proposalId || input.document?.queueRecord?.proposalId === proposalId;
  const atomMatches = input.document?.atomId === atomId || input.document?.queueRecord?.atomId === atomId;
  const reviewedMapId = input.document?.queueRecord?.proposal?.target?.mapId ?? input.document?.proposal?.target?.mapId ?? null;
  const mapMatches = reviewedMapId == null || reviewedMapId === target.mapId;
  const decisionApproved = input.document?.decision === 'approve';
  const queueApproved = input.document?.queueRecord?.status === 'approved';
  const passed = schemaValid && proposalMatches && atomMatches && mapMatches && decisionApproved && queueApproved;
  const reason = !schemaValid
    ? 'human review decision schemaId must be atm.humanReviewDecision'
    : !proposalMatches
      ? `human review proposalId ${String(input.document?.proposalId ?? input.document?.queueRecord?.proposalId ?? 'unknown')} does not match ${proposalId}`
      : !atomMatches
        ? `human review atomId ${String(input.document?.atomId ?? input.document?.queueRecord?.atomId ?? 'unknown')} does not match ${atomId}`
        : !mapMatches
          ? `human review target map ${String(reviewedMapId ?? 'unknown')} does not match ${target.mapId}`
          : !decisionApproved || !queueApproved
            ? 'human review decision must be approve with queueRecord.status approved'
            : 'human review validation failed';

  return {
    passed,
    reportId: input.document?.evidenceId ?? input.document?.proposalId ?? 'human-review.missing',
    reportPath: input.path,
    summary: passed
      ? 'pass (human review approved active replacement)'
      : `blocked (${reason})`
  };
}

export function buildRetirementProofGate(target: any, requestedReplacementMode: any, input: any) {
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
    : { ok: false, issues: [] };
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
    reportId: input.document?.proofId ?? 'retirement-proof.missing',
    reportPath: input.path,
    summary: passed
      ? 'pass (retirement proof cleared caller and entrypoint risk for legacy-retired replacement)'
      : `blocked (${reason})`
  };
}

// ─── Safe validators（private helpers）────────────────────────────────────

function safeValidateRollbackProof(document: any) {
  try {
    return validateRollbackProof(document);
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : String(error)]
    };
  }
}

function safeValidateRetirementProof(document: any) {
  try {
    return validateRetirementProof(document);
  } catch (error) {
    return {
      ok: false,
      issues: [error instanceof Error ? error.message : String(error)]
    };
  }
}

function safeValidatePropagationReport(document: any, options: any) {
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

function sameStringSet(left: any, right: any) {
  const leftValues = normalizeStringSet(left);
  const rightValues = normalizeStringSet(right);
  if (leftValues.length !== rightValues.length) {
    return false;
  }
  return leftValues.every((value, index) => value === rightValues[index]);
}

function normalizeStringSet(values: any) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value ?? '').trim())
    .filter(Boolean))].sort();
}
