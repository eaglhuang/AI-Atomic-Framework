import { createHash } from 'node:crypto';

export const CONSTRAINT_SOLVER_SCHEMA_ID = 'atm.constraintSolverResult.v1' as const;
export const CONSTRAINT_SOLVER_INPUT_SCHEMA_ID = 'atm.constraintSolverInput.v1' as const;

export type ConstraintOperator = 'eq' | 'neq' | 'in' | 'not-in' | 'min' | 'max';
export type ConstraintStatus = 'satisfiable' | 'infeasible' | 'blocked' | 'unsupported' | 'stale';

export interface ConstraintAuthority {
  readonly authorityId: string;
  readonly sealed: boolean;
  readonly digest: string;
  readonly version?: string | null;
}

export interface ConstraintInput {
  readonly constraintId: string;
  readonly variable: string;
  readonly operator: ConstraintOperator | string;
  readonly value: string | number | boolean | readonly (string | number | boolean)[];
  readonly sourceRef?: string | null;
}

export interface ConstraintSolverInput {
  readonly solverId: string;
  readonly authority: ConstraintAuthority;
  readonly constraints: readonly ConstraintInput[];
  readonly assumptions?: readonly string[];
  readonly requestedAt?: string | null;
}

export interface ConstraintDiagnostic {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly ref: string | null;
  readonly repairCommand: string | null;
}

export interface ConstraintAssignment {
  readonly variable: string;
  readonly kind: 'exact' | 'set' | 'interval' | 'unresolved';
  readonly value: string | number | boolean | readonly (string | number | boolean)[] | null;
}

export interface ConstraintSemanticClass {
  readonly classId: string;
  readonly memberConstraintIds: readonly string[];
  readonly signature: string;
}

export interface ConstraintSolverResult {
  readonly schemaId: typeof CONSTRAINT_SOLVER_SCHEMA_ID;
  readonly specVersion: '0.1.0';
  readonly solverId: string;
  readonly resultId: string;
  readonly authority: ConstraintAuthority;
  readonly status: ConstraintStatus;
  readonly assignments: readonly ConstraintAssignment[];
  readonly semanticQuotient: readonly ConstraintSemanticClass[];
  readonly diagnostics: readonly ConstraintDiagnostic[];
  readonly provenance: {
    readonly inputDigest: string;
    readonly constraintCount: number;
    readonly assumptionIds: readonly string[];
  };
}

/**
 * The single public seam for Plan 4 constraint proofs.  The implementation
 * normalizes once, computes one sealed result, and derives assignments and the
 * semantic quotient from that same normalized authority.
 */
export function solveConstraintModel(input: ConstraintSolverInput): ConstraintSolverResult {
  const normalized = normalizeInput(input);
  const diagnostics: ConstraintDiagnostic[] = [];
  if (!normalized.solverId) diagnostics.push(error('ATM_CONSTRAINT_SOLVER_ID_MISSING', 'solverId is required.', 'solverId'));
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
    if (!SUPPORTED_OPERATORS.has(constraint.operator as ConstraintOperator)) {
      diagnostics.push(error('ATM_CONSTRAINT_SOLVER_OPERATOR_UNSUPPORTED', `Unsupported operator: ${constraint.operator}.`, constraint.constraintId, 'replace the operator with eq, neq, in, not-in, min, or max'));
    }
  }

  const byVariable = groupByVariable(normalized.constraints);
  const assignments: ConstraintAssignment[] = [];
  const quotient: ConstraintSemanticClass[] = [];
  for (const [variable, constraints] of byVariable) {
    const analysis = analyzeVariable(variable, constraints);
    assignments.push(analysis.assignment);
    diagnostics.push(...analysis.diagnostics);
    quotient.push(...buildSemanticClasses(constraints));
  }
  const status: ConstraintStatus = diagnostics.some((entry) => entry.severity === 'error')
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

export function validateConstraintSolverResult(result: ConstraintSolverResult): { readonly ok: boolean; readonly diagnostics: readonly ConstraintDiagnostic[] } {
  const diagnostics: ConstraintDiagnostic[] = [];
  if (result.schemaId !== CONSTRAINT_SOLVER_SCHEMA_ID) diagnostics.push(error('ATM_CONSTRAINT_SOLVER_SCHEMA_INVALID', 'Unexpected constraint solver schema id.', 'schemaId'));
  if (!result.resultId || !/^constraint_result_[0-9a-f]{16}$/.test(result.resultId)) diagnostics.push(error('ATM_CONSTRAINT_SOLVER_RESULT_ID_INVALID', 'resultId must be derived from the input digest.', 'resultId'));
  if (!/^sha256:[0-9a-f]{64}$/.test(result.provenance.inputDigest)) diagnostics.push(error('ATM_CONSTRAINT_SOLVER_DIGEST_INVALID', 'provenance.inputDigest must be a sha256 digest.', 'provenance.inputDigest'));
  if (result.status === 'satisfiable' && result.diagnostics.some((entry) => entry.severity === 'error')) diagnostics.push(error('ATM_CONSTRAINT_SOLVER_FALSE_GREEN', 'A satisfiable result cannot contain error diagnostics.', 'status'));
  return { ok: diagnostics.length === 0, diagnostics };
}

