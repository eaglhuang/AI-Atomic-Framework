export declare const defaultRegistryCatalogRelativePath = "atomic_workbench/registry-catalog.md";
interface CatalogOptions {
    repositoryRoot?: string;
    catalogPath?: string;
    specRepositoryRoot?: string;
    title?: string;
    sourceOfTruthLabel?: string;
}
interface RegistryEntry {
    schemaId?: string;
    atomId?: string;
    mapId?: string;
    logicalName?: string;
    status?: string;
    evidence?: string[];
    location?: {
        specPath?: string;
        workbenchPath?: string;
    };
    specPath?: string;
    members?: unknown[];
    entrypoints?: string[];
    lineageLogRef?: string;
}
interface AtomCatalogRow {
    entryId: string;
    logicalName: string;
    functionSummary: string;
    derivedCategory: string;
    provenance: string;
    status: string;
    specPath: string;
}
interface MapCatalogRow {
    mapId: string;
    memberCount: number;
    status: string;
    workbenchPath: string;
    notes: string;
}
interface RegistryDocument {
    entries?: RegistryEntry[];
    registryId?: string;
}
export declare function resolveRegistryCatalogPath(options?: CatalogOptions): string;
export declare function createRegistryCatalogRows(registryDocument: RegistryDocument | null | undefined, options?: CatalogOptions): AtomCatalogRow[];
export declare function createRegistryCatalogProjection(registryDocument: RegistryDocument | null | undefined, options?: CatalogOptions): {
    atoms: AtomCatalogRow[];
    maps: MapCatalogRow[];
};
export declare function renderRegistryCatalogMarkdown(registryDocument: RegistryDocument | null | undefined, options?: CatalogOptions): string;
export declare function writeRegistryCatalogFile(registryDocument: RegistryDocument | null | undefined, options?: CatalogOptions): {
    catalogPath: string;
    markdown: string;
};
export {};
