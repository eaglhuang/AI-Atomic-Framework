/**
 * Shared types for the event-derived replay lifecycle receipt contract.
 * Producer labels are display projections only; canonical events and command
 * receipts remain the sole authority for independent closure readers.
 */

export const PARALLEL_REPLAY_LIFECYCLE_STEPS = [
  'claim',
  'bounded-intent',
  'ticket',
  'adapter-decision',
  'mutation-batch',
  'compose',
  'serializability',
  'steward-apply',
  'shared-delivery',
  'queue-revalidation-fallback',
  'wakeup',
  'close',
  'admission',
  'post-compose-semantic-validation',
  'correctness-counters'
] as const;

export type ParallelReplayLifecycleStep = (typeof PARALLEL_REPLAY_LIFECYCLE_STEPS)[number];

export type LifecycleReceiptVerdict = 'accepted' | 'rejected' | 'inconclusive';

export type ComposeDisposition = 'compose-selected' | 'revalidation-required' | 'queued';

export type TelemetryCoverageState = 'registered' | 'code-wired' | 'observed' | 'sealed-read-back';

export type CorrectnessCounterStatus = 'observed' | 'unavailable' | 'inconclusive';

export interface LifecycleTimeWindow {
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
}

export interface SemanticLifecycleReceipt {
  readonly schemaId: 'atm.parallelReplayLifecycleReceipt.v1';
  readonly step: ParallelReplayLifecycleStep;
  readonly commandPurpose: string;
  readonly taskId: string;
  readonly actorId: string;
  readonly ticketGeneration: string | null;
  readonly sharedSurface: string | null;
  readonly digest: string;
  readonly timeWindow: LifecycleTimeWindow;
  readonly command: string;
  readonly exitCode: number;
  readonly canonicalEventRef?: string | null;
  /** Display projection only; never creates evidence semantics. */
  readonly producerLabel?: string | null;
}

export interface LifecycleReceiptValidation {
  readonly schemaId: 'atm.parallelReplayLifecycleReceiptValidation.v1';
  readonly verdict: LifecycleReceiptVerdict;
  readonly reasons: readonly string[];
  readonly invariantCodes: readonly ('INV-ATM-008' | 'INV-ATM-009' | 'INV-ATM-010')[];
  readonly digest: string;
}

export interface SameFileIntentEvidence {
  readonly atomOrContentAnchors: readonly string[];
  readonly boundedSourceRanges: readonly string[];
  readonly adapterIdentity: string | null;
  readonly adapterDecision: string | null;
  readonly selectedRequestIds: readonly string[];
  readonly queuedRequestIds: readonly string[];
  readonly composeBatchMembership: readonly string[];
  readonly serializabilityProofDigest: string | null;
  readonly stewardBeforeHash: string | null;
  readonly stewardAfterHash: string | null;
  readonly sharedCommitMemberAttribution: readonly string[];
  readonly pathOnlyFileLock: boolean;
  readonly workerDirectWrite: boolean;
  readonly detachedWorktreeIsolation: boolean;
}

export interface PostComposeValidationEvidence {
  readonly candidateOutputDigest: string;
  readonly validatorReferences: readonly string[];
  readonly sealedSelectionSourceDigest: string;
  readonly executable: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly runnerOrBuildDigest: string;
  readonly startedAtMs: number;
  readonly finishedAtMs: number;
  readonly exitStatus: number | null;
  readonly derivedResult: 'pass' | 'fail' | 'inconclusive' | 'unavailable' | 'unexecuted';
  readonly serializabilityProofPresent: boolean;
  readonly canonicalWriteAuthorized: boolean;
}

export type CorrectnessCounterValue =
  | { readonly status: 'observed'; readonly value: number }
  | { readonly status: 'unavailable'; readonly reason: string }
  | { readonly status: 'inconclusive'; readonly reason: string };

