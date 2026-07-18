export type AtomMapCuratorBehaviorId = 'behavior.compose' | 'behavior.merge' | 'behavior.dedup-merge' | 'behavior.sweep';
export type AtomMapCuratorSignalKind =
  | 'caller-graph'
  | 'input-output-overlap'
  | 'recurring-failure-cluster'
  | 'zero-caller-sweep'
  | 'broker-split-suggestion';
export type AtomMapCuratorMutabilityPolicy = 'mutable' | 'frozen-after-release' | 'immutable';

export interface AtomMapCuratorThresholds {
  readonly minCallerGraphOccurrences: number;
  readonly minInputOutputOverlapScore: number;
  readonly minRecurringFailureCount: number;
  readonly minConfidence: number;
}

export interface CallerGraphSequenceInput {
  readonly sequenceId: string;
  readonly atomIds: readonly string[];
  readonly occurrenceCount: number;
  readonly evidenceIds: readonly string[];
  readonly targetMapId: string;
  readonly targetMapVersion?: string;
  readonly confidence?: number;
  readonly targetMutabilityPolicy?: AtomMapCuratorMutabilityPolicy;
}

export interface InputOutputOverlapInput {
  readonly overlapId: string;
  readonly sourceAtomIds: readonly string[];
  readonly targetAtomId: string;
  readonly overlapScore: number;
  readonly evidenceIds: readonly string[];
  readonly targetMapId: string;
  readonly targetMapVersion?: string;
  readonly mode: 'merge' | 'dedup-merge';
  readonly confidence?: number;
  readonly targetMutabilityPolicy?: AtomMapCuratorMutabilityPolicy;
}

export interface RecurringFailureClusterInput {
  readonly clusterId: string;
  readonly atomIds: readonly string[];
  readonly failureCount: number;
  readonly evidenceIds: readonly string[];
  readonly targetMapId: string;
  readonly targetMapVersion?: string;
  readonly action: 'sweep';
  readonly zeroCallerAtomIds?: readonly string[];
  readonly confidence?: number;
  readonly targetMutabilityPolicy?: AtomMapCuratorMutabilityPolicy;
}

export interface BrokerSuggestedAtomInput {
  readonly atomId: string;
  readonly atomCid: string;
  readonly role: 'focus' | 'before' | 'after';
  readonly summary: string;
  readonly sourceRange: {
    readonly filePath: string;
    readonly lineStart: number;
    readonly lineEnd: number;
  };
}

export interface BrokerSplitSuggestionInput {
  readonly candidateId: string;
  readonly ownerAtomId: string;
  readonly ownerAtomCid?: string;
  readonly targetMapId: string;
  readonly targetMapVersion?: string;
  readonly targetFile: string;
  readonly sourceEvidenceIds: readonly string[];
  readonly confidence?: number;
  readonly targetMutabilityPolicy?: AtomMapCuratorMutabilityPolicy;
  readonly conflictRegion: {
    readonly filePath: string;
    readonly lineStart: number;
    readonly lineEnd: number;
  };
  readonly suggestedAtoms: readonly BrokerSuggestedAtomInput[];
}

export interface AtomMapCuratorInput {
  readonly repositoryRoot: string;
  readonly reportPath?: string;
  readonly curatorName?: string;
  readonly generatedAt?: string;
  readonly proposedBy?: string;
  readonly thresholds?: Partial<AtomMapCuratorThresholds>;
  readonly callerGraphs?: readonly CallerGraphSequenceInput[];
  readonly inputOutputOverlaps?: readonly InputOutputOverlapInput[];
  readonly recurringFailureClusters?: readonly RecurringFailureClusterInput[];
  readonly brokerSplitSuggestions?: readonly BrokerSplitSuggestionInput[];
}

export interface AtomMapCuratorObservation {
  readonly candidateId: string;
  readonly signalKind: AtomMapCuratorSignalKind;
  readonly reasons: readonly string[];
}

export interface AtomMapCuratorProposalDraftItem {
  readonly candidateId: string;
  readonly behaviorId: AtomMapCuratorBehaviorId;
  readonly signalKind: AtomMapCuratorSignalKind;
  readonly targetMapId: string;
  readonly sourceEvidenceIds: readonly string[];
  readonly autoPromoteEligible: boolean;
  readonly proposal: Record<string, unknown>;
}

export interface AtomMapCuratorPatchDraftOperation {
  readonly op: 'replace-owner-range' | 'add-child-atom-row' | 'rebuild-projection';
  readonly target: string;
  readonly summary: string;
  readonly payload?: Record<string, unknown>;
}

export interface AtomMapCuratorPatchDraftItem {
  readonly candidateId: string;
  readonly draftKind: 'atom-map-patch';
  readonly signalKind: 'broker-split-suggestion';
  readonly targetMapId: string;
  readonly sourceEvidenceIds: readonly string[];
  readonly patchFiles: readonly string[];
  readonly ownerAtomId: string;
  readonly conflictRegion: BrokerSplitSuggestionInput['conflictRegion'];
  readonly suggestedAtoms: readonly BrokerSuggestedAtomInput[];
  readonly summary: string;
  readonly rationale: string;
  readonly requiresHumanReview: true;
  readonly operations: readonly AtomMapCuratorPatchDraftOperation[];
}

export interface AtomMapCuratorReport {
  readonly schemaId: 'atm.atomMapCuratorReport';
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none' | 'additive' | 'breaking';
    readonly fromVersion: string | null;
    readonly notes: string;
  };
  readonly reportId: string;
  readonly generatedAt: string;
  readonly curatorName: string;
  readonly thresholds: AtomMapCuratorThresholds;
  readonly summary: {
    readonly callerGraphSignals: number;
    readonly inputOutputOverlapSignals: number;
    readonly recurringFailureClusterSignals: number;
    readonly brokerSplitSuggestionSignals: number;
    readonly proposalDrafts: number;
    readonly blockedProposalDrafts: number;
    readonly patchDrafts: number;
    readonly observationOnly: number;
  };
  readonly observations: readonly AtomMapCuratorObservation[];
  readonly proposalDrafts: readonly AtomMapCuratorProposalDraftItem[];
  readonly patchDrafts: readonly AtomMapCuratorPatchDraftItem[];
  readonly empty: boolean;
}
