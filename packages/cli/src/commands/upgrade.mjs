import path from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import {
  createContinuationRunReport,
  createContinuationSummaryRecord,
  createLocalGovernanceAdapter,
  estimateContextBudgetTokens
} from '../../../plugin-governance-local/src/index.ts';
import { renderQualityReportMarkdown } from '../../../core/src/police/regression-compare.mjs';
import { proposeAtomicUpgrade } from '../../../core/src/upgrade/propose.mjs';
import { CliError, makeResult, message, readJsonFile } from './shared.mjs';

export function runUpgrade(argv) {
  const options = parseUpgradeOptions(argv);
  const inputDocuments = options.inputPaths.length > 0
    ? loadExplicitInputDocuments(options.cwd, options.inputPaths)
    : discoverInputDocuments(options.cwd);
  const contextBudget = evaluateUpgradeContextBudget(options, inputDocuments);

  const proposal = proposeAtomicUpgrade({
    atomId: options.atomId,
    fromVersion: options.fromVersion,
    toVersion: options.toVersion,
    behaviorId: options.behaviorId,
    decompositionDecision: options.decompositionDecision,
    target: options.target,
    fork: options.fork,
    mapImpactScope: options.mapImpactScope,
    proposalId: options.proposalId,
    proposedBy: options.proposedBy,
    proposedAt: options.proposedAt,
    migration: options.migration,
    contextBudgetGate: contextBudget.gate,
    inputs: inputDocuments
  });

  return makeResult({
    ok: true,
    command: 'upgrade',
    cwd: options.cwd,
    messages: [
      proposal.status === 'blocked'
        ? message('warning', 'ATM_UPGRADE_PROPOSAL_BLOCKED', 'Upgrade proposal blocked by automated gates.', {
          proposalId: proposal.proposalId,
          blockedGateNames: proposal.automatedGates.blockedGateNames
        })
        : message('info', 'ATM_UPGRADE_PROPOSAL_READY', 'Upgrade proposal prepared and ready for review.', {
          proposalId: proposal.proposalId
        })
    ],
    evidence: {
      proposal,
      proposalId: proposal.proposalId,
      status: proposal.status,
      blockedGateNames: proposal.automatedGates.blockedGateNames,
      contextBudget,
      dryRun: options.dryRun,
      target: proposal.target,
      behaviorId: proposal.behaviorId,
      inputCount: proposal.inputs.length,
      inputKinds: proposal.inputs.map((entry) => entry.kind)
    }
  });
}

