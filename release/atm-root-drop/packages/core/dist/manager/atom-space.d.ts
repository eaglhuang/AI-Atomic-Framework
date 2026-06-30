export declare const defaultAtomWorkbenchRoot = "atomic_workbench/atoms";
export declare const defaultAtomSpecFileName = "atom.spec.json";
export declare const defaultAtomTestFileName = "atom.test.ts";
export declare const defaultTestReportFileName = "atom.test.report.json";
interface AtomIdentityRecord {
    atomId: string;
}
interface AtomSpaceModel {
    identity: AtomIdentityRecord;
}
interface AtomSpaceOptions {
    repositoryRoot?: string;
    workbenchPath?: string;
    workbenchRoot?: string;
    specFileName?: string;
    testFileName?: string;
    reportFileName?: string;
    reportPath?: string;
    [key: string]: unknown;
}
export declare function createAtomSpaceLayout(normalizedModel: AtomSpaceModel, options?: AtomSpaceOptions): {
    atomId: string;
    folderName: string;
    workbenchPath: string;
    specPath: string;
    testPath: string;
    reportPath: string;
};
export declare function resolveAtomWorkbenchPath(normalizedModel: AtomSpaceModel, options?: AtomSpaceOptions): string;
export declare function resolveAtomicTestReportPath(normalizedModel: AtomSpaceModel, options?: AtomSpaceOptions): string;
export declare function resolveCanonicalAtomFolderName(atomId: unknown): string;
export {};
