import type { AtomicPackageDescriptor } from '@ai-atomic-framework/core';
export { computeDecisionSnapshotHash, createHumanReviewQueueDocument, createHumanReviewQueueRecord, findHumanReviewQueueRecord, humanReviewQueuePackage, loadHumanReviewQueueDocument, normalizeHumanReviewQueueDocument, renderHumanReviewQueueMarkdown, replaceHumanReviewQueueRecord, validateHumanReviewQueueDocument, validateHumanReviewQueueRecord, writeHumanReviewQueueDocument } from './queue.ts';
export { createHumanReviewDecisionLog, humanReviewDecisionPackage, validateHumanReviewDecisionLog } from './decision-log.ts';
export { createAtomMapPatchReviewProposalSnapshot, createAtomMapPatchReviewQueueRecord } from './map-curator-bridge.ts';
export type { HumanReviewDecision, HumanReviewDecompositionDecision, HumanReviewQueueAutomatedGatesSummary, HumanReviewQueueDocument, HumanReviewQueueDocumentOptions, HumanReviewQueueMigration, HumanReviewQueueRecord, HumanReviewQueueRecordOptions, HumanReviewQueueReviewRecord, HumanReviewQueueStatus, HumanReviewUpgradeProposalSnapshot, HumanReviewQueueValidationIssue, HumanReviewQueueValidationResult } from './queue.ts';
export type { HumanReviewDecisionLog, HumanReviewDecisionLogInput, HumanReviewDecisionValidationResult } from './decision-log.ts';
export type { AtomMapPatchReviewProposalOptions, AtomMapPatchReviewProposalSnapshot } from './map-curator-bridge.ts';
export declare const humanReviewPackage: AtomicPackageDescriptor;