function parseUpgradeOptions(argv) {
  const options = {
    cwd: process.cwd(),
    propose: false,
    dryRun: false,
    atomId: null,
    fromVersion: null,
    toVersion: null,
    behaviorId: 'behavior.evolve',
    decompositionDecision: null,
    inputPaths: [],
    target: { kind: 'atom' },
    fork: null,
    mapImpactScope: null,
    proposalId: null,
    proposedBy: 'ATM CLI',
    proposedAt: null,
    migration: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireOptionValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--propose') {
      options.propose = true;
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--atom') {
      options.atomId = requireOptionValue(argv, index, '--atom');
      index += 1;
      continue;
    }
    if (arg === '--from') {
      options.fromVersion = requireOptionValue(argv, index, '--from');
      index += 1;
      continue;
    }
    if (arg === '--to') {
      options.toVersion = requireOptionValue(argv, index, '--to');
      index += 1;
      continue;
    }
    if (arg === '--behavior') {
      options.behaviorId = requireOptionValue(argv, index, '--behavior');
      index += 1;
      continue;
    }
    if (arg === '--target') {
      const targetKind = requireOptionValue(argv, index, '--target');
      if (targetKind !== 'atom' && targetKind !== 'map') {
        throw new CliError('ATM_CLI_USAGE', '--target must be atom or map', { exitCode: 2 });
      }
      options.target = { kind: targetKind };
      index += 1;
      continue;
    }
    if (arg === '--map') {
      options.target = { kind: 'map', mapId: requireOptionValue(argv, index, '--map') };
      index += 1;
      continue;
    }
    if (arg === '--fork-source') {
      options.fork = options.fork ?? {};
      options.fork.sourceAtomId = requireOptionValue(argv, index, '--fork-source');
      index += 1;
      continue;
    }
    if (arg === '--new-atom-id') {
      options.fork = options.fork ?? {};
      options.fork.newAtomId = requireOptionValue(argv, index, '--new-atom-id');
      index += 1;
      continue;
    }
    if (arg === '--input') {
      options.inputPaths.push(requireOptionValue(argv, index, '--input'));
      index += 1;
      continue;
    }
    if (arg === '--proposed-by') {
      options.proposedBy = requireOptionValue(argv, index, '--proposed-by');
      index += 1;
      continue;
    }
    if (arg === '--proposed-at') {
      options.proposedAt = requireOptionValue(argv, index, '--proposed-at');
      index += 1;
      continue;
    }
    if (arg === '--proposal-id') {
      options.proposalId = requireOptionValue(argv, index, '--proposal-id');
      index += 1;
      continue;
    }
    if (arg === '--json') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `upgrade does not support option ${arg}`, { exitCode: 2 });
    }
  }

  if (!options.propose) {
    throw new CliError('ATM_CLI_USAGE', 'upgrade requires --propose', { exitCode: 2 });
  }
  if (!options.atomId) {
    throw new CliError('ATM_CLI_USAGE', 'upgrade requires --atom', { exitCode: 2 });
  }
  if (!options.toVersion) {
    throw new CliError('ATM_CLI_USAGE', 'upgrade requires --to', { exitCode: 2 });
  }
  if (options.target.kind === 'map' && !options.target.mapId) {
    throw new CliError('ATM_CLI_USAGE', 'upgrade --target map requires --map', { exitCode: 2 });
  }
  if (options.fork && (!options.fork.sourceAtomId || !options.fork.newAtomId)) {
    throw new CliError('ATM_CLI_USAGE', 'upgrade fork mode requires both --fork-source and --new-atom-id', { exitCode: 2 });
  }

  return {
    ...options,
    cwd: path.resolve(options.cwd),
    proposedAt: options.proposedAt ?? new Date().toISOString()
  };
}

function loadExplicitInputDocuments(cwd, inputPaths) {
  return inputPaths.map((inputPath) => {
    const resolvedPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath);
    return {
      path: path.relative(cwd, resolvedPath).replace(/\\/g, '/'),
      document: readJsonFile(resolvedPath, 'ATM_UPGRADE_INPUT_NOT_FOUND')
    };
  });
}

function discoverInputDocuments(cwd) {
  const reportsRoot = path.join(cwd, '.atm', 'reports');
  if (!existsSync(reportsRoot)) {
    throw new CliError('ATM_UPGRADE_INPUTS_NOT_FOUND', 'Upgrade requires input reports. Provide --input paths or stage reports under .atm/reports.', {
      exitCode: 2,
      details: { reportsRoot }
    });
  }

  const discoveredFiles = collectJsonFiles(reportsRoot).sort((left, right) => left.localeCompare(right));
  const discoveredDocuments = discoveredFiles.map((filePath) => ({
    path: path.relative(cwd, filePath).replace(/\\/g, '/'),
    document: readJsonFile(filePath, 'ATM_UPGRADE_INPUT_NOT_FOUND')
  }));

  const inputDocuments = [];
  for (const kind of ['hash-diff', 'execution-evidence', 'non-regression', 'quality-comparison', 'registry-candidate']) {
    const match = discoveredDocuments.find((entry) => inferInputKind(entry.document.schemaId) === kind);
    if (match) {
      inputDocuments.push(match);
    }
  }

  if (inputDocuments.length === 0) {
    throw new CliError('ATM_UPGRADE_INPUTS_NOT_FOUND', 'Upgrade could not discover any recognized input reports under .atm/reports.', {
      exitCode: 2,
      details: { reportsRoot }
    });
  }

  return inputDocuments;
}

