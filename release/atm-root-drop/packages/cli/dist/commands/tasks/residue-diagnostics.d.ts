export type TaskResidueBucket = 'no-residue' | 'complete-but-unfinalized' | 'source-done-governance-incomplete' | 'planning-mirror-only' | 'interrupted-close' | 'stale-import' | 'ambiguous-manual-review';
export interface TaskResidueClassification {
    bucket: TaskResidueBucket;
    truth: string;
    residue: string;
    reason: string;
    nextCommandTemplate: string;
    nextCommand: string;
    autoMutationAllowed: false;
}
export interface TaskResidueLedgerSnapshot {
    status: string | null;
    claimState: string | null;
    lastTransitionId: string | null;
    lastTransitionAt: string | null;
}
export interface TaskResiduePlanningSnapshot {
    status: string | null;
    source: string | null;
}
export interface TaskResidueTransitionSnapshot {
    action: string | null;
    actorId: string | null;
    createdAt: string | null;
    fromStatus: string | null;
    toStatus: string | null;
}
export interface TaskResidueDivergence {
    field: string;
    liveLedger: string | null;
    planningFrontmatter?: string | null;
    lastTransitionEvent?: string | null;
}
export interface TaskStatusTriangulation {
    ssot: 'liveLedger';
    liveLedger: TaskResidueLedgerSnapshot;
    lastTransitionEvent: TaskResidueTransitionSnapshot | null;
    planningFrontmatter: TaskResiduePlanningSnapshot;
    divergence: TaskResidueDivergence[];
    recommendation: string | null;
    residueClassification: TaskResidueClassification;
}
export interface TaskResidueDiagnosisEvidence {
    readonly schemaId: 'atm.taskResidueDiagnosis.v1';
    readonly taskId: string;
    readonly bucket: TaskResidueBucket;
    readonly truth: string;
    readonly residue: string;
    readonly reason: string;
    readonly nextCommand: string;
    readonly nextCommandTemplate: string;
    readonly autoMutationAllowed: false;
    readonly diagnostics: {
        readonly codes: readonly string[];
        readonly messages: readonly string[];
    };
    readonly triangulation: TaskStatusTriangulation;
}
export declare function buildResidueClassification(input: {
    cwd: string;
    taskId: string;
    taskDocument: Record<string, unknown>;
    liveLedger: TaskResidueLedgerSnapshot;
    planningFrontmatter: TaskResiduePlanningSnapshot;
    lastTransitionEvent: TaskResidueTransitionSnapshot | null;
    divergence: readonly TaskResidueDivergence[];
}): TaskResidueClassification;
export declare function buildResidueDiagnosisEvidenceFromTriangulation(input: {
    readonly taskId: string;
    readonly triangulation: TaskStatusTriangulation;
}): TaskResidueDiagnosisEvidence;
