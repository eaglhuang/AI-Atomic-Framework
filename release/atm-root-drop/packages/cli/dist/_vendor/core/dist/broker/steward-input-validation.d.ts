import type { StewardValidationIssue } from './steward.js';
import type { MergePlan, PatchProposal } from './types.js';
/** A steward must be neutral: it may not share an identity with any proposer it applies. */
export declare function checkStewardIsNotProposer(stewardId: string | undefined, proposals: readonly PatchProposal[]): StewardValidationIssue[];
export declare function validateStewardInputs(input: {
    readonly cwd: string;
    readonly stewardId?: string;
    readonly mergePlan: MergePlan;
    readonly proposals: readonly PatchProposal[];
    readonly scopeFiles: readonly string[];
}): StewardValidationIssue[];
