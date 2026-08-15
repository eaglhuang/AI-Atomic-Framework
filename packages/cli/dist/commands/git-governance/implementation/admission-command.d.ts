import type { PatchProposal } from "../../../../../core/src/broker/types.ts";
type LegacyValue = ReturnType<typeof JSON.parse>;
export declare function runGitAdmission(options: LegacyValue): import("../../shared.ts").CommandResult;
export declare function resolveGitAdmissionStewardAction(options: LegacyValue, result: LegacyValue): {
    ok: boolean;
    mode: string;
    mergePlan: import("@ai-atomic-framework/core").MergePlan;
    plan: import("@ai-atomic-framework/core").StewardPlan;
    proposal: PatchProposal;
    applyEvidence: import("@ai-atomic-framework/core").StewardApplyEvidence;
    recommendedNextStep: string;
} | {
    ok: boolean;
    mode: string;
    mergePlan: import("@ai-atomic-framework/core").MergePlan;
    plan: import("@ai-atomic-framework/core").StewardPlan;
    proposal: PatchProposal;
    applyEvidence: null;
    recommendedNextStep: string;
} | null;
export declare function buildGitAdmissionComposerInput(options: LegacyValue, result: LegacyValue): {
    proposal: PatchProposal;
};
export declare function buildUnifiedPatch(filePath: LegacyValue, beforeContent: LegacyValue, afterContent: LegacyValue): string;
export declare function hashBuffer(buffer: LegacyValue): string;
export declare function shortHash(value: LegacyValue): string;
export {};
