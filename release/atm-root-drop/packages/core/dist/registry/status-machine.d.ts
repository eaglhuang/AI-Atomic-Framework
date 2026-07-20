import type { RegistryEntryStatus, RegistryGovernanceTier } from '../index';
export declare const registryEntryStatuses: readonly ["draft", "validated", "active", "transitioning", "deprecated", "expired", "quarantined"];
export declare const registryGovernanceTiers: readonly ["foundation", "governed", "standard", "experimental"];
export declare const registryTransitionActions: readonly ["transition.propose", "transition.promote", "transition.quarantine", "behavior.split", "behavior.merge", "behavior.dedup-merge", "behavior.evolve", "behavior.sweep", "behavior.expire", "behavior.polymorphize", "behavior.compose", "behavior.infect", "behavior.atomize", "experience.extract-skill", "experience.amend-skill", "experience.memory-nudge"];
export declare const registryMutabilityPolicies: readonly ["mutable", "frozen-after-release", "immutable"];
export declare const registryReviewDispositions: readonly ["approve", "non-fatal-reject", "fatal-reject"];
export type RegistryTransitionAction = typeof registryTransitionActions[number];
export type RegistryMutabilityPolicy = typeof registryMutabilityPolicies[number];
export type RegistryReviewDisposition = typeof registryReviewDispositions[number];
export interface RegistryTransitionRule {
    readonly entryTypes: readonly ('atom' | 'map')[];
    readonly fromStatuses: readonly RegistryEntryStatus[];
    readonly toStatus: RegistryEntryStatus;
    readonly secondaryStatuses?: readonly RegistryEntryStatus[];
    readonly minSourceCount?: number;
    readonly maxSourceCount?: number;
    readonly policeOnly?: boolean;
    readonly requiresZeroCallers?: boolean;
    readonly requiresTtlExpired?: boolean;
    readonly allowedMutabilityPolicies?: readonly RegistryMutabilityPolicy[];
}
export declare const registryTransitionRules: Readonly<Record<RegistryTransitionAction, RegistryTransitionRule>>;
export interface RegistryTransitionContext {
    readonly entryType: 'atom' | 'map';
    readonly atomId?: string;
    readonly mapId?: string;
    readonly status: RegistryEntryStatus;
    readonly action: RegistryTransitionAction;
    readonly governanceTier?: RegistryGovernanceTier | string | null;
    readonly sourceStatuses?: readonly RegistryEntryStatus[];
    readonly mutabilityPolicy?: RegistryMutabilityPolicy | string | null;
    readonly callerCount?: number;
    readonly ttlExpired?: boolean;
    readonly policeAction?: boolean;
    readonly stageStatuses?: readonly RegistryEntryStatus[];
}
export interface RegistryTransitionEvaluation {
    readonly ok: boolean;
    readonly entryLabel: string;
    readonly entryType: 'atom' | 'map';
    readonly action: RegistryTransitionAction;
    readonly fromStatuses: readonly RegistryEntryStatus[];
    readonly toStatus: RegistryEntryStatus | null;
    readonly secondaryStatuses: readonly RegistryEntryStatus[];
    readonly governanceTier: RegistryGovernanceTier;
    readonly issues: readonly string[];
    readonly policeAction: boolean;
    readonly pendingQuarantineRequest: boolean;
}
export interface RegistryReviewDispositionContext {
    readonly entryType: 'atom' | 'map';
    readonly atomId?: string;
    readonly mapId?: string;
    readonly status: RegistryEntryStatus;
    readonly governanceTier?: RegistryGovernanceTier | string | null;
    readonly reviewDisposition: RegistryReviewDisposition;
    readonly policeAction?: boolean;
}
export interface RegistryReviewDispositionEvaluation {
    readonly ok: boolean;
    readonly entryLabel: string;
    readonly entryType: 'atom' | 'map';
    readonly reviewDisposition: RegistryReviewDisposition;
    readonly fromStatus: RegistryEntryStatus;
    readonly toStatus: RegistryEntryStatus;
    readonly governanceTier: RegistryGovernanceTier;
    readonly pendingQuarantineRequest: boolean;
    readonly issues: readonly string[];
}
export declare function isRegistryEntryStatus(value: unknown): value is RegistryEntryStatus;
export declare function isRegistryGovernanceTier(value: unknown): value is RegistryGovernanceTier;
export declare function normalizeRegistryEntryStatus(value: unknown): RegistryEntryStatus;
export declare function normalizeRegistryGovernanceTier(value: unknown): RegistryGovernanceTier;
export declare function resolveRegistryDefaultGovernanceTier(status: RegistryEntryStatus, entryType: 'atom' | 'map'): RegistryGovernanceTier;
export declare function resolveRegistryEntryLabel(entry: {
    readonly atomId?: string;
    readonly mapId?: string;
}): string;
export declare function evaluateRegistryTransition(input: RegistryTransitionContext): RegistryTransitionEvaluation;
export declare function evaluateReviewDisposition(input: RegistryReviewDispositionContext): RegistryReviewDispositionEvaluation;
