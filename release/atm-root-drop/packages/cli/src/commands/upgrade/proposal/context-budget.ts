import path from 'node:path';
import { existsSync } from 'node:fs';
import {
  type ContinuationContractInput,
  createContinuationRunReport,
  createContinuationSummaryRecord,
  createLocalGovernanceAdapter,
  estimateContextBudgetTokens
} from '../../../../../plugin-governance-local/src/index.ts';
import { renderQualityReportMarkdown } from '../../../../../core/src/police/regression-compare.ts';
import { CliError, readJsonFile, resolveValue } from '../../shared.ts';
import type { ParsedUpgradeCommandOptions } from './types.ts';
import { inferInputKind } from './inputs.ts';
import { sanitizeUpgradeBudgetId } from './guided-legacy.ts';

export async function evaluateUpgradeContextBudget(
  options: ParsedUpgradeCommandOptions,
  inputDocuments: Array<{ path: string; document: Record<string, unknown> }>
) {
  const hashDiffInput = inputDocuments.find((entry) => inferInputKind(entry.document.schemaId as string | null | undefined) === 'hash-diff');
  const qualityComparisonInput = inputDocuments.find((entry) => inferInputKind(entry.document.schemaId as string | null | undefined) === 'quality-comparison');
  if (!qualityComparisonInput) {
    return {
      gate: null,
      decision: 'pass',
      estimatedTokens: 0,
      reportPath: null,
      summaryPath: null,
      continuationReportPath: null,
      contextSummaryPath: null,
      contextSummaryMarkdownPath: null,
      evidencePath: null
    };
  }

  const atomId = options.atomId ?? (hashDiffInput?.document?.atomId as string | undefined) ?? (qualityComparisonInput.document.atomId as string | undefined) ?? 'ATM-UPGRADE-0000';
  const toVersion = options.toVersion ?? (hashDiffInput?.document?.toVersion as string | undefined) ?? (qualityComparisonInput.document.toVersion as string | undefined) ?? 'pending';
  const budgetId = `upgrade/${atomId}/${toVersion}`;
  const fallbackReportPath = `.atm/history/reports/context-budget/${sanitizeUpgradeBudgetId(budgetId)}.json`;
  const estimatedTokens = estimateContextBudgetTokens(
    qualityComparisonInput.document,
    renderQualityReportMarkdown(qualityComparisonInput.document)
  );
  const governanceEnabled = existsSync(path.join(options.cwd, '.atm')) && options.dryRun !== true;
  const evaluationInput = {
    budgetId,
    workItemId: atomId,
    estimatedTokens,
    inlineArtifacts: 1,
    requestedSummary: 'Review the stored context summary and linked reports instead of replaying the full quality comparison inline.'
  };
  const evaluation: { decision: 'pass' | 'summarize-before-continue' | 'hard-stop'; reason: string; reportPath: string; summaryPath?: string | null } = governanceEnabled
    ? await resolveValue((createLocalGovernanceAdapter({ repositoryRoot: options.cwd }).stores.contextBudgetGuard as unknown as { evaluateBudget: (input: unknown) => Promise<{ decision: 'pass' | 'summarize-before-continue' | 'hard-stop'; reason: string; reportPath: string; summaryPath?: string | null }> }).evaluateBudget(evaluationInput))
    : evaluateContextBudgetInline(readUpgradeContextBudgetPolicy(options.cwd), evaluationInput, new Date().toISOString(), fallbackReportPath);
  const gate = {
    passed: evaluation.decision === 'pass',
    reportId: `context-budget.${sanitizeUpgradeBudgetId(budgetId).toLowerCase()}`,
    reportPath: evaluation.reportPath,
    summary: evaluation.decision === 'pass'
      ? `pass (${evaluation.reason})`
      : `blocked (${evaluation.reason})`
  };
  const persisted = governanceEnabled && evaluation.decision !== 'pass'
    ? await materializeUpgradeHardStop(
        options.cwd,
        atomId,
        qualityComparisonInput!.path as string,
        evaluation as { decision: 'pass' | 'summarize-before-continue' | 'hard-stop'; reportPath: string; summaryPath?: string | null },
        options.proposedAt ?? new Date().toISOString()
      )
    : {
        continuationReportPath: null,
        contextSummaryPath: null,
        contextSummaryMarkdownPath: null,
        evidencePath: null
      };

  return {
    gate,
    decision: evaluation.decision,
    estimatedTokens,
    reportPath: evaluation.reportPath,
    summaryPath: evaluation.summaryPath ?? null,
    continuationReportPath: persisted.continuationReportPath,
    contextSummaryPath: persisted.contextSummaryPath,
    contextSummaryMarkdownPath: persisted.contextSummaryMarkdownPath,
    evidencePath: persisted.evidencePath
  };
}

