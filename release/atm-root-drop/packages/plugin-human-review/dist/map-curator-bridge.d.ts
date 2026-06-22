import type { AtomMapCuratorPatchDraftItem } from '../../core/src/upgrade/map-curator.ts';
import type { HumanReviewQueueRecord } from './queue.ts';
export interface AtomMapPatchReviewProposalSnapshot extends Readonly<Record<string, unknown>> {
    readonly schemaId: 'atm.upgradeProposal';
    readonly specVersion: '0.1.0';
    readonly migration: {
        readonly strategy: 'none' | 'additive' | 'breaking';
        readonly fromVersion: string | null;
        readonly notes: string;
    };
    readonly proposalId: string;
    readonly atomId: string;
    readonly fromVersion: string;
    readonly toVersion: string;
    readonly lifecycleMode: 'evolution';
    readonly behaviorId: 'behavior.split';
    readonly target: {
        readonly kind: 'map';
        readonly mapId: string;
    };
    readonly decompositionDecision: 'split';
    readonly proposalSource: 'broker-split-suggestion';
    readonly targetSurface: 'atom-map';
    readonly reviewTemplate: 'review.template.split';
    readonly automatedGates: {
        readonly allPassed: true;
        readonly blockedGateNames: readonly [];
    };
    readonly humanReview: 'pending';
    readonly status: 'pending';
    readonly patchDraft: AtomMapCuratorPatchDraftItem;
    readonly inputs: readonly {
        readonly kind: 'evolution-evidence';
        readonly path: string;
        readonly schemaId: 'atm.atomMapCuratorReport';
        readonly reportId: string;
        readonly summary: string;
    }[];
    readonly proposedBy: string;
    readonly proposedAt: string;
}
export interface AtomMapPatchReviewProposalOptions {
    readonly generatedAt?: string;
    readonly proposedBy?: string;
    readonly baseMapVersion?: string;
    readonly reportPath?: string;
}
export declare function createAtomMapPatchReviewProposalSnapshot(patchDraft: AtomMapCuratorPatchDraftItem, options?: AtomMapPatchReviewProposalOptions): AtomMapPatchReviewProposalSnapshot;
export declare function createAtomMapPatchReviewQueueRecord(patchDraft: AtomMapCuratorPatchDraftItem, options?: AtomMapPatchReviewProposalOptions): HumanReviewQueueRecord;
