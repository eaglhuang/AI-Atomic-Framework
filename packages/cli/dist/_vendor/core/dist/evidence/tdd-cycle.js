import { createHash } from 'node:crypto';
export const TDD_CYCLE_RECEIPT_SCHEMA_ID = 'atm.tddCycleReceipt.v1';
export const TDD_LIFECYCLE_BINDING_SCHEMA_ID = 'atm.tddLifecycleBinding.v1';
export const TDD_SUCCESS_RATE_SCHEMA_ID = 'atm.tddSuccessRate.v1';
export const TDD_MODES = ['required', 'recommended', 'reasoned-not-applicable'];
export const TDD_PHASES = ['red', 'green'];
export const TDD_FAILURE_CLASSES = [
    'assertion-failure',
    'syntax',
    'setup',
    'environment',
    'unrelated',
    'digest-mismatch',
    'case-mismatch'
];
export const TDD_EXEMPTION_KINDS = ['mechanical', 'docs', 'advisory', 'quarantined'];
const NON_RED_FAILURE_CLASSES = new Set([
    'syntax',
    'setup',
    'environment',
    'unrelated',
    'digest-mismatch',
    'case-mismatch'
]);
export function isTddMode(value) {
    return typeof value === 'string' && TDD_MODES.includes(value);
}
export function parseTddMode(raw) {
    if (typeof raw !== 'string')
        return null;
    const normalized = raw.trim().toLowerCase().replace(/_/g, '-');
    if (normalized === 'required' || normalized === 'recommended')
        return normalized;
    if (normalized === 'reasoned-not-applicable'
        || normalized === 'reasoned-notapplicable'
        || normalized === 'not-applicable'
        || normalized === 'n/a') {
        return 'reasoned-not-applicable';
    }
    return null;
}
export function bindingDigest(binding) {
    return sha256Json({
        caseId: binding.caseId,
        testDigest: binding.testDigest,
        acceptanceIds: [...binding.acceptanceIds].map((entry) => entry.trim()).filter(Boolean).sort(),
        publicSeam: binding.publicSeam,
        baselineSha: binding.baselineSha
    });
}
/**
 * Classify a failed observation. Explicit failureClass wins; otherwise infer
 * from failureReason / exit semantics. Only assertion-failure may count as red.
 */
export function classifyTddFailure(input) {
    if (input.expectedCaseId && input.observedCaseId && input.expectedCaseId !== input.observedCaseId) {
        return 'case-mismatch';
    }
    if (input.expectedTestDigest
        && input.observedTestDigest
        && input.expectedTestDigest !== input.observedTestDigest) {
        return 'digest-mismatch';
    }
    if (input.failureClass && TDD_FAILURE_CLASSES.includes(input.failureClass)) {
        return input.failureClass;
    }
    const reason = String(input.failureReason ?? '').toLowerCase();
    if (/syntax|parseerror|unexpected token|ts\d{4}/.test(reason))
        return 'syntax';
    if (/setup|fixture|beforeall|beforeeach|missing dependency|cannot find module/.test(reason)) {
        return 'setup';
    }
    if (/environment|enoent|eacces|permission|network|timed?\s*out|spawn/.test(reason)) {
        return 'environment';
    }
    if (/unrelated|wrong suite|different case|out of scope/.test(reason))
        return 'unrelated';
    if (input.commandOk || input.exitCode === 0)
        return 'unrelated';
    return 'assertion-failure';
}
export function evaluateTddPhaseReceipt(observation) {
    const reasons = [];
    const binding = normalizeBinding(observation.binding);
    if (!binding.caseId)
        reasons.push('missing-case-id');
    if (!binding.testDigest)
        reasons.push('missing-test-digest');
    if (!binding.publicSeam)
        reasons.push('missing-public-seam');
    if (!binding.baselineSha)
        reasons.push('missing-baseline-sha');
    if (binding.acceptanceIds.length === 0)
        reasons.push('missing-acceptance-ids');
    if (observation.executedCaseCount <= 0)
        reasons.push('zero-executed-cases');
    if (observation.assertionCount <= 0)
        reasons.push('zero-assertions');
    if (observation.advisory === true)
        reasons.push('advisory-excluded');
    if (observation.quarantineStatus && observation.quarantineStatus !== 'active') {
        reasons.push(`quarantined:${observation.quarantineStatus}`);
    }
    const failureClass = observation.phase === 'red'
        ? classifyTddFailure({
            exitCode: observation.exitCode,
            commandOk: observation.commandOk,
            failureClass: observation.failureClass,
            failureReason: observation.failureReason
        })
        : (observation.failureClass ?? null);
    let countsAsRed = false;
    let countsAsGreen = false;
    if (observation.phase === 'red') {
        if (observation.commandOk || observation.exitCode === 0) {
            reasons.push('red-requires-failing-command');
        }
        if (failureClass && NON_RED_FAILURE_CLASSES.has(failureClass)) {
            reasons.push(`invalid-red-failure-class:${failureClass}`);
        }
        if (binding.candidateSha) {
            reasons.push('red-must-bind-baseline-without-candidate');
        }
        countsAsRed = reasons.length === 0 && failureClass === 'assertion-failure';
    }
    else {
        if (!observation.commandOk || observation.exitCode !== 0) {
            reasons.push('green-requires-passing-command');
        }
        if (!binding.candidateSha) {
            reasons.push('green-requires-candidate-sha');
        }
        else if (binding.candidateSha === binding.baselineSha) {
            reasons.push('green-candidate-must-differ-from-baseline');
        }
        countsAsGreen = reasons.length === 0;
    }
    return {
        schemaId: TDD_CYCLE_RECEIPT_SCHEMA_ID,
        phase: observation.phase,
        binding,
        valid: observation.phase === 'red' ? countsAsRed : countsAsGreen,
        countsAsRed,
        countsAsGreen,
        failureClass: failureClass ?? null,
        reasons,
        bindingDigest: bindingDigest(binding)
    };
}
export function bindRedGreenLifecycle(input) {
    const red = evaluateTddPhaseReceipt({ ...input.red, phase: 'red' });
    const green = evaluateTddPhaseReceipt({ ...input.green, phase: 'green' });
    const reasons = [];
    if (red.binding.caseId !== green.binding.caseId)
        reasons.push('case-id-mismatch');
    if (red.binding.testDigest !== green.binding.testDigest)
        reasons.push('test-digest-mismatch');
    if (red.binding.publicSeam !== green.binding.publicSeam)
        reasons.push('public-seam-mismatch');
    if (red.binding.baselineSha !== green.binding.baselineSha)
        reasons.push('baseline-lineage-mismatch');
    if (!sameStringSet(red.binding.acceptanceIds, green.binding.acceptanceIds)) {
        reasons.push('acceptance-mismatch');
    }
    if (red.bindingDigest !== green.bindingDigest)
        reasons.push('binding-digest-mismatch');
    if (!red.valid)
        reasons.push('red-receipt-invalid');
    if (!green.valid)
        reasons.push('green-receipt-invalid');
    if (!green.binding.candidateSha)
        reasons.push('missing-candidate-lineage');
    return {
        schemaId: TDD_LIFECYCLE_BINDING_SCHEMA_ID,
        ok: reasons.length === 0,
        caseId: red.binding.caseId,
        testDigest: red.binding.testDigest,
        acceptanceIds: red.binding.acceptanceIds,
        publicSeam: red.binding.publicSeam,
        baselineSha: red.binding.baselineSha,
        candidateSha: green.binding.candidateSha ?? '',
        red,
        green,
        reasons
    };
}
/**
 * One task may prove multiple integration case IDs. Exemptions that are
 * mechanical/docs/advisory/quarantined are excluded from success-rate inflation.
 */
