type TaskflowOpenWriteReadinessStatus = 'ready' | 'fallback' | 'incomplete';
interface TaskflowOpenWriteReadinessHint {
    schemaId: 'atm.taskflowOpenWriteReadinessHint.v1';
    status: TaskflowOpenWriteReadinessStatus;
    summary: string;
    missingPrerequisites: string[];
    nextCommand: string | null;
    operatorLane: 'taskflow open';
    fallbackSurface: 'tasks new (low-level generator)' | null;
}
export declare function runTaskflow(argv?: string[]): Promise<{
    schemaId: string;
    writeEnabled: boolean;
    ok: boolean;
    command: string;
    mode: string;
    cwd: string;
    messages: import("../shared.ts").CommandMessage[];
    evidence: Record<string, unknown>;
} | {
    schemaId: string;
    writeEnabled: boolean;
    writeReadinessHint: TaskflowOpenWriteReadinessHint;
    ok: boolean;
    command: string;
    mode: string;
    cwd: string;
    messages: import("../shared.ts").CommandMessage[];
    evidence: Record<string, unknown>;
}>;
export declare function buildTaskflowCloseResidueAdvisory(diagnosis: {
    readonly bucket?: unknown;
    readonly truth?: unknown;
    readonly residue?: unknown;
    readonly reason?: unknown;
    readonly nextCommand?: unknown;
}): {
    schemaId: string;
    bucket: string;
    truth: string | null;
    residue: string | null;
    reason: string | null;
    recoveryCommand: string;
    severity: string;
    closeSucceeded: boolean;
} | null;
export declare function buildTaskflowPlanningIndexAdvisory(input: {
    readonly taskId: string;
    readonly planningRosterPaths: {
        readonly repoRoot?: string | null;
        readonly indexPath?: string | null;
        readonly fromPath?: string | null;
    } | null;
    readonly rosterCloseback: Record<string, unknown> | null;
    readonly rosterCommand: string | null;
}): {
    schemaId: string;
    taskId: string;
    status: string;
    repoRoot: string | null;
    indexPath: string | null;
    planningCardPath: string | null;
    frontmatterFields: string[];
    requiredCommand: string;
    diff: {
        before: {} | null;
        after: {} | null;
    } | null;
} | null;
export {};
