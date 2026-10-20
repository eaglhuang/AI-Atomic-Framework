import type { MergePlan, PatchProposal } from './types.js';
import { type SealedValidatorSelection } from './patch-candidate-materializer.js';
export interface BrokerComposeResult {
    readonly ok: boolean;
    readonly mergePlan: MergePlan;
}
/**
 * Capability-driven validator union for a compose result.
 * No task id, path, language, or date branch — only declared proposal refs plus
 * optional adapter/catalog capability lists supplied by the caller.
 */
export declare function sealPostComposeValidatorsForProposals(input: {
    readonly proposals: readonly PatchProposal[];
    readonly adapterStaticChecks?: readonly string[];
    readonly catalogTargetedTests?: readonly string[];
}): SealedValidatorSelection;
export declare function composeBrokerProposals(proposals: readonly PatchProposal[]): BrokerComposeResult;
