import type { ShadowComparisonReport } from '../maps/shadow-comparator.ts';
export type AutomationLevel = 'off' | 'proposal-only';
export interface ProgressionGate {
    minShadowDays?: number;
    minOutputConsistencyRate?: number;
    minSampleSize?: number;
    requireEdgeContractPass?: boolean;
    requireEvidenceDraft?: boolean;
}
export interface ProgressionPolicy {
    schemaId: 'atm.progressionPolicy';
    mapId: string;
    automationLevel: AutomationLevel;
    gates: {
        'draft->shadow'?: ProgressionGate;
        'shadow->canary'?: ProgressionGate;
        'canary->active'?: ProgressionGate;
    };
    pausedAt?: string;
    pausedBy?: string;
}
export interface ProgressionProposal {
    schemaId: 'atm.progressionProposal';
    mapId: string;
    proposedAt: string;
    fromLane: string;
    toLane: string;
    status: 'pending-human-approval';
    canPromote: true;
    rollbackReadiness: string;
    evidence: {
        outputConsistencyRate?: number;
        sampleSize?: number;
        shadowPeriodDays?: number;
        hasEdgeContractPass: boolean;
        hasEvidenceDraft: boolean;
    };
}
export interface ProgressionCheckResult {
    mapId: string;
    checkedAt: string;
    canPromote: boolean;
    blockedReasons: string[];
    currentLane?: string;
    nextLane?: string;
    proposal?: ProgressionProposal;
    nextProposalHint?: string;
    automationLevel: AutomationLevel;
    paused: boolean;
}
export declare function readProgressionPolicy(repositoryRoot: string, mapId: string): ProgressionPolicy;
export declare function writeProgressionPolicy(repositoryRoot: string, policy: ProgressionPolicy): void;
export declare function pauseProgression(repositoryRoot: string, mapId: string, pausedBy?: string): ProgressionPolicy;
export declare function resumeProgression(repositoryRoot: string, mapId: string): ProgressionPolicy;
export declare function checkProgression(repositoryRoot: string, mapId: string, shadowReport?: ShadowComparisonReport | null): ProgressionCheckResult;
