export declare const PUBLICATION_DELIVERY_SLICE_MANIFEST_SCHEMA_ID: "atm.publicationDeliverySliceManifest.v1";
export interface PublicationDeliverySliceManifest {
    readonly schemaId: typeof PUBLICATION_DELIVERY_SLICE_MANIFEST_SCHEMA_ID;
    readonly receiptPath: string;
    readonly expectedSealedSourceSha: string;
    readonly expectedInventoryDigest: string;
    readonly expectedPublicationDisposition: 'published' | 'recovery-retained';
}
export type PublicationDeliverySliceRejectionCode = 'ATM_GIT_COMMIT_DELIVERY_SLICE_INVALID' | 'ATM_GIT_COMMIT_DELIVERY_SLICE_NOT_PUBLISHED' | 'ATM_GIT_COMMIT_DELIVERY_SLICE_MANIFEST_MISMATCH' | 'ATM_GIT_COMMIT_DELIVERY_SLICE_OUT_OF_SCOPE' | 'ATM_GIT_COMMIT_DELIVERY_SLICE_FOREIGN_DIRTY';
export type PublicationDeliverySliceResult = {
    readonly ok: true;
    readonly code: null;
    readonly reason: null;
    readonly inventoryMembers: readonly string[];
    readonly requiredRecords: readonly string[];
    readonly stageFiles: readonly string[];
} | {
    readonly ok: false;
    readonly code: PublicationDeliverySliceRejectionCode;
    readonly reason: string;
    readonly inventoryMembers: readonly string[];
    readonly requiredRecords: readonly string[];
    readonly stageFiles: readonly string[];
};
export declare function parsePublicationDeliverySliceManifest(value: unknown): PublicationDeliverySliceManifest | null;
/**
 * Creates the narrow delivery selector from the immutable publication receipt
 * itself.  This removes an operator-maintained copy of the sealed SHA and
 * inventory digest while leaving the downstream resolver responsible for
 * validating the receipt and its inventory fail-closed.
 */
export declare function derivePublicationDeliverySliceManifest(input: {
    readonly receiptPath: string;
    readonly receipt: unknown;
}): PublicationDeliverySliceManifest | null;
export declare function resolvePublicationDeliverySlice(input: {
    readonly manifest: unknown;
    readonly receipt: unknown;
    readonly dirtyPaths: readonly string[];
    readonly allowedScope: readonly string[];
    readonly pathMatchesScope: (filePath: string, scope: string) => boolean;
}): PublicationDeliverySliceResult;
