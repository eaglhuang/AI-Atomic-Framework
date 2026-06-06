export declare function computeSha256ForContent(content: any): string;
export declare function computeSha256ForFile(filePath: any): string;
export declare function computeSha256ForFiles(filePaths: any): string;
export declare function createSourceHashSnapshot(options?: any): {
    legacyPlanningId: any;
    specHash: string;
    codeHash: string;
    testHash: string;
    sourcePaths: {
        spec: any;
        code: any[];
        tests: any[];
    };
};
export declare function normalizeSourcePathList(value: any): any[];