export function evaluateTddSuccessRate(outcomes) {
    const excludedCaseIds = [];
    const eligibleCaseIds = [];
    const successCaseIds = [];
    for (const outcome of outcomes) {
        if (isExcludedFromTddSuccessRate(outcome)) {
            excludedCaseIds.push(outcome.caseId);
            continue;
        }
        eligibleCaseIds.push(outcome.caseId);
        if (outcome.lifecycleComplete)
            successCaseIds.push(outcome.caseId);
    }
    const eligibleCount = eligibleCaseIds.length;
    const successCount = successCaseIds.length;
    return {
        schemaId: TDD_SUCCESS_RATE_SCHEMA_ID,
        eligibleCount,
        successCount,
        excludedCount: excludedCaseIds.length,
        rate: eligibleCount === 0 ? null : successCount / eligibleCount,
        excludedCaseIds,
        eligibleCaseIds,
        successCaseIds
    };
}
export function isExcludedFromTddSuccessRate(outcome) {
    if (outcome.advisory === true)
        return true;
    if (outcome.quarantineStatus && outcome.quarantineStatus !== 'active')
        return true;
    const kind = outcome.exemption?.kind;
    if (!kind)
        return false;
    if (kind === 'mechanical' || kind === 'docs' || kind === 'advisory' || kind === 'quarantined') {
        return true;
    }
    return false;
}
export function evaluateTaskTddLifecycle(input) {
    const reasons = [];
    if (input.tddMode === 'reasoned-not-applicable') {
        if (!String(input.notApplicableReason ?? '').trim()) {
            reasons.push('reasoned-not-applicable-requires-reason');
        }
        return {
            ok: reasons.length === 0,
            tddMode: input.tddMode,
            bindings: [],
            successRate: evaluateTddSuccessRate([]),
            reasons
        };
    }
    const bindings = input.pairs.map((pair) => bindRedGreenLifecycle(pair));
    const exemptionByCase = new Map((input.exemptions ?? []).map((entry) => [entry.caseId, entry]));
    const outcomes = bindings.map((binding) => ({
        caseId: binding.caseId,
        lifecycleComplete: binding.ok,
        exemption: exemptionByCase.get(binding.caseId) ?? null
    }));
    const successRate = evaluateTddSuccessRate(outcomes);
    if (input.tddMode === 'required') {
        if (bindings.length === 0)
            reasons.push('required-tdd-mode-needs-case-bindings');
        if (bindings.some((entry) => !entry.ok))
            reasons.push('required-tdd-binding-incomplete');
    }
    return {
        ok: reasons.length === 0 && (input.tddMode === 'recommended' || bindings.every((entry) => entry.ok)),
        tddMode: input.tddMode,
        bindings,
        successRate,
        reasons
    };
}
function normalizeBinding(binding) {
    return {
        caseId: String(binding.caseId ?? '').trim(),
        testDigest: String(binding.testDigest ?? '').trim(),
        acceptanceIds: [...new Set((binding.acceptanceIds ?? []).map((entry) => String(entry).trim()).filter(Boolean))],
        publicSeam: String(binding.publicSeam ?? '').trim(),
        baselineSha: String(binding.baselineSha ?? '').trim(),
        candidateSha: binding.candidateSha == null ? null : String(binding.candidateSha).trim() || null
    };
}
function sameStringSet(left, right) {
    const a = [...new Set(left.map((entry) => entry.trim()).filter(Boolean))].sort();
    const b = [...new Set(right.map((entry) => entry.trim()).filter(Boolean))].sort();
    if (a.length !== b.length)
        return false;
    return a.every((value, index) => value === b[index]);
}
function sha256Json(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
