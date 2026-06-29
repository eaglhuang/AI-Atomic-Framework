import type { EvidenceRecord, WorkItemRef } from '@ai-atomic-framework/core';
export { AtomLifecycleMode } from './lifecycle';
export type {
  AtomLifecycleHookContext,
  AtomLifecycleHookResult,
  AtomLifecycleHooks,
  AtomLifecycleModeValue,
  QualityMetricsComparator,
  QualityMetricsComparison,
  QualityMetricsSnapshot,
  UpgradeProposal,
  UpgradeProposalAdapter,
  UpgradeProposalRequest,
  VersionResolution,
  VersionResolver,
  VersionResolverRequest
} from './lifecycle';
export type {
  EffectNode,
  EffectNodeContext,
  EffectNodeMode,
  EffectNodeResult,
  ExecuteAgentTaskEffectNode,
  ExecuteAgentTaskInput
} from './effect-node';
export type {
  CapabilityContext,
  CapabilityDescriptor,
  CapabilityKind,
  CapabilityProvider,
  CapabilityRegistry,
  CapabilityResult
} from './capability';
export type {
  AtomizeAdapterRequest,
  HostGate,
  InfectAdapterRequest,
  MutationPolicy,
  NoTouchZone,
  ProjectAdapter,
  ProjectAdapterContext,
  ProjectAdapterDryRunPatchContract,
  ProjectAdapterDryRunResult,
  ProjectAdapterLegacyUriResolution,
  ProjectAdapterNeutralitySummary,
  ProjectAdapterResult
} from './project-adapter';
export type {
  LanguageAdapter,
  LanguageAdapterAliasResolutionStance,
  LanguageAdapterCanonicalizationPolicy,
  LanguageAdapterDecoratorResolutionStance,
  LanguageAdapterMessage,
  LanguageAdapterManifest,
  LanguageAdapterReport,
  LanguageAdapterValidationRequest,
  LanguageProjectProfile,
  LanguageAdapterSymbolCanonicalizationManifest,
  LanguageSourceFile
} from './language-adapter';
export type {
  AtomCandidate,
  AtomCandidateConfidence,
  AtomCandidateDetectionMethod,
  AtomCandidateDiscoveryFilters,
  AtomCandidateDiscoveryRequest,
  AtomCandidateKind,
  EnclosingUnit,
  EnclosingUnitConfidenceClass,
  EnclosingUnitFileRange,
  EnclosingUnitKind,
  AtomizationPlan,
  AtomizationPlanRequest,
  AtomizationPlanStep,
  AtomizationPlanningAdapter,
  VirtualAtom,
  VirtualAtomDetectionMethod,
  VirtualAtomLayer
} from './atomization-planning';
export { isAtomCandidate, isAtomizationPlan, isEnclosingUnit, isVirtualAtom } from './atomization-planning';
export type { InjectorPlugin, InjectorPluginContext } from './injector-plugin';
export type {
  ExternalTaskSourcePlugin,
  ExternalTaskSourceInput,
  ParsedExternalTask,
  ExternalTaskValidationResult,
  ExternalTaskGenerationIntent,
  GeneratedExternalTaskCard
} from './external-task-source';
export type {
  AtomicConsumerContractCase,
  AtomicConsumerContractGateConfig,
  AtomicDefaultGateConfig,
  AtomicHealthGateId,
  AtomicImmutabilityGateConfig,
  AtomicSideEffectGateConfig,
  AtomicTestRunnerConfig,
  TestRunnerCommand,
  TestRunnerCommandKind,
  TestRunnerOutcomeStatus,
  TestRunnerPlugin,
  TestRunnerPluginContext,
  TestRunnerPluginPlan,
  TestRunnerPluginReference,
  TestRunnerPluginSupport
} from './test-runner';
export type {
  ArtifactStore,
  ContextBudgetDecision,
  ContextBudgetEvaluationInput,
  ContextBudgetEvaluationResult,
  ContextBudgetGuard,
  ContextBudgetPolicy,
  GovernanceAdapter,
  GovernanceLayout,
  ContextSummaryStore,
  DocumentIndex,
  EvidenceStore,
  GovernanceStores,
  LockStore,
  LogStore,
  MarkdownJsonStateStore,
  MemoryScope,
  MemorySearchResult,
  MemoryStoreAdapter,
  RegistryStore,
  RuleGuard,
  RunReportStore,
  ShardStore,
  StoreLifecycle,
  TaskStore
} from './governance';
export { defaultGovernanceLayout } from './governance';
export type {
  PoliceCheckContract,
  PoliceCheckKind,
  PoliceCheckResult,
  LifecyclePoliceFinding,
  LifecyclePoliceNotice,
  LifecyclePoliceReport,
  LifecyclePoliceRoute,
  LifecyclePoliceSeverity,
  LifecyclePoliceTrigger,
  EvidenceRef,
  PoliceFamilyGateReport,
  PoliceFamilyMode,
  PoliceFamilyName,
  PoliceFamilyProfile,
  PoliceFamilyReport,
  PoliceFamilyStatus,
  PoliceFinding,
  PoliceFindingAction,
  PoliceFindingMode,
  PoliceFindingSeverity,
  PoliceLifecycleMode,
  PoliceReport,
  PoliceSeverity,
  PoliceViolation
} from './police';
export type {
  AtomBehavior,
  AtomBehaviorContext,
  AtomBehaviorInput,
  AtomBehaviorOutput,
  AtomBehaviorRegistryTransition,
  AtomBehaviorRollbackPlan,
  EvolveDelegationTarget
} from './behavior';
export { EVOLVE_DELEGATION_TARGET } from './behavior';
export { BehaviorRegistry } from './behavior-registry';
export {
  defaultEvidencePatternDetectorThresholds,
  detectEvidencePatterns
} from './detector';
export type {
  EvidencePatternDetectorInput,
  EvidencePatternDetectorReport,
  EvidencePatternDetectorThresholds,
  EvidencePatternGroup,
  EvidencePatternRecommendation,
  EvidencePatternTargetKind
} from './detector';
export {
  ConversationDrivenExtractionError,
  ConversationTranscriptReviewError,
  conversationPatchDraftBridgeName,
  conversationFeedbackRendererName,
  conversationReviewFindingKinds,
  conversationEvidenceExtractorName,
  createConversationFeedbackReport,
  createConversationSuppressionKey,
  conversationTranscriptReviewerName,
  draftConversationPatches,
  reviewConversationTranscript,
  extractEvidenceFromConversations,
  upsertConversationFeedbackChoiceState
} from './conversation';
export type {
  ConversationAtomUpgradeProposalDraft,
  ConversationDrivenExtractionErrorCode,
  ConversationEvidenceExtractionInput,
  ConversationEvidenceExtractionReport,
  ConversationPatchDraftBridgeInput,
  ConversationPatchDraftGateResult,
  ConversationPatchDraftItem,
  ConversationPatchDraftOperation,
  ConversationPatchDraftProposalInput,
  ConversationPatchDraftReport,
  ConversationPatchDraftSurface,
  ConversationFeedbackChoiceState,
  ConversationFeedbackEvent,
  ConversationFeedbackLoopInput,
  ConversationFeedbackPromptAction,
  ConversationFeedbackReport,
  ConversationFeedbackSummary,
  ConversationFeedbackTargetSurface,
  ConversationFeedbackUserChoice,
  ConversationTranscript,
  ConversationTranscriptReviewErrorCode,
  ConversationTranscriptReviewInput,
  ConversationTranscriptTurn,
  ConversationReviewFinding,
  ConversationReviewFindingKind,
  ConversationReviewFindingsReport,
  ConversationReviewPatchDraft,
  ConversationReviewPatchDraftKind,
  ConversationReviewRecommendation,
  ConversationReviewRecommendedTarget,
  ConversationLog,
  ConversationTurn,
  ConversationTurnIntent
} from './conversation';

export const pluginSdkPackage = {
  packageName: '@ai-atomic-framework/plugin-sdk',
  packageRole: 'plugin-capability-interfaces',
  packageVersion: '0.0.0'
} as const;

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
