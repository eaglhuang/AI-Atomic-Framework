export interface DefaultGuardRecord {
    readonly id: string;
    readonly summary: string;
}
export interface DefaultGuardsDocument {
    readonly schemaId: 'atm.defaultGuards';
    readonly specVersion: '0.1.0';
    readonly schemaVersion: 'atm.defaultGuards.v0.1';
    readonly migration: {
        readonly strategy: 'none';
        readonly fromVersion: null;
        readonly notes: string;
    };
    readonly generatedAt: string;
    readonly repositoryKind: string;
    readonly guards: readonly DefaultGuardRecord[];
}
export declare const defaultGuardCatalog: readonly DefaultGuardRecord[];
export declare function createDefaultGuards(projectProbe: Readonly<Record<string, unknown>>): DefaultGuardsDocument;
