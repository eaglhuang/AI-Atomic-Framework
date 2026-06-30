/**
 * gates.ts
 *
 * TASK-ASR-0012 — propose.ts 完整拆分
 *
 * 所有 upgrade proposal gate builders。每個 gate 決定一個面向
 * 的升級條件是否通過，結果統一為 { passed, reportId, reportPath, summary }。
 */
import { gateFailureSummary, qualityComparisonFailureReason } from './failure-reason.js';
import { analyzePolymorphImpact } from '../../polymorph/impact.js';
import { validateRollbackProof } from '../../registry/rollback-proof.js';
import { validateRetirementProof } from '../../registry/retirement-proof.js';
import { validatePropagationReport } from '../../test-runner/propagation.js';
// ─── Gate result normalizer ────────────────────────────────────────────────
export function normalizeGateResult(gate, gateName) {
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
export function buildGateResult(gateName, report, reportPath, successSummary) {
    const passed = report?.passed === true;
    return {
        passed,
        reportId: report?.reportId ?? `${gateName}.missing`,
        reportPath,
        summary: passed ? `pass (${successSummary})` : `blocked (${gateFailureSummary(gateName, report)})`
    };
}
// ─── Specific gate builders ────────────────────────────────────────────────
export function buildQualityComparisonGate(report, reportPath) {
    const passed = report?.passed === true && report?.regressed !== true;
    const propagationStatus = report?.mapImpactScope?.propagationStatus;
    const mapPropagationPassed = Array.isArray(propagationStatus)
        ? propagationStatus.every((entry) => entry.integrationTestPassed !== false)
        : true;
    return {
        passed: passed && mapPropagationPassed,
        reportId: report?.reportId ?? 'quality-comparison.missing',
        reportPath,
        summary: passed && mapPropagationPassed
            ? 'pass (quality metrics improved; map propagation passed)'
            : `blocked (${qualityComparisonFailureReason(report)})`
    };
}
export function buildRegistryCandidateGate(report, reportPath) {
    const passed = report?.passed === true && report?.canPromote === true;
    return {
        passed,
        reportId: report?.reportId ?? 'registry-candidate.missing',
        reportPath,
        summary: passed ? 'pass (candidate can promote)' : 'blocked (candidate cannot promote)'
    };
}
export function buildMapEquivalenceGate(target, requestedReplacementMode, input) {
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
export function buildPolymorphImpactGate(target, requestedReplacementMode, repositoryRoot, toVersion, input) {
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
    const rawTemplateHits = Array.isArray(input.document?.templateHits) ? input.document.templateHits : [];
    const templateSetMatches = sameStringSet(rawTemplateHits.map((entry) => String(entry?.templateId ?? '').trim()).filter(Boolean), analysis.templateHits.map((entry) => entry.templateId));
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
export function buildRollbackProofGate(target, requestedReplacementMode, input) {
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
export function buildPropagationReportGate(target, requestedReplacementMode, atomId, input) {
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
export function buildReviewAdvisoryGate(target, requestedReplacementMode, proposalId, input) {
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
    const advisoryTarget = input.document?.target;
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
        reportId: input.document?.reportId ?? 'review-advisory.missing',
        reportPath: input.path,
        summary: passed
            ? 'pass (review advisory completed for active replacement)'
            : `blocked (${reason})`
    };
}
export function buildHumanReviewGate(target, requestedReplacementMode, proposalId, atomId, input) {
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
    const queueRecord = doc?.queueRecord;
    const schemaValid = doc?.schemaId === 'atm.humanReviewDecision';
    const proposalMatches = doc?.proposalId === proposalId || queueRecord?.proposalId === proposalId;
    const atomMatches = doc?.atomId === atomId || queueRecord?.atomId === atomId;
    const queueProposal = queueRecord?.proposal;
    const queueProposalTarget = queueProposal?.target;
    const docProposal = doc?.proposal;
    const docProposalTarget = docProposal?.target;
    const reviewedMapId = (queueProposalTarget?.mapId ?? docProposalTarget?.mapId ?? null);
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
        reportId: doc?.evidenceId ?? doc?.proposalId ?? 'human-review.missing',
        reportPath: input.path,
        summary: passed
            ? 'pass (human review approved active replacement)'
            : `blocked (${reason})`
    };
}
export function buildRetirementProofGate(target, requestedReplacementMode, input) {
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
function safeValidateRollbackProof(document) {
    if (!document) {
        return { ok: false, issues: ['rollback-proof-missing'] };
    }
    try {
        const result = validateRollbackProof(document);
        return { ok: result.ok, issues: [...result.issues] };
    }
    catch (error) {
        return {
            ok: false,
            issues: [error instanceof Error ? error.message : String(error)]
        };
    }
}
function safeValidateRetirementProof(document) {
    if (!document) {
        return { ok: false, issues: ['retirement-proof-missing'] };
    }
    try {
        const result = validateRetirementProof(document);
        return { ok: result.ok, issues: [...result.issues] };
    }
    catch (error) {
        return {
            ok: false,
            issues: [error instanceof Error ? error.message : String(error)]
        };
    }
}
function safeValidatePropagationReport(document, options) {
    try {
        return validatePropagationReport(document, options);
    }
    catch (error) {
        return {
            ok: false,
            issues: [error instanceof Error ? error.message : String(error)]
        };
    }
}
// ─── String set utilities（used by buildPolymorphImpactGate）──────────────
function sameStringSet(left, right) {
    const leftValues = normalizeStringSet(left);
    const rightValues = normalizeStringSet(right);
    if (leftValues.length !== rightValues.length) {
        return false;
    }
    return leftValues.every((value, index) => value === rightValues[index]);
}
function normalizeStringSet(values) {
    return [...new Set((Array.isArray(values) ? values : [])
            .map((value) => String(value ?? '').trim())
            .filter(Boolean))].sort();
}
