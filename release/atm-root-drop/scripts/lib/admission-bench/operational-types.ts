export const operationalBenchSpanNames = [
  'diffConstructionMs',
  'mutationRequestConstructionMs',
  'admissionDecisionMs',
  'composerPlanMs',
  'stewardDryRunMs',
  'stewardApplyMs',
  'validatorMs',
  'gitAdmitDryRunMs',
  'casMismatchRecoveryMs',
  'queueWaitMs',
  'totalScenarioMs'
] as const;

export type OperationalBenchSpanName = typeof operationalBenchSpanNames[number];
export type OperationalBenchProfileName = 'smoke' | 'paper' | 'extended';
export type OperationalBenchTrack = 'broker-admission' | 'git-boundary' | 'recovery-routing';

export type OperationalBenchBlockedCase =
  | 'none'
  | 'queue'
  | 'serialization'
  | 'steward-review'
  | 'rebase-replay'
  | 'refinement'
  | 'terminal-fail-closed';

export interface OperationalBenchProfile {
  readonly name: OperationalBenchProfileName;
  readonly warmup: number;
  readonly repeat: number;
  readonly concurrency: readonly number[];
}

export interface OperationalBenchScenario {
  readonly id: string;
  readonly track: OperationalBenchTrack;
  readonly blockedCase: OperationalBenchBlockedCase;
  readonly expectedRoute: string;
  readonly notes: string;
  readonly recovery: {
    readonly preservedIntentSalvage: boolean | null;
    readonly terminalFailClosed: boolean | null;
    readonly overSerialized: boolean | null;
    readonly fullRegenerationObserved: boolean | null;
  };
}

export type OperationalBenchSpans = Record<OperationalBenchSpanName, number | null>;

export interface OperationalBenchResultRow {
  readonly schemaId: 'atm.operationalBenchResult.v1';
  readonly runId: string;
  readonly profile: OperationalBenchProfileName;
  readonly seed: number;
  readonly scenarioId: string;
  readonly track: OperationalBenchTrack;
  readonly iteration: number;
  readonly concurrency: number;
  readonly route: string;
  readonly blockedCase: OperationalBenchBlockedCase;
  readonly spans: OperationalBenchSpans;
  readonly recovery: OperationalBenchScenario['recovery'];
}

export interface OperationalBenchStats {
  readonly count: number;
  readonly min: number | null;
  readonly max: number | null;
  readonly mean: number | null;
  readonly stddev: number | null;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
}
