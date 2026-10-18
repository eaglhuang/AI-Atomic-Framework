import { createHash } from 'node:crypto';
export const CONSTRAINT_SOLVER_SCHEMA_ID = 'atm.constraintSolverResult.v1';
export const CONSTRAINT_SOLVER_INPUT_SCHEMA_ID = 'atm.constraintSolverInput.v1';
/**
 * The single public seam for Plan 4 constraint proofs.  The implementation
 * normalizes once, computes one sealed result, and derives assignments and the
 * semantic quotient from that same normalized authority.
 */
export function solveConstraintModel(input) {
    const normalized = normalizeInput(input);
    const diagnostics = [];
    if (!normalized.solverId)
        diagnostics.push(error('ATM_CONSTRAINT_SOLVER_ID_MISSING', 'solverId is required.', 'solverId'));
    if (!normalized.authority.authorityId || !normalized.authority.digest) {
        diagnostics.push(error('ATM_CONSTRAINT_SOLVER_AUTHORITY_INCOMPLETE', 'A sealed authority id and digest are required.', 'authority', 'node atm.mjs evidence verify --json'));
    }
    if (normalized.authority.sealed !== true) {
        diagnostics.push(error('ATM_CONSTRAINT_SOLVER_AUTHORITY_UNSEALED', 'Constraint proofs require a sealed input authority.', 'authority.sealed', 'seal the input authority before solving'));
    }
    if (normalized.constraints.length === 0) {
        diagnostics.push(error('ATM_CONSTRAINT_SOLVER_INPUT_INCOMPLETE', 'At least one constraint is required.', 'constraints', 'restore the deterministic fixture constraints'));
    }
    for (const constraint of normalized.constraints) {
        if (!SUPPORTED_OPERATORS.has(constraint.operator)) {
            diagnostics.push(error('ATM_CONSTRAINT_SOLVER_OPERATOR_UNSUPPORTED', `Unsupported operator: ${constraint.operator}.`, constraint.constraintId, 'replace the operator with eq, neq, in, not-in, min, or max'));
        }
    }
    const byVariable = groupByVariable(normalized.constraints);
    const assignments = [];
    const quotient = [];
    for (const [variable, constraints] of byVariable) {
        const analysis = analyzeVariable(variable, constraints);
        assignments.push(analysis.assignment);
        diagnostics.push(...analysis.diagnostics);
        quotient.push(...buildSemanticClasses(constraints));
    }
    const status = diagnostics.some((entry) => entry.severity === 'error')
        ? diagnostics.some((entry) => entry.code.includes('CONTRADICTORY')) ? 'infeasible'
            : diagnostics.some((entry) => entry.code.includes('STALE')) ? 'stale' : 'blocked'
        : 'satisfiable';
    const inputDigest = digest({ solverId: normalized.solverId, authority: normalized.authority, constraints: normalized.constraints, assumptions: normalized.assumptions });
    const resultId = `constraint_result_${inputDigest.slice(7, 23)}`;
    return {
        schemaId: CONSTRAINT_SOLVER_SCHEMA_ID,
        specVersion: '0.1.0',
        solverId: normalized.solverId,
        resultId,
        authority: normalized.authority,
        status,
        assignments: assignments.sort((a, b) => a.variable.localeCompare(b.variable)),
        semanticQuotient: quotient.sort((a, b) => a.classId.localeCompare(b.classId)),
        diagnostics,
        provenance: {
            inputDigest,
            constraintCount: normalized.constraints.length,
            assumptionIds: normalized.assumptions ?? []
        }
    };
}
export const solveConstraints = solveConstraintModel;
export const createConstraintSolverResult = solveConstraintModel;
export function validateConstraintSolverResult(result) {
    const diagnostics = [];
    if (result.schemaId !== CONSTRAINT_SOLVER_SCHEMA_ID)
        diagnostics.push(error('ATM_CONSTRAINT_SOLVER_SCHEMA_INVALID', 'Unexpected constraint solver schema id.', 'schemaId'));
    if (!result.resultId || !/^constraint_result_[0-9a-f]{16}$/.test(result.resultId))
        diagnostics.push(error('ATM_CONSTRAINT_SOLVER_RESULT_ID_INVALID', 'resultId must be derived from the input digest.', 'resultId'));
    if (!/^sha256:[0-9a-f]{64}$/.test(result.provenance.inputDigest))
        diagnostics.push(error('ATM_CONSTRAINT_SOLVER_DIGEST_INVALID', 'provenance.inputDigest must be a sha256 digest.', 'provenance.inputDigest'));
    if (result.status === 'satisfiable' && result.diagnostics.some((entry) => entry.severity === 'error'))
        diagnostics.push(error('ATM_CONSTRAINT_SOLVER_FALSE_GREEN', 'A satisfiable result cannot contain error diagnostics.', 'status'));
    return { ok: diagnostics.length === 0, diagnostics };
}
export function replayConstraintSolverResult(input, expected) {
    const result = solveConstraintModel(input);
    return { deterministic: stableJson(result) === stableJson(expected), result };
}
function normalizeInput(input) {
    return {
        solverId: text(input?.solverId),
        authority: {
            authorityId: text(input?.authority?.authorityId),
            sealed: input?.authority?.sealed === true,
            digest: text(input?.authority?.digest),
            version: input?.authority?.version == null ? null : text(input.authority.version)
        },
        constraints: [...(input?.constraints ?? [])].map((entry) => ({
            constraintId: text(entry.constraintId), variable: text(entry.variable), operator: text(entry.operator).toLowerCase(),
            value: Array.isArray(entry.value) ? [...entry.value] : entry.value, sourceRef: entry.sourceRef == null ? null : text(entry.sourceRef)
        })).sort((a, b) => a.constraintId.localeCompare(b.constraintId)),
        assumptions: [...(input?.assumptions ?? [])].map(text).filter(Boolean).sort(),
        requestedAt: input?.requestedAt == null ? null : text(input.requestedAt)
    };
}
function analyzeVariable(variable, constraints) {
    const diagnostics = [];
    const equals = constraints.filter((c) => c.operator === 'eq');
    const mins = constraints.filter((c) => c.operator === 'min' && typeof c.value === 'number');
    const maxes = constraints.filter((c) => c.operator === 'max' && typeof c.value === 'number');
    if (equals.length > 1 && new Set(equals.map((c) => stableJson(c.value))).size > 1) {
        diagnostics.push(error('ATM_CONSTRAINT_SOLVER_CONTRADICTORY_INPUT', `Variable ${variable} has conflicting exact values.`, variable));
        return { assignment: { variable, kind: 'unresolved', value: null }, diagnostics };
    }
    const min = mins.length ? Math.max(...mins.map((c) => c.value)) : null;
    const max = maxes.length ? Math.min(...maxes.map((c) => c.value)) : null;
    if (min !== null && max !== null && min > max) {
        diagnostics.push(error('ATM_CONSTRAINT_SOLVER_CONTRADICTORY_INPUT', `Variable ${variable} has an empty numeric interval.`, variable));
        return { assignment: { variable, kind: 'unresolved', value: null }, diagnostics };
    }
    if (equals.length)
        return { assignment: { variable, kind: 'exact', value: equals[0].value }, diagnostics };
    if (min !== null || max !== null)
        return { assignment: { variable, kind: 'interval', value: [min ?? Number.NEGATIVE_INFINITY, max ?? Number.POSITIVE_INFINITY] }, diagnostics };
    const members = constraints.filter((c) => c.operator === 'in' || c.operator === 'not-in').flatMap((c) => Array.isArray(c.value) ? c.value : [c.value]);
    return { assignment: { variable, kind: members.length ? 'set' : 'unresolved', value: members.length ? members : null }, diagnostics };
}
function buildSemanticClasses(constraints) {
    const bySignature = new Map();
    for (const constraint of constraints) {
        const signature = `${constraint.variable}|${constraint.operator}|${stableJson(constraint.value)}`;
        const ids = bySignature.get(signature) ?? [];
        ids.push(constraint.constraintId);
        bySignature.set(signature, ids);
    }
    return [...bySignature].map(([signature, ids]) => ({ classId: `quotient_${digest(signature).slice(7, 23)}`, memberConstraintIds: ids.sort(), signature }));
}
function groupByVariable(values) {
    const groups = new Map();
    for (const value of values)
        groups.set(value.variable, [...(groups.get(value.variable) ?? []), value]);
    return groups;
}
function digest(value) { return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`; }
function stableJson(value) { return JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry); }
function text(value) { return String(value ?? '').trim(); }
function error(code, message, ref, repairCommand = null) { return { code, severity: 'error', message, ref, repairCommand }; }
const SUPPORTED_OPERATORS = new Set(['eq', 'neq', 'in', 'not-in', 'min', 'max']);
