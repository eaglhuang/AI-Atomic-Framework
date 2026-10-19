import type { EvidenceRecord } from '../index.js';
export declare const EVIDENCE_LEDGER_ENTRY_SCHEMA_ID: "atm.evidenceLedgerEntry.v1";
export declare const EVIDENCE_LEDGER_CHECKPOINT_SCHEMA_ID: "atm.evidenceLedgerCheckpoint.v1";
export declare const EVIDENCE_STORAGE_POLICY: {
    readonly runtimeRoot: ".atm/runtime/evidence-ledger";
    readonly legacyRoot: ".atm/history/evidence";
    readonly durableKinds: readonly ["abandon-residue-disposition", "bundle-manifest", "checkpoint", "closure-packet", "index-restore-failure", "live-index-reconciliation", "proposal-lane", "runner-publication-recovery", "runner-sync-receipt", "seal-and-commit"];
};
export type DurableEvidenceKind = typeof EVIDENCE_STORAGE_POLICY.durableKinds[number];
export declare function runtimeEvidenceBundleRelativePath(workItemId: string): string;
export declare function durableEvidenceRelativePath(workItemId: string, kind: DurableEvidenceKind): string;
export declare function legacyEvidenceBundleRelativePath(workItemId: string): string;
export declare function isDurableEvidencePath(relativePath: string): boolean;
export interface EvidenceLedgerEntry {
    readonly schemaId: typeof EVIDENCE_LEDGER_ENTRY_SCHEMA_ID;
    readonly digest: string;
    readonly workItemId: string;
    readonly record: EvidenceRecord;
}
export interface EvidenceLedgerCheckpoint {
    readonly schemaId: typeof EVIDENCE_LEDGER_CHECKPOINT_SCHEMA_ID;
    readonly digest: string;
    readonly entryDigests: readonly string[];
}
export interface EvidenceLedger {
    append(workItemId: string, record: EvidenceRecord): EvidenceLedgerEntry;
    resolve(digest: string): EvidenceLedgerEntry | null;
    verify(digest: string): boolean;
    checkpoint(): EvidenceLedgerCheckpoint;
}
export declare function sha256(value: unknown): string;
export declare function createEvidenceLedgerEntry(workItemId: string, record: EvidenceRecord): EvidenceLedgerEntry;
export declare function verifyEvidenceLedgerEntry(entry: EvidenceLedgerEntry): boolean;
export declare function createInMemoryEvidenceLedger(entries?: readonly EvidenceLedgerEntry[]): EvidenceLedger;
