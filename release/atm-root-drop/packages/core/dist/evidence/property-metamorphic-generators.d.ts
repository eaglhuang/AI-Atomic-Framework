export declare const PROPERTY_METAMORPHIC_GENERATORS_SCHEMA_ID: "atm.propertyMetamorphicGenerators.v1";
export type PropertyMetamorphicStatus = 'proven' | 'blocked' | 'stale' | 'contradictory';
export interface PropertyAuthority {
    readonly authorityId: string;
    readonly digest: string;
    readonly sealed: boolean;
}
export interface PropertyRelation {
    readonly relationId: string;
    readonly inputDigest: string;
    readonly transformedDigest: string;
    readonly expectedRelation: 'equal' | 'subset' | 'superset' | 'different' | string;
    readonly observedRelation?: string;
}
export interface PropertyGeneratorInput {
    readonly authority: PropertyAuthority;
    readonly generatorId: string;
    readonly relations: readonly PropertyRelation[];
    readonly sourceDigest: string;
    readonly provenance?: Readonly<Record<string, unknown>>;
}
export interface PropertyGeneratorResult {
    readonly schemaId: typeof PROPERTY_METAMORPHIC_GENERATORS_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly generatorId: string;
    readonly authority: PropertyAuthority;
    readonly relations: readonly PropertyRelation[];
    readonly generatedCaseIds: readonly string[];
    readonly status: PropertyMetamorphicStatus;
    readonly diagnostics: readonly string[];
    readonly repairCommand: string | null;
    readonly provenance: Readonly<Record<string, unknown>>;
    readonly resultDigest: string;
}
export declare function compilePropertyMetamorphicGenerators(input: PropertyGeneratorInput): PropertyGeneratorResult;
export declare const createPropertyMetamorphicGenerators: typeof compilePropertyMetamorphicGenerators;
export declare function replayPropertyMetamorphicGenerators(result: PropertyGeneratorResult): PropertyGeneratorResult;
export declare function validatePropertyMetamorphicGenerators(result: PropertyGeneratorResult): {
    ok: boolean;
    diagnostics: string[];
};
