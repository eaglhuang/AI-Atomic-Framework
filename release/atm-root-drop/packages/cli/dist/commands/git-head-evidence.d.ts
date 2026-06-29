export declare const gitHeadEvidencePaths: {
    legacyJson: string;
    jsonl: string;
};
export declare const gitHeadEvidencePath: string;
export interface GitDetails {
    commitSha: string | null;
    treeSha: string | null;
    parentCommitShas: string[];
}
export interface EvidenceRecord {
    path: string;
    index: number;
    git: GitDetails;
}
export declare function createGitHeadEvidenceCheck(cwd: string, runtime: unknown): {
    name: string;
    ok: boolean;
    details: {
        status: string;
    };
};
