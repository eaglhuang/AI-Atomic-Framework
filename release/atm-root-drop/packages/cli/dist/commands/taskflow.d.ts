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
    messages: import("./shared.ts").CommandMessage[];
    evidence: Record<string, unknown>;
} | {
    schemaId: string;
    writeEnabled: boolean;
    writeReadinessHint: TaskflowOpenWriteReadinessHint;
    ok: boolean;
    command: string;
    mode: string;
    cwd: string;
    messages: import("./shared.ts").CommandMessage[];
    evidence: Record<string, unknown>;
}>;
export {};
