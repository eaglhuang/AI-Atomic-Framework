import type { MergePlan, PatchProposal } from './types.ts';
export interface BrokerComposeResult {
    readonly ok: boolean;
    readonly mergePlan: MergePlan;
}
export declare function composeBrokerProposals(proposals: readonly PatchProposal[]): BrokerComposeResult;
