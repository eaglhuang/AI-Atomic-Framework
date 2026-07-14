export interface PlanningSourceSeal {
    readonly schemaId: 'atm.planningSourceSeal.v1';
    readonly repoIdentity: string;
    readonly repoRoot: string;
    readonly taskCardPath: string;
    readonly planningCommitSha: string | null;
    readonly contentDigest: string;
    readonly amendmentEpoch: number;
    readonly sealedAt: string;
}
export interface PlanningSourceSealValidation {
    readonly ok: boolean;
    readonly status: 'match' | 'governed-amendment' | 'drift';
    readonly driftKinds: readonly PlanningSourceDriftKind[];
    readonly sealed: PlanningSourceSeal | null;
    readonly current: PlanningSourceSeal | null;
    readonly diagnostics: {
        readonly codes: readonly string[];
        readonly messages: readonly string[];
    };
}
export type PlanningSourceDriftKind = 'path' | 'commit' | 'content' | 'repo-identity' | 'amendment-epoch';
export declare function buildPlanningSourceSeal(input: {
    readonly cwd: string;
    readonly planAbsolute: string;
    readonly planText?: string | null;
    readonly sealedAt: string;
}): PlanningSourceSeal;
export declare function attachPlanningSourceSeal<TTask extends {
    source: object;
}>(task: TTask, seal: PlanningSourceSeal): TTask;
export declare function validatePlanningSourceSeal(input: {
    readonly cwd: string;
    readonly taskDocument: Record<string, unknown>;
}): PlanningSourceSealValidation;
export declare function assertPlanningSourceSealValid(input: {
    readonly cwd: string;
    readonly taskDocument: Record<string, unknown>;
    readonly surface: 'claim' | 'close';
}): PlanningSourceSealValidation;
