export declare const defaultAtomWorkbenchRoot = "atomic_workbench/atoms";
export declare const defaultAtomSpecFileName = "atom.spec.json";
export declare const defaultAtomTestFileName = "atom.test.ts";
export declare const defaultTestReportFileName = "atom.test.report.json";
export declare function createAtomSpaceLayout(normalizedModel: any, options?: any): {
    atomId: any;
    folderName: string;
    workbenchPath: string;
    specPath: string;
    testPath: string;
    reportPath: string;
};
export declare function resolveAtomWorkbenchPath(normalizedModel: any, options?: any): string;
export declare function resolveAtomicTestReportPath(normalizedModel: any, options?: any): string;
export declare function resolveCanonicalAtomFolderName(atomId: any): string;
