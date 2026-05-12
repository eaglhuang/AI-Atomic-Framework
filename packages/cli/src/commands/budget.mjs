import path from 'node:path';
import { createLocalGovernanceAdapter } from '../../../plugin-governance-local/src/index.ts';
import { CliError, makeResult, message } from './shared.mjs';

export function runBudget(argv) {
  const options = parseBudgetArgs(argv);
  const adapter = createLocalGovernanceAdapter({ repositoryRoot: options.cwd });
  const evaluation = adapter.stores.contextBudgetGuard.evaluateBudget({
    budgetId: options.budgetId ?? `budget/${options.taskId}`,
    workItemId: options.taskId,
    estimatedTokens: options.estimatedTokens,
    inlineArtifacts: options.inlineArtifacts,
    requestedSummary: options.requestedSummary
  });

  return makeResult({
    ok: evaluation.decision === 'pass',
    command: 'budget',
    cwd: options.cwd,
    messages: [message('info', 'ATM_BUDGET_CHECKED', 'Context budget evaluated.', { decision: evaluation.decision })],
    evidence: {
      taskId: options.taskId,
      budgetId: evaluation.budgetId,
      decision: evaluation.decision,
      estimatedTokens: evaluation.estimatedTokens,
      inlineArtifacts: evaluation.inlineArtifacts,
      reportPath: evaluation.reportPath,
      summaryPath: evaluation.summaryPath ?? null
    }
  });
}

function parseBudgetArgs(argv) {
  const state = {
    cwd: process.cwd(),
    action: null,
    taskId: null,
    budgetId: null,
    estimatedTokens: null,
    inlineArtifacts: 0,
    requestedSummary: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      state.cwd = requireValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--task') {
      state.taskId = requireValue(argv, index, '--task');
      index += 1;
      continue;
    }
    if (arg === '--budget-id') {
      state.budgetId = requireValue(argv, index, '--budget-id');
      index += 1;
      continue;
    }
    if (arg === '--estimated-tokens') {
      state.estimatedTokens = Number(requireValue(argv, index, '--estimated-tokens'));
      index += 1;
      continue;
    }
    if (arg === '--inline-artifacts') {
      state.inlineArtifacts = Number(requireValue(argv, index, '--inline-artifacts'));
      index += 1;
      continue;
    }
    if (arg === '--requested-summary') {
      state.requestedSummary = requireValue(argv, index, '--requested-summary');
      index += 1;
      continue;
    }
    if (arg === '--json') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `budget does not support option ${arg}`, { exitCode: 2 });
    }
    if (state.action) {
      throw new CliError('ATM_CLI_USAGE', 'budget accepts only one action', { exitCode: 2 });
    }
    state.action = arg;
  }

  if (state.action !== 'check') {
    throw new CliError('ATM_CLI_USAGE', 'budget currently supports only: check', { exitCode: 2 });
  }
  if (!state.taskId || Number.isNaN(state.estimatedTokens)) {
    throw new CliError('ATM_CLI_USAGE', 'budget check requires --task and --estimated-tokens', { exitCode: 2 });
  }

  return {
    cwd: path.resolve(state.cwd),
    taskId: state.taskId,
    budgetId: state.budgetId,
    estimatedTokens: state.estimatedTokens,
    inlineArtifacts: Number.isFinite(state.inlineArtifacts) ? state.inlineArtifacts : 0,
    requestedSummary: state.requestedSummary
  };
}

function requireValue(argv, optionIndex, optionName) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `budget requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}
