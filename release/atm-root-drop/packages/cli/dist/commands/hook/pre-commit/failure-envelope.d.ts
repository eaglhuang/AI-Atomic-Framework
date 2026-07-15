export interface PreCommitBlockingFinding {
    readonly code: string;
    readonly source: string;
    readonly detail: string;
    readonly file?: string;
    readonly files?: readonly string[];
    readonly requiredCommand?: string | null;
    readonly classification?: 'environment' | 'baseline' | 'current-task' | 'blocking';
    readonly blockerKind?: 'governance-state' | 'content-validation' | 'environment' | 'baseline';
    readonly scope?: 'staged' | 'tree-wide';
    readonly data?: unknown;
}
export interface PreCommitFailureEnvelope {
    readonly schemaId: 'atm.validatorFailureEnvelope.v1';
    readonly ok: false;
    readonly surface: 'pre-commit';
    readonly requiredCommand: string | null;
    readonly blockingFindings: readonly PreCommitBlockingFinding[];
    readonly baselineFailures: readonly PreCommitBlockingFinding[];
    readonly currentTaskFailures: readonly PreCommitBlockingFinding[];
    readonly governanceStateFailures: readonly PreCommitBlockingFinding[];
    readonly contentValidationFailures: readonly PreCommitBlockingFinding[];
    readonly deferredGovernanceCandidate: boolean;
    readonly repairHints: readonly string[];
    readonly diagnostics: {
        readonly gitIndexDiagnostic: unknown;
        readonly failedValidators: readonly {
            readonly command: string;
            readonly exitCode: number;
            readonly stdoutSha256: string;
            readonly stderrSha256: string;
        }[];
    };
}
export declare function buildPreCommitBlockingFindings(input: any): readonly PreCommitBlockingFinding[];
export declare function selectActionableResidueFindings(input: any): readonly any[];
export declare function buildPreCommitFailureEnvelope(input: any): PreCommitFailureEnvelope;
export declare function buildPreCommitRepairHints(findings: readonly PreCommitBlockingFinding[], requiredCommand: string | null): readonly string[];
export declare function summarizePreCommitFailureEnvelope(envelope: PreCommitFailureEnvelope): string;
export declare function isPreCommitBaselineFinding(finding: PreCommitBlockingFinding): boolean;
export declare function isPreCommitEnvironmentFinding(finding: PreCommitBlockingFinding): boolean;