async function materializeUpgradeHardStop(
  cwd: string,
  atomId: string,
  qualityReportPath: string,
  evaluation: { decision: 'pass' | 'summarize-before-continue' | 'hard-stop'; reportPath: string; summaryPath?: string | null },
  generatedAt: string
) {
  const adapter = createLocalGovernanceAdapter({ repositoryRoot: cwd });
  const runReportStore = adapter.stores.runReportStore;
  const contextSummaryStore = adapter.stores.contextSummaryStore;
  if (!runReportStore || !contextSummaryStore) {
    throw new CliError('ATM_UPGRADE_STORE_MISSING', 'Required governance stores are not available for upgrade hard-stop persistence.');
  }
  const continuationReportId = `continuation/upgrade/${atomId}`;
  const continuationReportPath = `.atm/history/reports/continuation/upgrade/${atomId}.json`;
  const evidencePath = `.atm/history/evidence/${atomId}.json`;
  const contextSummaryPath = `.atm/history/handoff/${atomId}.json`;
  const contextSummaryMarkdownPath = `.atm/history/handoff/${atomId}.md`;

  const continuationInput: ContinuationContractInput = {
    workItemId: atomId,
    generatedAt,
    summaryId: `summary.upgrade-hard-stop.${atomId.toLowerCase()}`,
    summary: 'Upgrade proposal blocked by context budget enforcement; continuation artifacts were written for handoff.',
    nextActions: [
      'Review the context budget report.',
      'Read the stored continuation summary before reopening the upgrade review.',
      'Summarize or split the quality-comparison evidence before retrying the proposal.'
    ],
    artifactPaths: [qualityReportPath],
    evidencePaths: [evidencePath],
    reportPaths: [evaluation.reportPath, continuationReportPath],
    authoredBy: '@ai-atomic-framework/cli:upgrade',
    handoffKind: 'budget-hard-stop',
    continuationGoal: 'Reduce the quality-comparison review surface until it fits within the configured context budget.',
    resumePrompt: 'Read the stored continuation summary first, then inspect the budget report and the original quality-comparison report.',
    resumeCommand: ['node', 'atm.mjs', 'upgrade', '--propose', '--atom', atomId, '--to', 'REPLACE_WITH_TARGET_VERSION', '--json'],
    budgetDecision: evaluation.decision,
    hardStop: evaluation.decision === 'hard-stop'
  };

  await resolveValue(runReportStore.writeRunReport(continuationReportId, createContinuationRunReport(continuationReportId, continuationInput)));
  const summary = await resolveValue(contextSummaryStore.writeSummary(createContinuationSummaryRecord(continuationInput)));
  await resolveValue(adapter.stores.evidenceStore.writeEvidence(atomId, {
    workItemId: atomId,
    evidenceKind: 'handoff',
    summary: 'Upgrade hard-stop continuation contract recorded.',
    artifactPaths: [qualityReportPath, evaluation.reportPath, continuationReportPath],
    createdAt: generatedAt,
    producedBy: '@ai-atomic-framework/cli:upgrade',
    details: {
      budgetDecision: evaluation.decision,
      contextSummaryPath,
      contextSummaryMarkdownPath: summary.summaryMarkdownPath ?? contextSummaryMarkdownPath
    }
  }));

  return {
    continuationReportPath,
    contextSummaryPath,
    contextSummaryMarkdownPath: summary.summaryMarkdownPath ?? contextSummaryMarkdownPath,
    evidencePath
  };
}

function readUpgradeContextBudgetPolicy(cwd: string) {
  const policyPath = path.join(cwd, '.atm', 'runtime', 'budget', 'default-policy.json');
  if (!existsSync(policyPath)) {
    return {
      policyId: 'default-policy',
      warningTokens: 12000,
      summarizeTokens: 20000,
      hardStopTokens: 28000,
      maxInlineArtifacts: 2,
      defaultSummary: 'Summarize large tool output before continuing.'
    };
  }
  return readJsonFile(policyPath, 'ATM_UPGRADE_CONTEXT_POLICY_NOT_FOUND');
}

function evaluateContextBudgetInline(
  policy: { hardStopTokens: number; summarizeTokens: number; warningTokens: number; maxInlineArtifacts: number },
  input: { estimatedTokens: number; inlineArtifacts: number; budgetId: string },
  generatedAt: string,
  reportPath: string
): { decision: 'pass' | 'summarize-before-continue' | 'hard-stop'; estimatedTokens: number; inlineArtifacts: number; generatedAt: string; reason: string; reportPath: string; summaryPath?: string } {
  const estimatedTokens = Math.max(0, Number(input.estimatedTokens || 0));
  const inlineArtifacts = Math.max(0, Number(input.inlineArtifacts || 0));
  let decision: 'pass' | 'summarize-before-continue' | 'hard-stop' = 'pass';
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
    reason,
    reportPath,
    summaryPath: decision === 'pass' ? undefined : `.atm/runtime/budget/${sanitizeUpgradeBudgetId(input.budgetId)}.md`
  };
}
