import type { AtomicPackageDescriptor } from '@ai-atomic-framework/core';
export { computeDecisionSnapshotHash, createHumanReviewQueueDocument, createHumanReviewQueueRecord, findHumanReviewQueueRecord, humanReviewQueuePackage, loadHumanReviewQueueDocument, normalizeHumanReviewQueueDocument, renderHumanReviewQueueMarkdown, replaceHumanReviewQueueRecord, validateHumanReviewQueueDocument, validateHumanReviewQueueRecord, writeHumanReviewQueueDocument } from './queue.js';
export { createHumanReviewDecisionLog, humanReviewDecisionPackage, validateHumanReviewDecisionLog } from './decision-log.js';
export { createAtomMapPatchReviewProposalSnapshot, createAtomMapPatchReviewQueueRecord } from './map-curator-bridge.js';
export type { HumanReviewDecision, HumanReviewDecompositionDecision, HumanReviewQueueAutomatedGatesSummary, HumanReviewQueueDocument, HumanReviewQueueDocumentOptions, HumanReviewQueueMigration, HumanReviewQueueRecord, HumanReviewQueueRecordOptions, HumanReviewQueueReviewRecord, HumanReviewQueueStatus, HumanReviewUpgradeProposalSnapshot, HumanReviewQueueValidationIssue, HumanReviewQueueValidationResult } from './queue.js';
export type { HumanReviewDecisionLog, HumanReviewDecisionLogInput, HumanReviewDecisionValidationResult } from './decision-log.js';
export type { AtomMapPatchReviewProposalOptions, AtomMapPatchReviewProposalSnapshot } from './map-curator-bridge.js';
export declare const humanReviewPackage: AtomicPackageDescriptor;
