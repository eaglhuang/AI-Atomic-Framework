export interface DiffEvidenceDraft {
    taskId: string;
    evidenceType: 'diff-as-evidence';
    generatedAt: string;
    diffSource: string;
    changedFiles: string[];
    linesAdded: number;
    linesDeleted: number;
    patchSummary: string;
    affectedAtoms: string[];
    _unknownFiles: string[];
    intent: string;
    impact: string;
    testCoverage: string;
    _isValid: boolean;
}
export interface DiffEvidenceOptions {
    taskId: string;
    repositoryRoot: string;
    staged?: boolean;
    from?: string;
    to?: string;
    maxPatchLines?: number;
}
export declare function generateDiffEvidence(options: DiffEvidenceOptions): DiffEvidenceDraft;
export declare function validateDiffEvidence(draft: DiffEvidenceDraft): {
    valid: boolean;
    reasons: string[];
};
export declare function mergeDiffEvidenceWithExisting(existing: DiffEvidenceDraft, fresh: DiffEvidenceDraft): DiffEvidenceDraft;
