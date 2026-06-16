import type { BrokerMutationEvidenceEntry, MergePlan, MigrationRecord } from './types.ts';
export interface StewardPermissionBoundary {
    readonly fileWrite: readonly string[];
    readonly gitWrite: false;
    readonly taskLifecycle: false;
}
export interface StewardApplyEvidence {
    readonly schemaId: 'atm.stewardApplyEvidence.v1';
    readonly specVersion: '0.1.0';
    readonly migration: MigrationRecord;
    readonly stewardId: string;
    readonly mergePlanId: string;
    readonly proposalIds: readonly string[];
    readonly targetFiles: readonly string[];
    readonly appliedFiles: readonly string[];
    readonly fileBeforeHashes: Readonly<Record<string, string>>;
    readonly fileAfterHashes: Readonly<Record<string, string>>;
    readonly permissions: StewardPermissionBoundary;
    readonly applyMethod: MergePlan['applyMethod'];
    readonly verdict: 'applied' | 'blocked';
    readonly blockedReasons?: readonly string[];
    readonly mutationEvidence?: readonly BrokerMutationEvidenceEntry[];
}
export declare const defaultStewardApplyMigration: MigrationRecord;
export declare function buildStewardApplyEvidence(input: {
    readonly stewardId: string;
    readonly mergePlan: MergePlan;
    readonly proposalIds: readonly string[];
    readonly targetFiles: readonly string[];
    readonly appliedFiles: readonly string[];
    readonly fileBeforeHashes: Readonly<Record<string, string>>;
    readonly fileAfterHashes: Readonly<Record<string, string>>;
    readonly verdict: StewardApplyEvidence['verdict'];
    readonly blockedReasons?: readonly string[];
    readonly mutationEvidence?: readonly BrokerMutationEvidenceEntry[];
}): StewardApplyEvidence;
