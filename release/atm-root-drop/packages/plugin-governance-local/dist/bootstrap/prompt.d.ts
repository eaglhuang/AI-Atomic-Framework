import type { ContextSummaryRecord } from '@ai-atomic-framework/core';
import type { ContinuationContractInput } from './types.ts';
export declare function createContinuationSummaryRecord(input: ContinuationContractInput): ContextSummaryRecord;
export declare function createContinuationRunReport(reportId: string, input: ContinuationContractInput): Readonly<Record<string, unknown>>;
export declare function renderContextSummaryMarkdown(summary: ContextSummaryRecord): string;
