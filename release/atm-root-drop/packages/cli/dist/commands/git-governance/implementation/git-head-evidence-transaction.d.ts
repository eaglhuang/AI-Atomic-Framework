type LegacyValue = ReturnType<typeof JSON.parse>;
export declare function isGovernedLedgerBoundaryPathForGitCommit(filePath: LegacyValue): boolean;
export declare function ensureGovernedGitHeadEvidenceStagedForCommit(cwd: LegacyValue, actorId: LegacyValue): {
    evidencePath: string;
    treeSha: string;
    parentCommitShas: any[];
} | null;
export declare function ensureGovernedGitHeadEvidenceStagedForTaskScopedCommit(cwd: LegacyValue, actorId: LegacyValue, taskId: LegacyValue, commitFiles: LegacyValue, env: LegacyValue): {
    evidencePath: string;
    treeSha: string;
    parentCommitShas: any[];
} | null;
export declare function appendGitHeadEvidenceJsonl(evidenceAbsolute: LegacyValue, payload: LegacyValue): void;
export declare function captureGitHeadEvidencePreparation(cwd: LegacyValue): {
    evidenceAbsolute: string;
    existed: boolean;
    content: string | null;
};
export declare function rollbackFailedGitHeadEvidencePreparation(snapshot: LegacyValue): boolean;
export declare function reconcileResolvedCrossTaskMutationIncident(cwd: LegacyValue, taskId: LegacyValue): boolean;
export declare function hasMatchingWorktreeGitHeadEvidence(cwd: LegacyValue, treeSha: LegacyValue, parentCommitShas: LegacyValue): boolean;
export declare function sameStringSet(left: LegacyValue, right: LegacyValue): boolean;
export declare function readCurrentHeadParentCommitShas(cwd: LegacyValue): any[];
export declare function readIndexTreeWithoutEvidence(cwd: LegacyValue, env?: LegacyValue): string | null;
export {};
