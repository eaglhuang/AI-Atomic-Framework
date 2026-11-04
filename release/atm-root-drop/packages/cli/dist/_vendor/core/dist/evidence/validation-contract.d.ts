import { type ObservedEvidenceSnapshot } from './observed-source.js';
export declare const VALIDATION_CONTRACT_EVALUATION_SCHEMA_ID: "atm.validationContractEvaluation.v1";
export type ValidationRiskTier = 'low' | 'medium' | 'high';
export interface ValidationContractContribution {
    readonly caseId: string;
    readonly coversAcceptance?: readonly string[];
    readonly coversImpactEdges?: readonly string[];
    readonly responsibility?: string | null;
    readonly command?: string | null;
    readonly contractEdge?: string | null;
    readonly dependencyEdge?: string | null;
    readonly phase?: string | null;
}
export interface ValidationContractTask {
    readonly workItemId?: string | null;
    readonly requiredTestCaseIds?: readonly string[];
    readonly phaseTestCaseIds?: readonly string[];
    readonly advisoryTestCaseIds?: readonly string[];
    readonly testContributions?: readonly ValidationContractContribution[];
    readonly causalGraph?: {
        readonly causalImpactEdges?: readonly string[];
    } | null;
    readonly acceptance?: readonly string[];
}
export interface ValidationContractChangeSet {
    readonly changedFiles?: readonly string[];
    readonly declaredImpactEdges?: readonly string[];
    readonly riskTier?: ValidationRiskTier;
}
export interface ValidationContractCatalogCase {
    readonly caseId: string;
    readonly command?: string | null;
    readonly responsibility?: string | null;
    readonly coversAcceptance?: readonly string[];
    readonly coversImpactEdges?: readonly string[];
    readonly pathTriggers?: readonly string[];
    readonly phase?: string | null;
    readonly groupId?: string | null;
    readonly broadSuite?: boolean;
}
export interface ValidationContractCatalog {
    readonly cases: readonly ValidationContractCatalogCase[];
}
export interface ValidationContractEvidenceReceipt {
    readonly caseId: string;
    /**
     * Legacy, caller-declared outcome.  New producers must instead provide an
     * observedOutcome.  When observedOutcome exists this field is deliberately
     * ignored by the freshness evaluator.
     */
    readonly status?: string | null;
    readonly gitHead?: string | null;
    readonly observedAt?: string | null;
    readonly freshUntil?: string | null;
    /**
     * Process fact collected through the observed-evidence port.  This is a
     * deep boundary: the evaluator derives pass/fail from its exitCode and
     * refuses malformed, unavailable, or conflicting observations.
     */
    readonly observedOutcome?: ObservedEvidenceSnapshot | null;
}
export interface ValidationContractEvidence {
    readonly receipts?: readonly ValidationContractEvidenceReceipt[];
    readonly gitHead?: string | null;
    readonly now?: string | null;
    readonly freshnessWindowMs?: number | null;
}
export type ValidationSelectionResponsibility = 'task-required' | 'phase-suite' | 'advisory';
export interface ValidationContractSelection {
    readonly caseId: string;
    readonly responsibility: ValidationSelectionResponsibility;
    readonly command: string | null;
    readonly causalReason: string;
    readonly coversAcceptance: readonly string[];
    readonly coversImpactEdges: readonly string[];
    readonly phase: string | null;
    readonly withinImpactCone: boolean;
    readonly executable: boolean;
}
export interface ValidationContractOmission {
    readonly ref: string;
    readonly kind: 'case' | 'impact-edge' | 'acceptance' | 'changed-path';
    readonly reason: string;
}
export type ValidationFreshnessStatus = 'fresh' | 'missing' | 'stale' | 'failed';
export interface ValidationContractFreshnessInput {
    readonly caseId: string;
    readonly status: ValidationFreshnessStatus;
    readonly reason: string;
    readonly receiptGitHead: string | null;
}
export interface ValidationContractDiagnostic {
    readonly code: string;
    readonly severity: 'error' | 'warning';
    readonly message: string;
    readonly needsClarification: boolean;
    readonly ref: string | null;
}
export interface ValidationContractMetrics {
    readonly catalogCaseCount: number;
    readonly requiredCount: number;
    readonly advisoryCount: number;
    readonly phaseCount: number;
    readonly selectionRatio: number;
    readonly impactConeEdgeCount: number;
    readonly riskTier: ValidationRiskTier;
    readonly unknownBoundaryCount: number;
    readonly omittedCount: number;
}
export interface ValidationContractEvaluation {
    readonly schemaId: typeof VALIDATION_CONTRACT_EVALUATION_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly evaluatorId: 'atm.causal-validator-selector';
    readonly failClosed: boolean;
    readonly required: readonly ValidationContractSelection[];
    readonly advisory: readonly ValidationContractSelection[];
    readonly phaseSuite: readonly ValidationContractSelection[];
    readonly requiredCaseIds: readonly string[];
    readonly advisoryCaseIds: readonly string[];
    readonly phaseCaseIds: readonly string[];
    readonly executableManifests: readonly {
        readonly caseId: string;
        readonly command: string;
        readonly responsibility: ValidationSelectionResponsibility;
    }[];
    readonly causalReasons: readonly {
        readonly caseId: string;
        readonly reason: string;
    }[];
    readonly omissions: readonly ValidationContractOmission[];
    readonly phaseOwners: readonly {
        readonly phase: string;
        readonly caseIds: readonly string[];
    }[];
    readonly freshnessInputs: readonly ValidationContractFreshnessInput[];
    readonly unknownBoundaryDiagnostics: readonly ValidationContractDiagnostic[];
    readonly metrics: ValidationContractMetrics;
}
export declare function evaluateValidationContract(task: ValidationContractTask, changeSet: ValidationContractChangeSet, catalog: ValidationContractCatalog, evidence?: ValidationContractEvidence): ValidationContractEvaluation;
