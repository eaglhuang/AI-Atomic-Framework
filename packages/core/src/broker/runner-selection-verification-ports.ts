import type { RunnerRegistrySnapshot } from './runner-registry-snapshot.ts';
import type { RunnerVersionRequirement, RunnerVersionSelectionReceipt } from './runner-version-contract.ts';

export type RunnerSelectionQualificationVerdict =
  | 'qualified'
  | 'unqualified'
  | 'pending-contract'
  | 'revalidation-required';

export interface RunnerSelectionVerificationCase {
  readonly caseId: string;
  readonly description: string;
  readonly receipt: RunnerVersionSelectionReceipt;
  readonly sealedRegistrySnapshot: RunnerRegistrySnapshot;
  readonly currentRegistrySnapshot?: RunnerRegistrySnapshot | null;
  readonly currentRequirement?: RunnerVersionRequirement | null;
  readonly expectedVerdict?: RunnerSelectionQualificationVerdict;
  readonly coverageTags?: readonly string[];
}

export interface RunnerSelectionVerificationPorts {
  readCases(): readonly RunnerSelectionVerificationCase[];
}

export interface RunnerSelectionQualificationFinding {
  readonly code:
    | 'missing-contract-field'
    | 'selection-mismatch'
    | 'counterfactual-mismatch'
    | 'revalidation-boundary-expired'
    | 'qualification-gate-failed'
    | 'historical-snapshot-invalid';
  readonly message: string;
  readonly field?: string;
}

export interface RunnerSelectionQualificationCaseResult {
  readonly caseId: string;
  readonly verdict: RunnerSelectionQualificationVerdict;
  readonly expectedVerdict: RunnerSelectionQualificationVerdict | null;
  readonly selectedRunner: string | null;
  readonly selectionOutcome: string | null;
  readonly selectionAgeMs: number | null;
  readonly latestVersionGap: number;
  readonly coverageTags: readonly string[];
  readonly findings: readonly RunnerSelectionQualificationFinding[];
}

export interface RunnerSelectionQualificationReport {
  readonly schemaId: 'atm.runnerSelectionQualificationReport.v1';
  readonly specVersion: '0.1.0';
  readonly generatedAt: string;
  readonly policyVersion: string;
  readonly caseCount: number;
  readonly verdictCounts: Record<RunnerSelectionQualificationVerdict, number>;
  readonly metrics: {
    readonly selectionAgeMs: {
      readonly min: number | null;
      readonly max: number | null;
      readonly average: number | null;
    };
    readonly latestVersionGapMax: number;
    readonly revalidationRate: number;
    readonly fallbackRate: number;
    readonly falseRejectRate: number;
    readonly falseCompatibleRate: number;
    readonly perCapabilityCoverage: Readonly<Record<string, number>>;
    readonly pendingContractFieldGapCounts: Readonly<Record<string, number>>;
  };
  readonly promotionPreconditions: {
    readonly sealedIndependentReport: boolean;
    readonly zeroFalseCompatible: boolean;
    readonly explicitCounterfactualCoverage: boolean;
    readonly zeroPendingContract: boolean;
    readonly ownerApprovedPromotionRecord: boolean;
    readonly promotionAllowed: boolean;
  };
  readonly results: readonly RunnerSelectionQualificationCaseResult[];
}
