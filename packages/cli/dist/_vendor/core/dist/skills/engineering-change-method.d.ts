export declare const ENGINEERING_CHANGE_METHOD_PROFILE_SCHEMA_ID: "atm.engineeringChangeMethodProfile.v1";
export declare const ENGINEERING_CHANGE_METHOD_FIDELITY_RECEIPT_SCHEMA_ID: "atm.engineeringChangeMethodFidelityReceipt.v1";
export type EngineeringChangeMethodProfileId = 'expand-contract' | 'tdd-oracle-fidelity' | 'review-smell-heuristics' | 'merge-conflict-intent' | 'deep-module-refactor';
export type EngineeringChangeMethodApplicability = 'required' | 'recommended' | 'not-applicable';
export interface EngineeringChangeMethodProfile {
    readonly schemaId: typeof ENGINEERING_CHANGE_METHOD_PROFILE_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly migration: {
        readonly strategy: 'none';
        readonly fromVersion: null;
        readonly notes: string;
    };
    readonly id: EngineeringChangeMethodProfileId;
    readonly title: string;
    readonly triggerEvidence: readonly string[];
    readonly applicability: readonly string[];
    readonly requiredObservations: readonly string[];
    readonly counterexamples: readonly string[];
    readonly completionEvidence: readonly string[];
    readonly rollback: readonly string[];
    readonly guardrails: readonly string[];
}
export interface EngineeringChangeMethodSelectionInput {
    readonly changeSummary: string;
    readonly changedPublicSeams?: readonly string[];
    readonly requestedMethods?: readonly EngineeringChangeMethodProfileId[];
    readonly observedSignals?: readonly string[];
}
export interface EngineeringChangeMethodSelection {
    readonly schemaId: 'atm.engineeringChangeMethodSelection.v1';
    readonly selectedProfileIds: readonly EngineeringChangeMethodProfileId[];
    readonly skippedProfileIds: readonly EngineeringChangeMethodProfileId[];
    readonly reasons: readonly string[];
    readonly profileDigest: string;
}
export interface EngineeringChangeMethodFidelityInput {
    readonly taskId: string;
    readonly profile: EngineeringChangeMethodProfile;
    readonly observations: readonly string[];
    readonly evidenceRefs: readonly string[];
    readonly counterexamplesCleared: readonly string[];
    readonly rollbackRefs: readonly string[];
    readonly independentOracleRefs?: readonly string[];
    readonly bothSideIntentRefs?: readonly string[];
    readonly oldFormUsageQueryRef?: string | null;
    readonly zeroCallerGateRef?: string | null;
    readonly smellHeuristicPolicyRef?: string | null;
}
export interface EngineeringChangeMethodFidelityReceipt {
    readonly schemaId: typeof ENGINEERING_CHANGE_METHOD_FIDELITY_RECEIPT_SCHEMA_ID;
    readonly specVersion: '0.1.0';
    readonly migration: {
        readonly strategy: 'none';
        readonly fromVersion: null;
        readonly notes: string;
    };
    readonly taskId: string;
    readonly profileId: EngineeringChangeMethodProfileId;
    readonly valid: boolean;
    readonly admission: 'admit-method' | 'fail-closed';
    readonly missing: readonly string[];
    readonly antiPatterns: readonly string[];
    readonly receiptDigest: string;
}
export declare function selectEngineeringChangeMethodProfiles(profiles: readonly EngineeringChangeMethodProfile[], input: EngineeringChangeMethodSelectionInput): EngineeringChangeMethodSelection;
export declare function evaluateEngineeringChangeMethodFidelity(input: EngineeringChangeMethodFidelityInput): EngineeringChangeMethodFidelityReceipt;
