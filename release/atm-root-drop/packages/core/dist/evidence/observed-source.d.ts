export declare const OBSERVED_EVIDENCE_SOURCE_SCHEMA_ID: "atm.observedEvidenceSource.v1";
export declare const OBSERVATION_SNAPSHOT_SCHEMA_ID: "atm.observationSnapshot.v1";
export type ObservedEvidenceSourceKind = 'git' | 'ledger' | 'process' | 'filesystem' | 'runner' | 'custom';
export type ObservedEvidenceDependencyClass = 'in-process' | 'local-substitutable' | 'remote-owned' | 'true-external';
export type ObservedEvidenceStatus = 'observed' | 'unavailable' | 'conflicting';
export interface ObservedEvidenceSourceDescriptor {
    readonly sourceId: string;
    readonly kind: ObservedEvidenceSourceKind;
    readonly dependencyClass: ObservedEvidenceDependencyClass;
}
export interface ObservedEvidenceSource {
    readonly descriptor: ObservedEvidenceSourceDescriptor;
    read(): unknown;
}
export interface ObservedEvidenceSnapshot {
    readonly schemaId: typeof OBSERVATION_SNAPSHOT_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly status: ObservedEvidenceStatus;
    readonly sourceIds: readonly string[];
    readonly observedAt: string;
    readonly value: unknown | null;
    readonly valueDigest: string | null;
    readonly diagnostics: readonly string[];
}
/**
 * Reads evidence only through declared source ports.  The public result has no
 * caller-provided success bit: availability and agreement are derived from the
 * observed values themselves.
 */
export declare function collectObservedEvidence(sources: readonly ObservedEvidenceSource[]): ObservedEvidenceSnapshot;
export declare function verifyObservedEvidence(snapshotValue: ObservedEvidenceSnapshot, expectedDigest: string): {
    readonly ok: boolean;
    readonly diagnostics: readonly string[];
};
