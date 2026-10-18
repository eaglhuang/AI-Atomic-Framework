import type { EvidenceRecord, WorkItemRef } from '@ai-atomic-framework/core';
export { AtomLifecycleMode } from './lifecycle.js';
export type { AtomLifecycleHookContext, AtomLifecycleHookResult, AtomLifecycleHooks, AtomLifecycleModeValue, QualityMetricsComparator, QualityMetricsComparison, QualityMetricsSnapshot, UpgradeProposal, UpgradeProposalAdapter, UpgradeProposalRequest, VersionResolution, VersionResolver, VersionResolverRequest } from './lifecycle.js';
export type { EffectNode, EffectNodeContext, EffectNodeMode, EffectNodeResult, ExecuteAgentTaskEffectNode, ExecuteAgentTaskInput } from './effect-node.js';
export type { CapabilityContext, CapabilityDescriptor, CapabilityKind, CapabilityProvider, CapabilityRegistry, CapabilityResult } from './capability.js';
export type { AtomizeAdapterRequest, HostGate, InfectAdapterRequest, MutationPolicy, NoTouchZone, ProjectAdapter, ProjectAdapterContext, ProjectAdapterDryRunPatchContract, ProjectAdapterDryRunResult, ProjectAdapterLegacyUriResolution, ProjectAdapterNeutralitySummary, ProjectAdapterResult } from './project-adapter.js';
export type { LanguageAdapter, LanguageAdapterAliasResolutionStance, LanguageAdapterCanonicalizationPolicy, LanguageAdapterDecoratorResolutionStance, LanguageAdapterMessage, LanguageAdapterManifest, LanguageAdapterReport, LanguageAdapterStaticCheckCost, LanguageAdapterStaticCheckKind, LanguageAdapterStaticCheckPlan, LanguageAdapterStaticCheckScope, LanguageAdapterStaticCheckSource, LanguageAdapterStaticCheckTier, LanguageAdapterValidationRequest, LanguageProjectProfile, LanguageAdapterSymbolCanonicalizationManifest, LanguageSourceFile } from './language-adapter.js';
export type { AtomCandidate, AtomCandidateConfidence, AtomCandidateDetectionMethod, AtomCandidateDiscoveryFilters, AtomCandidateDiscoveryRequest, AtomCandidateKind, EnclosingUnit, EnclosingUnitConfidenceClass, EnclosingUnitFileRange, EnclosingUnitKind, AtomizationPlan, AtomizationPlanRequest, AtomizationPlanStep, AtomizationPlanningAdapter, VirtualAtom, VirtualAtomDetectionMethod, VirtualAtomLayer } from './atomization-planning.js';
export { isAtomCandidate, isAtomizationPlan, isEnclosingUnit, isVirtualAtom } from './atomization-planning.js';
export type { InjectorPlugin, InjectorPluginContext } from './injector-plugin.js';
export type { ExternalTaskSourcePlugin, ExternalTaskSourceInput, ParsedExternalTask, ExternalTaskValidationResult, ExternalTaskGenerationIntent, GeneratedExternalTaskCard } from './external-task-source.js';
export type { AtomicConsumerContractCase, AtomicConsumerContractGateConfig, AtomicDefaultGateConfig, AtomicHealthGateId, AtomicImmutabilityGateConfig, AtomicSideEffectGateConfig, AtomicTestRunnerConfig, TestRunnerCommand, TestRunnerCommandKind, TestRunnerOutcomeStatus, TestRunnerPlugin, TestRunnerPluginContext, TestRunnerPluginPlan, TestRunnerPluginReference, TestRunnerPluginSupport } from './test-runner.js';
export type { ArtifactStore, ContextBudgetDecision, ContextBudgetEvaluationInput, ContextBudgetEvaluationResult, ContextBudgetGuard, ContextBudgetPolicy, GovernanceAdapter, GovernanceLayout, ContextSummaryStore, DocumentIndex, EvidenceStore, GovernanceStores, LockStore, LogStore, MarkdownJsonStateStore, MemoryScope, MemorySearchResult, MemoryStoreAdapter, RegistryStore, RuleGuard, RunReportStore, ShardStore, StoreLifecycle, TaskStore } from './governance/index.js';
export { defaultGovernanceLayout } from './governance/index.js';
export type { PoliceCheckContract, PoliceCheckKind, PoliceCheckResult, LifecyclePoliceFinding, LifecyclePoliceNotice, LifecyclePoliceReport, LifecyclePoliceRoute, LifecyclePoliceSeverity, LifecyclePoliceTrigger, EvidenceRef, PoliceFamilyGateReport, PoliceFamilyMode, PoliceFamilyName, PoliceFamilyProfile, PoliceFamilyReport, PoliceFamilyStatus, PoliceFinding, PoliceFindingAction, PoliceFindingMode, PoliceFindingSeverity, PoliceLifecycleMode, PoliceReport, PoliceSeverity, PoliceViolation } from './police.js';
export type { AtomBehavior, AtomBehaviorContext, AtomBehaviorInput, AtomBehaviorOutput, AtomBehaviorRegistryTransition, AtomBehaviorRollbackPlan, EvolveDelegationTarget } from './behavior.js';
export { EVOLVE_DELEGATION_TARGET } from './behavior.js';
export { BehaviorRegistry } from './behavior-registry.js';
export { defaultEvidencePatternDetectorThresholds, detectEvidencePatterns } from './detector/index.js';
export type { EvidencePatternDetectorInput, EvidencePatternDetectorReport, EvidencePatternDetectorThresholds, EvidencePatternGroup, EvidencePatternRecommendation, EvidencePatternTargetKind } from './detector/index.js';
export { ConversationDrivenExtractionError, ConversationTranscriptReviewError, conversationPatchDraftBridgeName, conversationFeedbackRendererName, conversationReviewFindingKinds, conversationEvidenceExtractorName, createConversationFeedbackReport, createConversationSuppressionKey, conversationTranscriptReviewerName, draftConversationPatches, reviewConversationTranscript, extractEvidenceFromConversations, upsertConversationFeedbackChoiceState } from './conversation/index.js';
export type { ConversationAtomUpgradeProposalDraft, ConversationDrivenExtractionErrorCode, ConversationEvidenceExtractionInput, ConversationEvidenceExtractionReport, ConversationPatchDraftBridgeInput, ConversationPatchDraftGateResult, ConversationPatchDraftItem, ConversationPatchDraftOperation, ConversationPatchDraftProposalInput, ConversationPatchDraftReport, ConversationPatchDraftSurface, ConversationFeedbackChoiceState, ConversationFeedbackEvent, ConversationFeedbackLoopInput, ConversationFeedbackPromptAction, ConversationFeedbackReport, ConversationFeedbackSummary, ConversationFeedbackTargetSurface, ConversationFeedbackUserChoice, ConversationTranscript, ConversationTranscriptReviewErrorCode, ConversationTranscriptReviewInput, ConversationTranscriptTurn, ConversationReviewFinding, ConversationReviewFindingKind, ConversationReviewFindingsReport, ConversationReviewPatchDraft, ConversationReviewPatchDraftKind, ConversationReviewRecommendation, ConversationReviewRecommendedTarget, ConversationLog, ConversationTurn, ConversationTurnIntent } from './conversation/index.js';
export declare const pluginSdkPackage: {
    readonly packageName: "@ai-atomic-framework/plugin-sdk";
    readonly packageRole: "plugin-capability-interfaces";
    readonly packageVersion: "0.0.0";
};
export interface GovernancePluginContext {
    readonly workItem: WorkItemRef;
    readonly repositoryRoot: string;
}
export interface GovernancePluginResult {
    readonly ok: boolean;
    readonly evidence: readonly EvidenceRecord[];
    readonly messages: readonly string[];
}
export interface GovernancePlugin {
    readonly pluginName: string;
    run(context: GovernancePluginContext): Promise<GovernancePluginResult>;
}
