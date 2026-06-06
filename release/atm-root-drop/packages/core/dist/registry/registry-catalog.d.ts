export declare const defaultRegistryCatalogRelativePath = "atomic_workbench/registry-catalog.md";
export declare function resolveRegistryCatalogPath(options?: any): string;
export declare function createRegistryCatalogRows(registryDocument: any, options?: any): {
    entryId: string;
    logicalName: string;
    functionSummary: string;
    derivedCategory: string;
    provenance: any;
    status: string;
    specPath: string;
}[];
export declare function createRegistryCatalogProjection(registryDocument: any, options?: any): {
    atoms: {
        entryId: string;
        logicalName: string;
        functionSummary: string;
        derivedCategory: string;
        provenance: any;
        status: string;
        specPath: string;
    }[];
    maps: {
        mapId: string;
        memberCount: any;
        status: string;
        workbenchPath: string;
        notes: string;
    }[];
};
export declare function renderRegistryCatalogMarkdown(registryDocument: any, options?: any): string;
export declare function writeRegistryCatalogFile(registryDocument: any, options?: any): {
    catalogPath: any;
    markdown: string;
};
