interface TreeSnapshot {
    existed: boolean;
    files: Map<string, Buffer>;
}
export interface AtomBirthTransaction {
    workbenchPath: string;
    workbench: TreeSnapshot;
    registryPath: string;
    registry: Buffer | null;
    catalogPath: string;
    catalog: Buffer | null;
}
export declare function snapshotAtomBirth(repositoryRoot: string, workbenchRelativePath: string, registryRelativePath: string, catalogRelativePath: string): AtomBirthTransaction;
export declare function restoreAtomBirth(transaction: AtomBirthTransaction): void;
export {};
