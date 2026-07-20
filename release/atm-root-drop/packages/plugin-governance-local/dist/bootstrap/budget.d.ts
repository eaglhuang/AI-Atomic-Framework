import type { ContextBudgetEvaluationInput, ContextBudgetEvaluationResult, ContextBudgetPolicy } from '@ai-atomic-framework/plugin-sdk';
export declare function estimateContextBudgetTokens(...values: readonly unknown[]): number;
export declare function createDefaultContextBudgetPolicy(timestamp: string): ContextBudgetPolicy;
export declare function evaluateContextBudget(policy: ContextBudgetPolicy, input: ContextBudgetEvaluationInput, generatedAt: string): Omit<ContextBudgetEvaluationResult, 'policyId' | 'budgetId' | 'reportPath' | 'summaryPath'>;
export declare function createContextBudgetSummary(policy: ContextBudgetPolicy, input: ContextBudgetEvaluationInput, evaluation: Omit<ContextBudgetEvaluationResult, 'policyId' | 'budgetId' | 'reportPath' | 'summaryPath'>): string;
export declare function sanitizeBudgetFileId(budgetId: string): string;