function evaluateUpgradeContextBudget(options, inputDocuments) {
  const hashDiffInput = inputDocuments.find((entry) => inferInputKind(entry.document.schemaId) === 'hash-diff');
  const qualityComparisonInput = inputDocuments.find((entry) => inferInputKind(entry.document.schemaId) === 'quality-comparison');
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

  const atomId = options.atomId ?? hashDiffInput?.document?.atomId ?? qualityComparisonInput.document.atomId ?? 'ATM-UPGRADE-0000';
  const toVersion = options.toVersion ?? hashDiffInput?.document?.toVersion ?? qualityComparisonInput.document.toVersion ?? 'pending';
  const budgetId = `upgrade/${atomId}/${toVersion}`;
  const fallbackReportPath = `.atm/reports/context-budget/${sanitizeUpgradeBudgetId(budgetId)}.json`;
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
  const evaluation = governanceEnabled
    ? createLocalGovernanceAdapter({ repositoryRoot: options.cwd }).stores.contextBudgetGuard.evaluateBudget(evaluationInput)
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
    ? materializeUpgradeHardStop(options.cwd, atomId, qualityComparisonInput.path, evaluation, options.proposedAt ?? new Date().toISOString())
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

function materializeUpgradeHardStop(cwd, atomId, qualityReportPath, evaluation, generatedAt) {
  const adapter = createLocalGovernanceAdapter({ repositoryRoot: cwd });
  const continuationReportId = `continuation/upgrade/${atomId}`;
  const continuationReportPath = `.atm/reports/continuation/upgrade/${atomId}.json`;
  const evidencePath = `.atm/evidence/${atomId}.json`;
  const contextSummaryPath = `.atm/state/context-summary/${atomId}.json`;
  const contextSummaryMarkdownPath = `.atm/state/context-summary/${atomId}.md`;

  const continuationInput = {
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
    resumeCommand: ['node', 'packages/cli/src/atm.mjs', 'upgrade', '--propose', '--atom', atomId, '--to', 'REPLACE_WITH_TARGET_VERSION', '--json'],
    budgetDecision: evaluation.decision,
    hardStop: evaluation.decision === 'hard-stop'
  };

  adapter.stores.runReportStore.writeRunReport(continuationReportId, createContinuationRunReport(continuationReportId, continuationInput));
  const summary = adapter.stores.contextSummaryStore.writeSummary(createContinuationSummaryRecord(continuationInput));
  adapter.stores.evidenceStore.writeEvidence(atomId, {
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
  });

  return {
    continuationReportPath,
    contextSummaryPath,
    contextSummaryMarkdownPath: summary.summaryMarkdownPath ?? contextSummaryMarkdownPath,
    evidencePath
  };
}

function readUpgradeContextBudgetPolicy(cwd) {
  const policyPath = path.join(cwd, '.atm', 'state', 'context-budget', 'default-policy.json');
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

function evaluateContextBudgetInline(policy, input, generatedAt, reportPath) {
  const estimatedTokens = Math.max(0, Number(input.estimatedTokens || 0));
  const inlineArtifacts = Math.max(0, Number(input.inlineArtifacts || 0));
  let decision = 'pass';
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
    summaryPath: decision === 'pass' ? undefined : `.atm/state/context-budget/${sanitizeUpgradeBudgetId(input.budgetId)}.md`
  };
}

function sanitizeUpgradeBudgetId(value) {
  return String(value || 'context-budget').replace(/\\/g, '/').replace(/[/:]+/g, '-');
}

function collectJsonFiles(rootDir) {
  const entries = [];
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const entryPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...collectJsonFiles(entryPath));
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.json')) {
      entries.push(entryPath);
    }
  }
  return entries;
}

function inferInputKind(schemaId) {
  switch (schemaId) {
    case 'atm.hashDiffReport':
      return 'hash-diff';
    case 'atm.executionEvidence':
      return 'execution-evidence';
    case 'atm.police.nonRegressionReport':
      return 'non-regression';
    case 'atm.police.qualityComparisonReport':
      return 'quality-comparison';
    case 'atm.police.registryCandidateReport':
      return 'registry-candidate';
    default:
      return null;
  }
}

function requireOptionValue(argv, optionIndex, optionName) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `upgrade requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}