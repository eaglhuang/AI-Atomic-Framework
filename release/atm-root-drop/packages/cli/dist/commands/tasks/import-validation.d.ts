import type { TaskImportRecord } from '../tasks.ts';
export interface ForceImportAdmissionDecision {
    readonly emergencyRequired: boolean;
    readonly blockingFlags: readonly string[];
    readonly admissionClass: 'tier1-ledger-ingestion' | 'task-local-conflict' | 'closed-history-overwrite';
    readonly reason: string;
    readonly taskIds: readonly string[];
}
export declare function classifyForceImportAdmission(input: {
    readonly cwd: string;
    readonly tasks: readonly TaskImportRecord[];
    readonly force: boolean;
}): ForceImportAdmissionDecision;
