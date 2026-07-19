export type TaskClaimIntent = 'write' | 'closeout-only';
export type PhysicalLineBudgetContext = {
    readonly taskId?: string | null;
    readonly actorId?: string | null;
    readonly gate?: string | null;
};
export type PhysicalLineBudgetReport = {
    readonly ok: boolean;
    readonly mode: 'touched';
    readonly scannedFiles: number;
    readonly maxLines: number;
    readonly softLines: number;
    readonly hardViolationCount: number;
    readonly softWarningCount: number;
    readonly topFile: {
        readonly file: string;
        readonly lines: number;
    } | null;
    readonly hardViolations: readonly {
        readonly file: string;
        readonly lines: number;
    }[];
    readonly softWarnings: readonly {
        readonly file: string;
        readonly lines: number;
    }[];
    readonly context: PhysicalLineBudgetContext;
    readonly reproduceCommand: string;
};
export declare function inspectTouchedPhysicalLineBudget(cwd: string, touchedFiles: readonly string[], context?: PhysicalLineBudgetContext): PhysicalLineBudgetReport;
export declare function normalizeRelativePath(value: string): string;
export declare function uniqueSorted(values: readonly string[]): readonly string[];
export declare function pathMatchesTaskScope(filePath: string, scope: string): boolean;
export declare function extractGovernanceTaskIdFromPath(filePath: string): string | null;
export declare function isProtectedStagedGovernanceOwnershipPath(filePath: string): boolean;
export declare function normalizeTaskClaimIntent(value: unknown): TaskClaimIntent;