export function replayConstraintSolverResult(input: ConstraintSolverInput, expected: ConstraintSolverResult): { readonly deterministic: boolean; readonly result: ConstraintSolverResult } {
  const result = solveConstraintModel(input);
  return { deterministic: stableJson(result) === stableJson(expected), result };
}

function normalizeInput(input: ConstraintSolverInput): ConstraintSolverInput {
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

function analyzeVariable(variable: string, constraints: readonly ConstraintInput[]): { assignment: ConstraintAssignment; diagnostics: ConstraintDiagnostic[] } {
  const diagnostics: ConstraintDiagnostic[] = [];
  const equals = constraints.filter((c) => c.operator === 'eq');
  const mins = constraints.filter((c) => c.operator === 'min' && typeof c.value === 'number');
  const maxes = constraints.filter((c) => c.operator === 'max' && typeof c.value === 'number');
  if (equals.length > 1 && new Set(equals.map((c) => stableJson(c.value))).size > 1) {
    diagnostics.push(error('ATM_CONSTRAINT_SOLVER_CONTRADICTORY_INPUT', `Variable ${variable} has conflicting exact values.`, variable));
    return { assignment: { variable, kind: 'unresolved', value: null }, diagnostics };
  }
  const min = mins.length ? Math.max(...mins.map((c) => c.value as number)) : null;
  const max = maxes.length ? Math.min(...maxes.map((c) => c.value as number)) : null;
  if (min !== null && max !== null && min > max) {
    diagnostics.push(error('ATM_CONSTRAINT_SOLVER_CONTRADICTORY_INPUT', `Variable ${variable} has an empty numeric interval.`, variable));
    return { assignment: { variable, kind: 'unresolved', value: null }, diagnostics };
  }
  if (equals.length) return { assignment: { variable, kind: 'exact', value: equals[0].value }, diagnostics };
  if (min !== null || max !== null) return { assignment: { variable, kind: 'interval', value: [min ?? Number.NEGATIVE_INFINITY, max ?? Number.POSITIVE_INFINITY] }, diagnostics };
  const members = constraints.filter((c) => c.operator === 'in' || c.operator === 'not-in').flatMap((c) => Array.isArray(c.value) ? c.value : [c.value]);
  return { assignment: { variable, kind: members.length ? 'set' : 'unresolved', value: members.length ? members : null }, diagnostics };
}

function buildSemanticClasses(constraints: readonly ConstraintInput[]): ConstraintSemanticClass[] {
  const bySignature = new Map<string, string[]>();
  for (const constraint of constraints) {
    const signature = `${constraint.variable}|${constraint.operator}|${stableJson(constraint.value)}`;
    const ids = bySignature.get(signature) ?? [];
    ids.push(constraint.constraintId);
    bySignature.set(signature, ids);
  }
  return [...bySignature].map(([signature, ids]) => ({ classId: `quotient_${digest(signature).slice(7, 23)}`, memberConstraintIds: ids.sort(), signature }));
}

function groupByVariable(values: readonly ConstraintInput[]): Map<string, ConstraintInput[]> {
  const groups = new Map<string, ConstraintInput[]>();
  for (const value of values) groups.set(value.variable, [...(groups.get(value.variable) ?? []), value]);
  return groups;
}

function digest(value: unknown): string { return `sha256:${createHash('sha256').update(stableJson(value)).digest('hex')}`; }
function stableJson(value: unknown): string { return JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry) ? Object.fromEntries(Object.entries(entry as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))) : entry); }
function text(value: unknown): string { return String(value ?? '').trim(); }
function error(code: string, message: string, ref: string | null, repairCommand: string | null = null): ConstraintDiagnostic { return { code, severity: 'error', message, ref, repairCommand }; }
const SUPPORTED_OPERATORS = new Set<ConstraintOperator>(['eq', 'neq', 'in', 'not-in', 'min', 'max']);
