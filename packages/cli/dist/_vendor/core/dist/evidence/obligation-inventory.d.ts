export declare const OBLIGATION_INVENTORY_SCHEMA_ID: "atm.obligationInventory.v1";
export declare const OBLIGATION_INVENTORY_DRIFT_SCHEMA_ID: "atm.obligationInventoryDrift.v1";
export type ObligationLifecycleStatus = 'active' | 'deprecated' | 'excluded' | 'draft';
export interface ObligationSourceRef {
    readonly kind: 'file' | 'schema' | 'task' | 'plan' | 'seam' | 'other';
    readonly ref: string;
}
export interface ObligationValidatorRef {
    readonly command: string;
    readonly caseId?: string | null;
}
export interface ObligationInventoryEntryInput {
    readonly obligationId: string;
    readonly semanticFamily: string;
    readonly owningSeam: string;
    readonly lifecycleStatus: ObligationLifecycleStatus;
    readonly sourceRefs?: readonly ObligationSourceRef[];
    readonly validatorRefs?: readonly ObligationValidatorRef[];
    readonly description?: string | null;
    readonly observedAt?: string | null;
}
export interface ObligationInventoryEntry extends ObligationInventoryEntryInput {
    readonly sourceRefs: readonly ObligationSourceRef[];
    readonly validatorRefs: readonly ObligationValidatorRef[];
    readonly entryDigest: string;
}
export interface ObligationInventoryInput {
    readonly inventoryId: string;
    readonly modelId: string;
    readonly generatedAt: string;
    readonly entries: readonly ObligationInventoryEntryInput[];
}
export interface ObligationInventory extends Omit<ObligationInventoryInput, 'entries'> {
    readonly schemaId: typeof OBLIGATION_INVENTORY_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly entries: readonly ObligationInventoryEntry[];
    readonly inventoryDigest: string;
}
export type ObligationDriftKind = 'added' | 'removed' | 'changed' | 'stale-observed';
export interface ObligationDriftItem {
    readonly obligationId: string;
    readonly kind: ObligationDriftKind;
    readonly previousDigest: string | null;
    readonly currentDigest: string | null;
    readonly reason: string;
}
export interface ObligationInventoryDrift {
    readonly schemaId: typeof OBLIGATION_INVENTORY_DRIFT_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly previousInventoryDigest: string;
    readonly currentInventoryDigest: string;
    readonly staleCertificateId: string | null;
    readonly staleCertificateDigest: string | null;
    readonly changed: boolean;
    readonly items: readonly ObligationDriftItem[];
}
export declare function createObligationInventory(input: ObligationInventoryInput): ObligationInventory;
export declare function detectObligationInventoryDrift(input: {
    readonly previous: ObligationInventory;
    readonly current: ObligationInventory;
    readonly staleObservedBefore?: string | null;
    readonly staleCertificateId?: string | null;
    readonly staleCertificateDigest?: string | null;
}): ObligationInventoryDrift;
