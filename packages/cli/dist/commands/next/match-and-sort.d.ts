import type { ImportedTaskSummary } from './view-projections.ts';
import { type HumanReviewQueueRecord, type HumanReviewQueueStatus } from '../../../../plugin-human-review/src/index.ts';
export interface NextDecisionTrailEntry {
    readonly check: string;
    readonly result: 'pass' | 'blocked' | 'info';
    readonly reason: string;
    readonly evidencePath?: string;
    readonly nextCommand?: string;
}
export declare function compareScoredTasks(left: ImportedTaskSummary, right: ImportedTaskSummary): number;
export declare function compareGuidedLegacyQueuePriority(left: HumanReviewQueueRecord, right: HumanReviewQueueRecord): number;
export declare function compareIsoDesc(left: string | undefined, right: string | undefined): 0 | 1 | -1;
export declare function looksLikeTaskArtifact(filePath: string, task: ImportedTaskSummary): boolean;
export declare function isLikelyPromptPathHint(value: string): boolean;
export declare function pathFieldMatches(field: string, hint: string): boolean;
export declare function looksLikeNamedPlanPrompt(prompt: string): boolean;
export declare function allowsPlanningMirror(record: Record<string, unknown>): boolean;
export declare function statusQueueWeight(status: string): number;
export declare function humanReviewStatusWeight(status: HumanReviewQueueStatus): 0 | 2 | 3 | 1;
export declare function decisionResultForStatus(status: string): NextDecisionTrailEntry['result'];
export declare function tokenizeForMatch(value: string): readonly string[];
export declare function countTokenOverlap(prompt: string, title: string): number;
