import type { PatchProposal } from './types.ts';
export interface BrokerProposalStoreDocument {
    readonly schemaId: 'atm.brokerProposalStore.v1';
    readonly specVersion: '0.1.0';
    readonly generatedAt: string;
    readonly proposals: readonly PatchProposal[];
}
export interface BrokerProposalSummary {
    readonly proposalId: string;
    readonly taskId: string;
    readonly targetFile: string;
    readonly atomRefCount: number;
    readonly anchorCount: number;
    readonly validatorCount: number;
}
export type BrokerProposalValidationIssueKind = 'schema' | 'missing-atom-refs' | 'ambiguous-anchors' | 'out-of-scope-target-file' | 'stale-base-commit' | 'file-hash-mismatch';
export interface BrokerProposalValidationIssue {
    readonly kind: BrokerProposalValidationIssueKind;
    readonly detail: string;
}
export interface BrokerProposalValidationReport {
    readonly ok: boolean;
    readonly proposalId: string;
    readonly cwd: string;
    readonly targetFile: string;
    readonly resolvedTargetFile: string | null;
    readonly currentBaseCommit: string | null;
    readonly currentFileHash: string | null;
    readonly issues: readonly BrokerProposalValidationIssue[];
}
export declare const defaultBrokerProposalStoreRelativePath: string;
export declare function loadBrokerProposalStore(filePath: string): BrokerProposalStoreDocument;
export declare function saveBrokerProposalStore(filePath: string, document: BrokerProposalStoreDocument): void;
export declare function upsertBrokerProposalStore(document: BrokerProposalStoreDocument, proposal: PatchProposal): BrokerProposalStoreDocument;
export declare function listBrokerProposalSummaries(document: BrokerProposalStoreDocument): readonly BrokerProposalSummary[];
export declare function findBrokerProposal(document: BrokerProposalStoreDocument, proposalId: string): PatchProposal | null;
export declare function readBrokerProposalFile(filePath: string): PatchProposal;
export declare function validateBrokerProposal(proposal: PatchProposal, options?: {
    cwd?: string;
}): BrokerProposalValidationReport;
