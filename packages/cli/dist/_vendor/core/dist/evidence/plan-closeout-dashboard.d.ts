export declare const PLAN_CLOSEOUT_DASHBOARD_SCHEMA_ID: "atm.planCloseoutDashboard.v1";
export declare const FOUR_PLAN_OBJECTIVE_VERDICT_SCHEMA_ID: "atm.fourPlanObjectiveVerdict.v1";
export type PlanCloseoutLayerId = 'identity' | 'time-window' | 'authority-digest' | 'denominator' | 'correctness' | 'performance' | 'concurrency' | 'validation' | 'closure' | 'backlog' | 'governance' | 'claims';
export type ObjectiveVerdictStatus = 'verified' | 'not-complete' | 'unknown' | 'conflicting';
export type DashboardReadiness = 'ready' | 'not-ready';
export interface PlanCloseoutRawArtifact {
    readonly path: string;
    readonly digest: string;
    readonly producedBy?: string | null;
}
export interface FourPlanObjectiveRow {
    readonly planId: 'Plan 3.0' | 'Plan 3.1' | 'Plan 3.2' | 'Plan 4.0';
    readonly objectiveId: string;
    readonly status: ObjectiveVerdictStatus;
    readonly evidenceRefs: readonly string[];
    readonly summary?: string | null;
}
export interface FourPlanObjectiveVerdict {
    readonly schemaId: typeof FOUR_PLAN_OBJECTIVE_VERDICT_SCHEMA_ID;
    readonly generatedAt: string;
    readonly expectedDenominators: Readonly<Record<FourPlanObjectiveRow['planId'], number>>;
    readonly observedDenominators: Readonly<Record<FourPlanObjectiveRow['planId'], number>>;
    readonly statusCounts: Readonly<Record<ObjectiveVerdictStatus, number>>;
    readonly rows: readonly FourPlanObjectiveRow[];
    readonly sortedRowDigest: string;
    readonly findings: readonly string[];
    readonly status: DashboardReadiness;
}
export interface PlanCloseoutDashboardInput {
    readonly generatedAt?: string;
    readonly producer: string;
    readonly authorityDigest: string;
    readonly timeWindow: {
        readonly startedAt: string;
        readonly endedAt: string | null;
        readonly watermark: string;
    };
    readonly rawArtifacts: readonly PlanCloseoutRawArtifact[];
    readonly objectiveRows: readonly FourPlanObjectiveRow[];
    readonly validatorLifecycleDigest?: string | null;
    readonly closureDigest?: string | null;
    readonly backlogDigest?: string | null;
    readonly governanceDigest?: string | null;
    readonly claimDigest?: string | null;
}
export interface PlanCloseoutLayer {
    readonly id: PlanCloseoutLayerId;
    readonly status: DashboardReadiness;
    readonly digest: string | null;
    readonly summary: string;
}
export interface PlanCloseoutDashboard {
    readonly schemaId: typeof PLAN_CLOSEOUT_DASHBOARD_SCHEMA_ID;
    readonly generatedAt: string;
    readonly producer: string;
    readonly readOnly: true;
    readonly readiness: DashboardReadiness;
    readonly authorityDigest: string;
    readonly timeWindow: PlanCloseoutDashboardInput['timeWindow'];
    readonly rawArtifacts: readonly PlanCloseoutRawArtifact[];
    readonly rawInputDigest: string;
    readonly layers: readonly PlanCloseoutLayer[];
    readonly objectiveVerdict: FourPlanObjectiveVerdict;
    readonly staleCounterReuse: false;
    readonly blockers: readonly string[];
    readonly digest: string;
}
export declare function expectedFourPlanDenominators(): FourPlanObjectiveVerdict['expectedDenominators'];
export declare function buildFourPlanObjectiveVerdict(input: {
    readonly generatedAt?: string;
    readonly rows: readonly FourPlanObjectiveRow[];
}): FourPlanObjectiveVerdict;
export declare function buildPlanCloseoutDashboard(input: PlanCloseoutDashboardInput): PlanCloseoutDashboard;
