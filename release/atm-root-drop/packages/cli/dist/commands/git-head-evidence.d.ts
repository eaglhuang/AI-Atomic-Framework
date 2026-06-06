export declare const gitHeadEvidencePaths: {
    legacyJson: string;
    jsonl: string;
};
export declare const gitHeadEvidencePath: string;
export declare function createGitHeadEvidenceCheck(cwd: any, runtime: any): {
    name: string;
    ok: boolean;
    details: any;
};
