export type LinkedSurfaceEdgeKind = 'template-compiler' | 'validator' | 'editor-projection' | 'manifest' | 'build-output';
export type LinkedSurfaceAvailability = 'required' | 'optional' | 'unsupported';
export type LinkedSurfaceEdge = Readonly<{
    edgeId: string;
    producerId: string;
    kind: LinkedSurfaceEdgeKind;
    inputs: readonly string[];
    outputs: readonly string[];
    availability: Exclude<LinkedSurfaceAvailability, 'unsupported'>;
    provenance: {
        readonly registryId: string;
        readonly declaredBy: string;
    };
}>;
export type LinkedSurfaceFinding = Readonly<{
    code: 'ATM_SCOPE_AMENDMENT_REQUIRED' | 'ATM_LINKED_SURFACE_OPTIONAL' | 'ATM_LINKED_SURFACE_UNSUPPORTED' | 'ATM_LINKED_SURFACE_CYCLE';
    surface: string;
    edgeId: string | null;
    producerId: string | null;
    message: string;
}>;
export type LinkedSurfaceClosureReceipt = Readonly<{
    schemaId: 'atm.linkedSurfaceClosure.v1';
    specVersion: '0.1.0';
    rootScope: readonly string[];
    requiredSurfaces: readonly string[];
    optionalSurfaces: readonly string[];
    unavailableSurfaces: readonly string[];
    traversalOrder: readonly string[];
    closureDigest: string;
    findings: readonly LinkedSurfaceFinding[];
}>;
export type BrokerRearbitrationReceipt = Readonly<{
    schemaId: 'atm.scopeAmendmentRearbitration.v1';
    required: boolean;
    errorCode: 'ATM_BROKER_REARBITRATION_REQUIRED' | null;
    missingReadSet: readonly string[];
    missingWriteSet: readonly string[];
    amendedReadSet: readonly string[];
    amendedWriteSet: readonly string[];
    closureDigest: string;
}>;
export declare function inferLinkedSurfaceClosure(input: {
    readonly rootScope: readonly string[];
    readonly edges: readonly LinkedSurfaceEdge[];
    readonly registeredProducerIds: readonly string[];
}): LinkedSurfaceClosureReceipt;
export declare function rearbitrateLinkedSurfaceScope(input: {
    readonly closure: LinkedSurfaceClosureReceipt;
    readonly ticketReadSet: readonly string[];
    readonly ticketWriteSet: readonly string[];
}): BrokerRearbitrationReceipt;
