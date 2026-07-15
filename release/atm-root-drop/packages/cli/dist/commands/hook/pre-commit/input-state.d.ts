import type { CommandRunReport } from '../pre-push.ts';
interface TaskCardStatusFinding {
    readonly file: string;
    readonly taskId: string;
    readonly previousStatus: string | null;
    readonly nextStatus: string;
    readonly reason: 'planning-card-done-without-ledger-closure';
    readonly detail: string;
    readonly requiredCommand: string;
}
export declare function readStagedFiles(cwd: string): readonly string[];
export declare function readStagedChangedLineCount(cwd: string, files: readonly string[]): number;
export declare function scanEncoding(cwd: string, files: readonly string[]): {
    schemaId: string;
    inspectedFileCount: number;
    findings: {
        readonly file: string;
        readonly issue: string;
    }[];
    ok: boolean;
};
export declare function inspectTaskCardStatusChanges(cwd: string, stagedFiles: readonly string[]): {
    schemaId: string;
    inspectedFileCount: number;
    findings: TaskCardStatusFinding[];
    ok: boolean;
};
export declare function shouldWriteGitHeadEvidenceForStagedCommit(input: {
    readonly stagedFiles: readonly string[];
    readonly criticalChangedFiles: readonly string[];
}): boolean;
export declare function writeStagedGitHeadEvidence(cwd: string, stagedFiles: readonly string[], commandRuns: readonly CommandRunReport[]): {
    evidencePath: string;
    treeSha: string | null;
    parentCommitShas: readonly string[];
    gitAddExitCode: number;
    ok: boolean;
    reusedExisting: boolean;
} | {
    evidencePath: string;
    treeSha: string | null;
    parentCommitShas: readonly string[];
    gitAddExitCode: number;
    ok: boolean;
    reusedExisting?: undefined;
};
export {};
