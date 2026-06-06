export type HumanReviewDecision = 'approve' | 'reject';
export type HumanReviewQueueStatus = 'pending' | 'blocked' | 'approved' | 'rejected';
export type HumanReviewDecompositionDecision = 'atom-bump' | 'atom-extract' | 'map-bump' | 'polymorphize' | 'extract-shared' | 'infect' | 'atomize' | 'split';
export interface HumanReviewQueueMigration {
    readonly strategy: 'none' | 'additive' | 'breaking';
    readonly fromVersion: string | null;
    readonly notes: string;
}
export interface HumanReviewQueueReviewRecord {
    readonly decision: HumanReviewDecision;
    readonly reason: string;
    readonly decidedBy: string;
    readonly decidedAt: string;
    readonly decisionSnapshotHash: string;
    readonly evidenceId?: string;
}
export interface HumanReviewQueueAutomatedGatesSummary {
    readonly allPassed: boolean;
    readonly blockedGateNames: readonly string[];
}
export interface HumanReviewUpgradeProposalSnapshot {
    readonly proposalId: string;
    readonly atomId: string;
    readonly fromVersion: string;
    readonly toVersion: string;
    readonly decompositionDecision: HumanReviewDecompositionDecision;
    readonly automatedGates: HumanReviewQueueAutomatedGatesSummary;
    readonly status: HumanReviewQueueStatus;
    readonly proposedAt: string;
    readonly [key: string]: unknown;
}
export interface HumanReviewQueueRecord {
    readonly proposalId: string;
    readonly atomId: string;
    readonly fromVersion: string;
    readonly toVersion: string;
    readonly decompositionDecision: HumanReviewDecompositionDecision;
    readonly automatedGates: HumanReviewQueueAutomatedGatesSummary;
    readonly status: HumanReviewQueueStatus;
    readonly proposalSnapshotHash: string;
    readonly proposal: HumanReviewUpgradeProposalSnapshot;
    readonly queuedAt?: string;
    readonly review?: HumanReviewQueueReviewRecord;
}
export interface HumanReviewQueueDocument {
    readonly schemaId: 'atm.humanReviewQueue';
    readonly specVersion: '0.1.0';
    readonly migration: HumanReviewQueueMigration;
    readonly generatedAt: string;
    readonly entries: readonly HumanReviewQueueRecord[];
}
export interface HumanReviewQueueDocumentOptions {
    readonly generatedAt?: string;
    readonly migration?: Partial<HumanReviewQueueMigration>;
}
export interface HumanReviewQueueRecordOptions {
    readonly queuedAt?: string;
    readonly status?: HumanReviewQueueStatus;
    readonly review?: HumanReviewQueueReviewRecord;
}
export interface HumanReviewQueueValidationIssue {
    readonly path: string;
    readonly message: string;
}
export interface HumanReviewQueueValidationResult {
    readonly ok: boolean;
    readonly issues: readonly HumanReviewQueueValidationIssue[];
}
export declare const humanReviewQueuePackage: {
    readonly packageName: "@ai-atomic-framework/plugin-human-review";
    readonly packageRole: "human-review-reference-plugin";
    readonly packageVersion: "0.0.0";
};
export declare function computeDecisionSnapshotHash(proposal: HumanReviewUpgradeProposalSnapshot | Readonly<Record<string, unknown>>): string;
export declare function createHumanReviewQueueRecord(proposal: HumanReviewUpgradeProposalSnapshot | Readonly<Record<string, unknown>>, options?: HumanReviewQueueRecordOptions): HumanReviewQueueRecord;
export declare function createHumanReviewQueueDocument(entries: readonly HumanReviewQueueRecord[], options?: HumanReviewQueueDocumentOptions): HumanReviewQueueDocument;
export declare function loadHumanReviewQueueDocument(filePath: string): HumanReviewQueueDocument | null;
export declare function writeHumanReviewQueueDocument(filePath: string, document: HumanReviewQueueDocument): HumanReviewQueueDocument;
export declare function normalizeHumanReviewQueueDocument(document: HumanReviewQueueDocument | readonly HumanReviewQueueRecord[]): HumanReviewQueueDocument;
export declare function findHumanReviewQueueRecord(document: HumanReviewQueueDocument, proposalId: string): HumanReviewQueueRecord | null;
export declare function replaceHumanReviewQueueRecord(document: HumanReviewQueueDocument, nextRecord: HumanReviewQueueRecord): HumanReviewQueueDocument;
export declare function renderHumanReviewQueueMarkdown(document: HumanReviewQueueDocument): string;
export declare function validateHumanReviewQueueDocument(document: HumanReviewQueueDocument | readonly HumanReviewQueueRecord[]): HumanReviewQueueValidationResult;
export declare function validateHumanReviewQueueRecord(record: HumanReviewQueueRecord): HumanReviewQueueValidationResult;
