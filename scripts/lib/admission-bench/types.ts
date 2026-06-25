import type {
  AgrBenchmarkMode,
  AgrBenchmarkScenario,
  ComposeVerdict,
  RegistryVerdict
} from '../agr-benchmark-runner.ts';
import type {
  AgrConflictScenario,
  ConflictArbitrationVerdict
} from '../agr-conflict-benchmark-runner.ts';

export type PolicyId =
  | 'direct'
  | 'git-diff3'
  | 'file-serial'
  | 'file-occ'
  | 'text-range'
  | 'atm-full';

export type AblationId =
  | 'no-cid'
  | 'no-shared-surface'
  | 'no-rw-dependency'
  | 'no-virtual-atom'
  | 'no-conflict-key'
  | 'no-cas'
  | 'no-fallback-lock';

export type AdversarialFaultId =
  | 'dropped-read-set'
  | 'dropped-write-surface'
  | 'wrong-conflict-key'
  | 'shrunk-range'
  | 'all-conflict-dos';

export type RouteVerdict =
  | 'admit-parallel'
  | 'merge-with-tool'
  | 'serial'
  | 'block';

export type CaughtPhase =
  | 'admission'
  | 'apply'
  | 'validator'
  | 'silent-miss'
  | 'not-applicable';

export type ScenarioFamily =
  | 'compose-disjoint'
  | 'cid-conflict'
  | 'shared-surface'
  | 'rw-dependency'
  | 'conflict-key'
  | 'cas'
  | 'fallback-lock'
  | 'orphan-lock'
  | 'manual-override'
  | 'capsule-drift'
  | 'physical-overlap'
  | 'unknown';

export type ScenarioPack = 'agr-benchmark' | 'agr-conflict-benchmark';

export interface NormalizedScenario {
  readonly id: string;
  readonly pack: ScenarioPack;
  readonly family: ScenarioFamily;
  readonly mode: string;
  readonly groundTruth: { readonly safeToParallelize: boolean; readonly validatorShouldCatch: boolean };
  readonly hasReliableOracle: boolean;
  readonly oracleVerdict: RouteVerdict;
  readonly agrScenario?: AgrBenchmarkScenario;
  readonly conflictScenario?: AgrConflictScenario;
  readonly composeVerdict?: ComposeVerdict;
  readonly brokerVerdict?: RegistryVerdict;
  readonly conflictVerdict?: ConflictArbitrationVerdict;
}

export interface PolicyRow {
  readonly schemaId: 'atm.admissionBenchPolicyRow.v1';
  readonly policy: PolicyId;
  readonly scenarioId: string;
  readonly pack: ScenarioPack;
  readonly family: ScenarioFamily;
  readonly mode: string;
  readonly route: RouteVerdict;
  readonly admitted: boolean;
  readonly caughtPhase: CaughtPhase;
  readonly falseSafe: boolean;
  readonly overSerialized: boolean;
  readonly intentPreserved: boolean;
  readonly oracleVerdict: RouteVerdict;
  readonly routeMatchedOracle: boolean;
}

export interface PolicyAggregate {
  readonly schemaId: 'atm.admissionBenchPolicyAggregate.v1';
  readonly policy: PolicyId;
  readonly scenarios: number;
  readonly falseSafe: number;
  readonly overSerialization: number;
  readonly routeF1: number;
  readonly intentPreservation: number;
  readonly p95LatencyNs: 'not-measured';
}

export interface AblationRow {
  readonly schemaId: 'atm.admissionBenchAblationRow.v1';
  readonly variant: AblationId;
  readonly scenarioId: string;
  readonly pack: ScenarioPack;
  readonly family: ScenarioFamily;
  readonly mode: string;
  readonly baselineRoute: RouteVerdict;
  readonly ablatedRoute: RouteVerdict;
  readonly baselineFalseSafe: boolean;
  readonly ablatedFalseSafe: boolean;
  readonly baselineOverSerialized: boolean;
  readonly ablatedOverSerialized: boolean;
  readonly baselineE2ESuccess: boolean;
  readonly ablatedE2ESuccess: boolean;
}

export interface AblationAggregate {
  readonly schemaId: 'atm.admissionBenchAblationAggregate.v1';
  readonly variant: AblationId;
  readonly deltaFalseSafe: number;
  readonly deltaOverSerialization: number;
  readonly deltaE2ESuccess: number;
  readonly mainAffectedFamilies: readonly ScenarioFamily[];
}

export interface AdversarialRow {
  readonly schemaId: 'atm.admissionBenchAdversarialRow.v1';
  readonly fault: AdversarialFaultId;
  readonly scenarioId: string;
  readonly pack: ScenarioPack;
  readonly family: ScenarioFamily;
  readonly mode: string;
  readonly atmFullCaughtBaseline: boolean;
  readonly atmFullCaughtUnderFault: boolean;
  readonly faultClassifiedAs: 'enforcement-held' | 'silent-miss' | 'over-conservative' | 'oracle-degraded';
}

export interface EnforcementRow {
  readonly schemaId: 'atm.admissionBenchEnforcementRow.v1';
  readonly condition: 'unsafe-input' | 'safe-input' | 'mixed' | 'adversarial-input';
  readonly admissionCaught: number;
  readonly applyCaught: number;
  readonly validatorCaught: number;
  readonly silentMiss: number;
  readonly total: number;
}

export interface ForwardingSummary {
  readonly schemaId: 'atm.admissionBenchForwardingSummary.v1';
  readonly admissionForwardedCount: number;
  readonly forwardedToApply: number;
  readonly forwardedToValidator: number;
  readonly forwardedToHuman: number;
  readonly notForwarded: number;
  readonly fieldEvidenceMixedIntoBaseline: false;
  readonly fieldEvidenceSourcePath: string | 'not-applicable';
}

export interface UnresolvedEntry {
  readonly scenarioId: string;
  readonly pack: ScenarioPack;
  readonly mode: string;
  readonly reason: string;
}

export interface PaperProfileSummary {
  readonly schemaId: 'atm.admissionBenchPaperSummary.v1';
  readonly seed: number;
  readonly profile: 'paper';
  readonly contractVersion: '0.2';
  readonly track: 'all' | 'policy' | 'ablation' | 'adversarial' | 'forwarding' | 'field' | 'report';
  readonly scenarioCount: number;
  readonly modeComparisons: number;
  readonly unresolvedCount: number;
  readonly policyRows: number;
  readonly ablationRows: number;
  readonly adversarialRows: number;
  readonly enforcementRows: number;
  readonly policyAggregates: readonly PolicyAggregate[];
  readonly ablationAggregates: readonly AblationAggregate[];
  readonly enforcementAggregates: readonly EnforcementRow[];
  readonly forwarding: ForwardingSummary;
  readonly atmFullFalseSafeCount: number;
  readonly primaryDenominator: number;
  readonly unresolvedExcludedFromPrimary: true;
}
