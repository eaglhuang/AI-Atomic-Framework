export declare const CONSTRAINT_SOLVER_SCHEMA_ID: "atm.constraintSolverResult.v1";
export declare const CONSTRAINT_SOLVER_INPUT_SCHEMA_ID: "atm.constraintSolverInput.v1";
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
export declare function solveConstraintModel(input: ConstraintSolverInput): ConstraintSolverResult;
export declare const solveConstraints: typeof solveConstraintModel;
export declare const createConstraintSolverResult: typeof solveConstraintModel;
export declare function validateConstraintSolverResult(result: ConstraintSolverResult): {
    readonly ok: boolean;
    readonly diagnostics: readonly ConstraintDiagnostic[];
};
export declare function replayConstraintSolverResult(input: ConstraintSolverInput, expected: ConstraintSolverResult): {
    readonly deterministic: boolean;
    readonly result: ConstraintSolverResult;
};
