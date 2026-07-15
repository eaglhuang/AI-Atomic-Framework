import { type TeamContextManifest } from '../../../../core/src/team-runtime/context-manifest.ts';
import { type TeamContributionManifest } from '../../../../core/src/team-runtime/contribution-manifest.ts';
import type { TeamProviderId } from '../../../../core/src/team-runtime/provider-contract.ts';
import type { TeamShadowWorkspaceProviderPlan } from './shadow-workspace.ts';
export type TeamWorkGroup = {
    readonly groupId: string;
    readonly role: string;
    readonly independent: boolean;
    readonly dependencies?: readonly string[];
    readonly allowedFiles: readonly string[];
    readonly capability: string;
};
export type TeamModelOption = {
    readonly providerId: TeamProviderId;
    readonly modelId: string;
    readonly plan: string;
    readonly capability: string;
    readonly costPerUnit: number;
};
export type TeamShadowSchedule = {
    readonly schemaId: 'atm.teamShadowSchedule.v1';
    readonly taskId: string;
    readonly shadowOnly: true;
    readonly baseCommit: string;
    readonly scopeEpoch: number;
    readonly catalogVersion: string;
    readonly fanOutCap: number;
    readonly spendingCeiling: number;
    readonly quotaProbeDigest: string;
    readonly reservations: readonly TeamReservation[];
    readonly rosterFingerprint: TeamRosterFingerprint;
    readonly dagStreamingReadyGroups: readonly string[];
    readonly reviewerLane: TeamReviewerLane | null;
    readonly workspaceProvider: TeamShadowWorkspaceProviderPlan | null;
};
export type TeamReservation = {
    readonly reservationId: string;
    readonly groupId: string;
    readonly roles: readonly string[];
    readonly dependencies: readonly string[];
    readonly collapsedExecutor: boolean;
    readonly contextManifest: TeamContextManifest;
    readonly provider: {
        readonly providerId: TeamProviderId;
        readonly modelId: string;
        readonly plan: string;
    };
    readonly sealedInputs: {
        readonly baseCommit: string;
        readonly scopeEpoch: number;
        readonly contextManifestDigest: string;
        readonly spendingCeiling: number;
    };
    readonly reversible: true;
};
export type TeamReviewerLane = {
    readonly enabled: true;
    readonly contextManifest: TeamContextManifest;
    readonly cleanContext: true;
    readonly barrierRequired: true;
};
export type TeamRosterFingerprint = {
    readonly schemaId: 'atm.teamRosterFingerprint.v1';
    readonly roleGraph: readonly string[];
    readonly executorCollapseDecision: 'single-agent' | 'team-expanded' | 'team-collapsed';
    readonly providerModelPlan: readonly string[];
    readonly pricingCatalogVersion: string;
    readonly contextManifestHashes: readonly string[];
    readonly promptCachePolicy: string;
    readonly fanOutCap: number;
    readonly quotaProbeDigest: string;
    readonly digest: string;
};
export declare function createTeamShadowSchedule(input: {
    readonly taskId: string;
    readonly baseCommit: string;
    readonly scopeEpoch: number;
    readonly workGroups: readonly TeamWorkGroup[];
    readonly modelOptions: readonly TeamModelOption[];
    readonly catalogVersion: string;
    readonly fanOutCap: number;
    readonly spendingCeiling: number;
    readonly quotaProbeDigest: string;
    readonly acceptanceCriteria: readonly string[];
    readonly promptCachePolicy?: 'stable-prefix-preferred' | 'cache-disabled';
    readonly cleanContextReviewer?: boolean;
    readonly workspaceProvider?: TeamShadowWorkspaceProviderPlan | null;
}): TeamShadowSchedule;
export declare function createShadowContribution(input: {
    readonly taskId: string;
    readonly reservation: TeamReservation;
    readonly overlay: unknown;
    readonly changedFiles: readonly string[];
    readonly reviewerLane?: TeamReviewerLane | null;
}): TeamContributionManifest;