export interface EventDerivedCorrectnessCounters {
  readonly schemaId: 'atm.parallelReplayCorrectnessCounters.v1';
  readonly escapedConflict: CorrectnessCounterValue;
  readonly silentOverwrite: CorrectnessCounterValue;
  readonly duplicateSideEffect: CorrectnessCounterValue;
  readonly unresolvedStarvation: CorrectnessCounterValue;
  readonly staleAuthorization: CorrectnessCounterValue;
  readonly dimensionMismatchedAuthorization: CorrectnessCounterValue;
  readonly decisionContradiction: CorrectnessCounterValue;
  readonly unexpectedBreakerTrip: CorrectnessCounterValue;
  readonly digest: string;
}

export interface BrokerDecisionOutcomePair {
  readonly schemaId: 'atm.brokerDecisionOutcomePair.v1';
  readonly decisionClass: string;
  readonly conflictAxes: readonly string[];
  readonly composeOrQueueResult: ComposeDisposition | 'blocked' | 'refused';
  readonly waitMs: number | null;
  readonly reworkCount: number | null;
  readonly ownerOverride: boolean;
  readonly delayedCorrectnessOutcome: 'correct' | 'incorrect' | 'inconclusive' | 'unavailable';
  readonly outcomeRef: string;
  readonly digest: string;
}

export interface TelemetryNodeCoverageObservation {
  readonly nodeId: string;
  readonly registered: boolean;
  readonly codeWired: boolean;
  readonly observedEventCount: number;
  readonly lastObservedAtMs: number | null;
  readonly sealedReadBackCount: number;
  readonly lastSealedReadBackAtMs: number | null;
}

export interface TelemetryObligationSealInput {
  readonly taskId: string;
  readonly declaredObligations: readonly string[];
  readonly sealedSummaryDigest?: string | null;
  readonly unavailableReceiptDigest?: string | null;
  readonly historyDigest?: string | null;
  readonly configDigest?: string | null;
}

export interface TelemetryObligationSealResult {
  readonly schemaId: 'atm.parallelReplayTelemetryObligationSeal.v1';
  readonly taskId: string;
  readonly sealed: boolean;
  readonly verdict: 'complete' | 'observability-missing' | 'incomplete';
  readonly missingObligations: readonly string[];
  readonly recoveryCommand: string | null;
  readonly compactEvidenceDigest: string | null;
  readonly digest: string;
}

export interface AppendOnlyEvidenceWrite {
  readonly writerId: string;
  readonly recordId: string;
  readonly payloadDigest: string;
  readonly observedAtMs: number;
}

export const WEAK_OR_UNRELATED_COMMAND_PATTERNS: readonly RegExp[] = [
  /(?:^|[\s"'`\\/])--version(?:\s|$)/i,
  /\bsleep\b/i,
  /\btimeout\s+\d+\b/i,
  /\becho\b/i,
  /\btrue\b/i,
  /\bfalse\b/i
];

export const STEP_PURPOSE_HINTS: Readonly<Record<ParallelReplayLifecycleStep, readonly string[]>> = {
  claim: ['claim', 'tasks claim', 'next --claim'],
  'bounded-intent': ['intent', 'bounded intent', 'proposal'],
  ticket: ['ticket', 'broker ticket', 'admission ticket'],
  'adapter-decision': ['adapter', 'format adapter'],
  'mutation-batch': ['mutation', 'batch', 'proposal batch'],
  compose: ['compose', 'composer'],
  serializability: ['serializ', 'legal-order', 'permutation'],
  'steward-apply': ['steward', 'apply'],
  'shared-delivery': ['shared delivery', 'shared-delivery', 'shared commit'],
  'queue-revalidation-fallback': ['queue', 'revalidat', 'fallback'],
  wakeup: ['wakeup', 'wake-up', 'successor wake'],
  close: ['close', 'taskflow close', 'tasks close'],
  admission: ['admission', 'broker decision', 'parallel admission'],
  'post-compose-semantic-validation': ['semantic valid', 'post-compose', 'validator'],
  'correctness-counters': ['correctness', 'counter', 'fault counter']
};
