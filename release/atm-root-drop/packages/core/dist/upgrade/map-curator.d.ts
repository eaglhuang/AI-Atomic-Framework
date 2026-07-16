import type { AtomMapCuratorInput, AtomMapCuratorReport, AtomMapCuratorThresholds } from './map-curator/types.ts';
export type { AtomMapCuratorBehaviorId, AtomMapCuratorInput, AtomMapCuratorMutabilityPolicy, AtomMapCuratorObservation, AtomMapCuratorPatchDraftItem, AtomMapCuratorPatchDraftOperation, AtomMapCuratorProposalDraftItem, AtomMapCuratorReport, AtomMapCuratorSignalKind, AtomMapCuratorThresholds, BrokerSplitSuggestionInput, BrokerSuggestedAtomInput, CallerGraphSequenceInput, InputOutputOverlapInput, RecurringFailureClusterInput } from './map-curator/types.ts';
export declare const defaultAtomMapCuratorThresholds: AtomMapCuratorThresholds;
export declare function curateAtomMapEvolution(input: AtomMapCuratorInput): AtomMapCuratorReport;
