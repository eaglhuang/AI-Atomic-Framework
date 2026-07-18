import type { ReplacementModeWithEvidence, ReplacementModeValue } from './types.ts';
export declare const ReplacementMode: Readonly<{
    Draft: "draft";
    Shadow: "shadow";
    Canary: "canary";
    Active: "active";
    LegacyRetired: "legacy-retired";
}>;
export declare const orderedReplacementModes: readonly ReplacementModeValue[];
export declare const evidenceRequirementByTarget: Readonly<Record<ReplacementModeWithEvidence, string>>;
