export declare const FOREIGN_GENERATED_RESIDUE_DISPOSITION_SCHEMA_ID = "atm.foreignGeneratedResidueDisposition.v1";
export interface ForeignGeneratedResidueProvenance {
    readonly path: string;
    readonly observedDigest: `sha256:${string}`;
    readonly producerTaskId: string;
    readonly artifactSchemaId: string;
    readonly sourceSnapshotSchemaId: string;
    readonly sourceDigest: `sha256:${string}`;
}
export interface ForeignGeneratedResidueDisposition {
    readonly schemaId: typeof FOREIGN_GENERATED_RESIDUE_DISPOSITION_SCHEMA_ID;
    readonly state: 'deferred' | 'blocked';
    readonly reason: string;
    readonly provenance: ForeignGeneratedResidueProvenance | null;
}
/**
 * Pure evidence classifier for a foreign generated artifact. It deliberately
 * does not grant a write capability; callers may only carry a deferred
 * observation forward in an admission ticket.
 */
export declare function classifyForeignGeneratedResidue(input: {
    readonly path: string;
    readonly content: string | null;
    readonly candidateTaskId: string;
    readonly producerDeclaresPath: boolean;
    readonly runnerInventoryMember: boolean;
}): ForeignGeneratedResidueDisposition;
