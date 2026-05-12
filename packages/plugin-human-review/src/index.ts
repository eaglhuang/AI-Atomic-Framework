import type { AtomicPackageDescriptor } from '@ai-atomic-framework/core';
export {
  computeDecisionSnapshotHash,
  createHumanReviewQueueDocument,
  createHumanReviewQueueRecord,
  findHumanReviewQueueRecord,
  humanReviewQueuePackage,
  loadHumanReviewQueueDocument,
  normalizeHumanReviewQueueDocument,
  renderHumanReviewQueueMarkdown,
  replaceHumanReviewQueueRecord,
  validateHumanReviewQueueDocument,
  validateHumanReviewQueueRecord,
  writeHumanReviewQueueDocument
} from './queue.ts';
export {
  createHumanReviewDecisionLog,
  humanReviewDecisionPackage,
  validateHumanReviewDecisionLog
} from './decision-log.ts';
export type {
  HumanReviewDecision,
  HumanReviewDecompositionDecision,
  HumanReviewQueueAutomatedGatesSummary,
  HumanReviewQueueDocument,
  HumanReviewQueueDocumentOptions,
  HumanReviewQueueMigration,
  HumanReviewQueueRecord,
  HumanReviewQueueRecordOptions,
  HumanReviewQueueReviewRecord,
  HumanReviewQueueStatus,
  HumanReviewUpgradeProposalSnapshot,
  HumanReviewQueueValidationIssue,
  HumanReviewQueueValidationResult
} from './queue.ts';
export type {
  HumanReviewDecisionLog,
  HumanReviewDecisionLogInput,
  HumanReviewDecisionValidationResult
} from './decision-log.ts';

export const humanReviewPackage: AtomicPackageDescriptor = {
  packageName: '@ai-atomic-framework/plugin-human-review',
  packageRole: 'human-review-reference-plugin',
  packageVersion: '0.0.0'
};
