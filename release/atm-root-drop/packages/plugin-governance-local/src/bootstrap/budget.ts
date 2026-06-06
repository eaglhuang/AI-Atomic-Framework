import type {
  ContextBudgetEvaluationInput,
  ContextBudgetEvaluationResult,
  ContextBudgetPolicy
} from '@ai-atomic-framework/plugin-sdk';

export function estimateContextBudgetTokens(...values: readonly unknown[]): number {
  const characterCount = values.reduce<number>((total, value) => total + serializeContextValue(value).length, 0);
  return Math.max(1, Math.ceil(characterCount / 4));
}

export function createDefaultContextBudgetPolicy(timestamp: string): ContextBudgetPolicy {
  return {
    policyId: 'default-policy',
    generatedAt: timestamp,
    unit: 'tokens',
    warningTokens: 12000,
    summarizeTokens: 20000,
    hardStopTokens: 28000,
    maxInlineArtifacts: 2,
    defaultSummary: 'Summarize large tool output before continuing.'
  };
}

export function evaluateContextBudget(
  policy: ContextBudgetPolicy,
  input: ContextBudgetEvaluationInput,
  generatedAt: string
): Omit<ContextBudgetEvaluationResult, 'policyId' | 'budgetId' | 'reportPath' | 'summaryPath'> {
  const estimatedTokens = Math.max(0, Number(input.estimatedTokens || 0));
  const inlineArtifacts = Math.max(0, Number(input.inlineArtifacts || 0));
  let decision: ContextBudgetEvaluationResult['decision'] = 'pass';
  let reason = `Estimated ${estimatedTokens} tokens is within the current context budget policy.`;

  if (estimatedTokens >= policy.hardStopTokens) {
    decision = 'hard-stop';
    reason = `Estimated ${estimatedTokens} tokens exceeds the hard-stop threshold ${policy.hardStopTokens}.`;
  } else if (estimatedTokens >= policy.summarizeTokens) {
    decision = 'summarize-before-continue';
    reason = `Estimated ${estimatedTokens} tokens exceeds the summarize threshold ${policy.summarizeTokens}.`;
  } else if (inlineArtifacts > policy.maxInlineArtifacts) {
    decision = 'summarize-before-continue';
    reason = `Inline artifact count ${inlineArtifacts} exceeds the policy limit ${policy.maxInlineArtifacts}.`;
  } else if (estimatedTokens >= policy.warningTokens) {
    reason = `Estimated ${estimatedTokens} tokens is approaching the summarize threshold ${policy.summarizeTokens}.`;
  }

  return {
    decision,
    estimatedTokens,
    inlineArtifacts,
    generatedAt,
    reason
  };
}

export function createContextBudgetSummary(
  policy: ContextBudgetPolicy,
  input: ContextBudgetEvaluationInput,
  evaluation: Omit<ContextBudgetEvaluationResult, 'policyId' | 'budgetId' | 'reportPath' | 'summaryPath'>
): string {
  return [
    '# Context Budget Summary',
    '',
    `- Policy: ${policy.policyId}`,
    `- Decision: ${evaluation.decision}`,
    `- Estimated tokens: ${evaluation.estimatedTokens}`,
    `- Inline artifacts: ${evaluation.inlineArtifacts}`,
    `- Reason: ${evaluation.reason}`,
    '',
    input.requestedSummary ?? policy.defaultSummary,
    ''
  ].join('\n');
}

export function sanitizeBudgetFileId(budgetId: string): string {
  return normalizeRelativePath(budgetId || 'context-budget').replace(/[/:]+/g, '-');
}

function serializeContextValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeRelativePath(filePath: string): string {
  return String(filePath || '').replace(/\\/g, '/');
}
