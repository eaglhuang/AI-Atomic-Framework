interface ParsedCommitRangeArgs {
    readonly cwd: string;
    readonly base: string;
    readonly head: string;
}
interface ComparableCommandRun {
    readonly command: string;
    readonly exitCode: number;
    readonly stdoutSha256: string;
    readonly stderrSha256: string;
}
interface CommitEvidenceMatch {
    readonly commitSha: string;
    readonly criticalChangedFiles: readonly string[];
    readonly evidencePath: string;
    readonly matched: boolean;
    readonly matchedBy: 'commitSha' | 'treeSha+parentCommitShas' | 'evidenceOnlyParentCommitSha' | null;
    readonly gitDetails: ReturnType<typeof normalizeGitDetails>;
    readonly commandRuns: readonly ComparableCommandRun[];
    readonly validationPasses: readonly string[];
}
interface CommitClosurePacketInspection {
    readonly commitSha: string;
    readonly packetPath: string;
    readonly taskId: string | null;
    readonly findings: readonly {
        readonly code: string;
        readonly detail: string;
        readonly suggestedFix?: string;
    }[];
}
interface FrameworkCommitRangeBaseline {
    readonly schemaId: 'atm.frameworkCommitRangeBaseline.v1';
    readonly generatedAt: string;
    readonly name: string | null;
    readonly refName: string | null;
    readonly commitSha: string;
    readonly acceptedHistoryThroughCommitSha: string;
    readonly strictEvidenceRequiredAfterCommitSha: string;
    readonly rationale: string | null;
}
export declare function normalizeOptionalText(value: unknown): string | null;
export declare function readFrameworkCommitRangeBaseline(cwd: string, headRef: string): FrameworkCommitRangeBaseline | null;
export declare function isCommitAcceptedByLegacyBaseline(cwd: string, commitSha: string, baselineCommitSha: string): boolean;
export declare function isAncestorCommit(cwd: string, maybeAncestor: string, maybeDescendant: string): boolean;
export declare function createCommitRangeGuardReport(cwd: string, base: string, head: string): {
    schemaId: string;
    generatedAt: string;
    base: string;
    head: string;
    legacyBaseline: FrameworkCommitRangeBaseline | null;
    ignoredLegacyCriticalCommitCount: number;
    repoIdentity: import("../framework-development.ts").FrameworkRepoIdentity;
    changedFiles: string[];
    criticalChangedFiles: string[];
    criticalCommits: {
        commitSha: string;
        criticalChangedFiles: string[];
    }[];
    evidenceMatches: CommitEvidenceMatch[];
    evidenceMissingDiagnostic: {
        count: number;
        samples: {
            commitSha: string;
            message: string;
        }[];
    } | null;
    closurePacketInspections: CommitClosurePacketInspection[];
    taskAudit: import("../framework-development.ts").TaskAuditReport;
    protectedBranchPatterns: readonly ["main", "master", "trunk", "release/*"];
    findings: ({
        level: "error";
        code: string;
        commitSha: string;
        detail: string;
        suggestedFix: string | undefined;
    } | {
        level: "error";
        code: string;
        commitSha: null;
        detail: string;
    })[];
    ok: boolean;
};
export declare function parseCommitRangeArgs(argv: string[]): ParsedCommitRangeArgs;
export declare function readGitObjectText(cwd: string, ref: string): string | null;
export declare function findFutureCommitEvidenceMatchInWorktree(cwd: string, treeSha: string | null, parentCommitShas: readonly string[]): {
    commitSha: string | null;
    treeSha: string | null;
    parentCommitShas: string[];
} | null;
export declare function readStagedTreeWithoutEvidence(cwd: string): string | null;
export declare function readCurrentHeadForFutureCommit(cwd: string): readonly string[];
declare function normalizeGitDetails(value: unknown): {
    commitSha: string | null;
    treeSha: string | null;
    parentCommitShas: string[];
} | null;
export declare function readJsonText(text: string): unknown;
export {};
