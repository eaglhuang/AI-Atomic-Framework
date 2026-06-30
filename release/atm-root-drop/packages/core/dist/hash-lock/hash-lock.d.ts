interface SourceHashSnapshotOptions {
    repositoryRoot?: string;
    legacyPlanningId?: string | null;
    specPath?: string;
    codePaths?: string[] | string;
    testPaths?: string[] | string;
}
export declare function computeSha256ForContent(content: string | Buffer): string;
export declare function computeSha256ForFile(filePath: string): string;
export declare function computeSha256ForFiles(filePaths: string[] | string): string;
export declare function createSourceHashSnapshot(options: SourceHashSnapshotOptions): {
    legacyPlanningId: string | null;
    specHash: string;
    codeHash: string;
    testHash: string;
    sourcePaths: {
        spec: string;
        code: string[];
        tests: string[];
    };
};
export declare function normalizeSourcePathList(value: string[] | string | null | undefined): string[];
export {};
