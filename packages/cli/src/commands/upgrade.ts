import path from 'node:path';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import {
  type ContinuationContractInput,
  createContinuationRunReport,
  createContinuationSummaryRecord,
  createLocalGovernanceAdapter,
  estimateContextBudgetTokens
} from '../../../plugin-governance-local/src/index.ts';
import { renderQualityReportMarkdown } from '../../../core/src/police/regression-compare.ts';
import { scanEvidencePatternReports } from '../../../core/src/upgrade/evolution-draft.ts';
import { proposeAtomicUpgrade } from '../../../core/src/upgrade/propose.ts';
import {
  createHumanReviewQueueDocument,
  createHumanReviewQueueRecord,
  findHumanReviewQueueRecord,
  loadHumanReviewQueueDocument,
  renderHumanReviewQueueMarkdown,
  replaceHumanReviewQueueRecord,
  writeHumanReviewQueueDocument
} from '../../../plugin-human-review/src/index.ts';
import { runUpgradeMapPropose } from './upgrade-map-propose.ts';
import { CliError, makeResult, message, readJsonFile, resolveValue } from './shared.ts';

export async function runUpgrade(argv: any) {
  const options = parseUpgradeOptions(argv);
  if (options.scan) {
    return runUpgradeScan(options);
  }
  if (isGuidedLegacyDryRun(options)) {
    return runGuidedLegacyDryRunProposal(options);
  }
  const inputDocuments = options.inputPaths.length > 0
    ? loadExplicitInputDocuments(options.cwd, options.inputPaths)
    : discoverInputDocuments(options.cwd);
  const contextBudget = await evaluateUpgradeContextBudget(options, inputDocuments);

  const proposerOptions = {
    cwd: options.cwd,
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
  };

  const proposal = options.target.kind === 'map'
    ? runUpgradeMapPropose(proposerOptions)
    : proposeAtomicUpgrade({
      ...proposerOptions,
      repositoryRoot: options.cwd
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
      inputKinds: proposal.inputs.map((entry: any) => entry.kind)
    }
  });
}

async function runUpgradeScan(options: any) {
  const detectorReports = options.inputPaths.length > 0
    ? loadExplicitInputDocuments(options.cwd, options.inputPaths)
    : discoverDetectorReportDocuments(options.cwd);

  if (detectorReports.length === 0) {
    throw new CliError('ATM_EVIDENCE_SCAN_INPUTS_NOT_FOUND', 'Upgrade scan requires detector reports. Provide --input paths or stage detector reports under .atm/history/reports.', {
      exitCode: 2,
      details: { reportsRoot: path.join(options.cwd, '.atm', 'history', 'reports') }
    });
  }

  const scanReport = scanEvidencePatternReports({
    repositoryRoot: options.cwd,
    detectorReports: detectorReports.map((entry: any) => ({
      path: entry.path,
      document: entry.document
    })),
    proposedBy: options.proposedBy,
    proposedAt: options.proposedAt,
    dryRun: true
  });

  const proposalDrafts = scanReport.proposalDrafts;
  return makeResult({
    ok: true,
    command: 'upgrade',
    cwd: options.cwd,
    messages: [
      proposalDrafts.length === 0
        ? message('info', 'ATM_EVIDENCE_SCAN_EMPTY', 'Evidence scan completed with no proposal candidates.', {
          scanId: scanReport.scanId,
          detectorReportCount: scanReport.detectorReports.length
        })
        : message('info', 'ATM_EVIDENCE_SCAN_READY', 'Evidence scan produced dry-run proposal drafts.', {
          scanId: scanReport.scanId,
          proposalDraftCount: proposalDrafts.length,
          proposalIds: proposalDrafts.map((draft: any) => draft.proposal.proposalId)
        })
    ],
    evidence: {
      scanReport,
      proposalDrafts,
      observationReport: scanReport.observation,
      dryRun: true,
      detectorReportCount: scanReport.detectorReports.length,
      proposalDraftCount: proposalDrafts.length,
      inputKinds: detectorReports.map((entry: any) => entry.document.schemaId),
      inputCount: detectorReports.length
    }
  });
}

function parseUpgradeOptions(argv: any) {
  const options: any = {
    cwd: process.cwd(),
    propose: false,
    scan: false,
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
    legacyTarget: null,
    guidanceSession: null,
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
    if (arg === '--scan') {
      options.scan = true;
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
    if (arg === '--legacy-target') {
      options.legacyTarget = requireOptionValue(argv, index, '--legacy-target');
      index += 1;
      continue;
    }
    if (arg === '--guidance-session') {
      options.guidanceSession = requireOptionValue(argv, index, '--guidance-session');
      index += 1;
      continue;
    }
    if (arg === '--decomposition-decision') {
      options.decompositionDecision = requireOptionValue(argv, index, '--decomposition-decision');
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

  if (!options.propose && !options.scan) {
    throw new CliError('ATM_CLI_USAGE', 'upgrade requires --propose or --scan', { exitCode: 2 });
  }
  if (options.propose) {
    const guidedLegacy = Boolean(options.legacyTarget || options.guidanceSession);
    if (guidedLegacy) {
      if (!options.dryRun) {
        throw new CliError('ATM_CLI_USAGE', 'guided legacy upgrade proposals require --dry-run', { exitCode: 2 });
      }
      if (!options.legacyTarget || !options.guidanceSession) {
        throw new CliError('ATM_CLI_USAGE', 'guided legacy upgrade proposals require --legacy-target and --guidance-session', { exitCode: 2 });
      }
      if (!['behavior.atomize', 'behavior.infect', 'behavior.split'].includes(options.behaviorId)) {
        throw new CliError('ATM_CLI_USAGE', 'guided legacy upgrade proposals require behavior.atomize, behavior.infect, or behavior.split', { exitCode: 2 });
      }
    } else if (!options.atomId) {
      throw new CliError('ATM_CLI_USAGE', 'upgrade requires --atom', { exitCode: 2 });
    }
    if (!guidedLegacy && !options.toVersion) {
      throw new CliError('ATM_CLI_USAGE', 'upgrade requires --to', { exitCode: 2 });
    }
    if (options.target.kind === 'map' && !options.target.mapId) {
      throw new CliError('ATM_CLI_USAGE', 'upgrade --target map requires --map', { exitCode: 2 });
    }
    if (options.fork && (!options.fork.sourceAtomId || !options.fork.newAtomId)) {
      throw new CliError('ATM_CLI_USAGE', 'upgrade fork mode requires both --fork-source and --new-atom-id', { exitCode: 2 });
    }
  }

  return {
    ...options,
    cwd: path.resolve(options.cwd),
    proposedAt: options.proposedAt ?? new Date().toISOString()
  };
}

function isGuidedLegacyDryRun(options: any) {
  return options.propose === true
    && options.dryRun === true
    && typeof options.legacyTarget === 'string'
    && typeof options.guidanceSession === 'string'
    && ['behavior.atomize', 'behavior.infect', 'behavior.split'].includes(options.behaviorId);
}

function runGuidedLegacyDryRunProposal(options: any) {
  const behaviorName = String(options.behaviorId).replace(/^behavior\./, '');
  const proposalId = options.proposalId
    ?? `guided-legacy-${behaviorName}-${sanitizeUpgradeBudgetId(options.guidanceSession).toLowerCase()}`;
  const proposal = {
    schemaId: 'atm.guidedLegacyDryRunProposal',
    specVersion: '0.1.0',
    proposalId,
    atomId: `LEGACY-GUIDED-${sanitizeUpgradeBudgetId(behaviorName).toUpperCase()}`,
    fromVersion: 'legacy',
    toVersion: 'guided-dry-run',
    behaviorId: options.behaviorId,
    decompositionDecision: behaviorName,
    legacyTarget: options.legacyTarget,
    guidanceSession: options.guidanceSession,
    patchMode: 'dry-run',
    automatedGates: {
      allPassed: true,
      blockedGateNames: []
    },
    status: 'pending',
    reviewRequired: true,
    rollbackProofRequired: true,
    rollbackInstructions: [
      'Do not apply generated host changes until human review approves the dry-run proposal.',
      'Discard generated proposal artifacts to roll back the preview, then rerun atm next before retrying.'
    ],
    proposedBy: options.proposedBy,
    proposedAt: options.proposedAt
  };
  const queued = enqueueGuidedLegacyProposal(options.cwd, proposal);
  return makeResult({
    ok: true,
    command: 'upgrade',
    cwd: options.cwd,
    messages: [
      message('info', 'ATM_UPGRADE_PROPOSAL_READY', 'Guided legacy dry-run proposal prepared and ready for review.', {
        proposalId
      })
    ],
    evidence: {
      proposal,
      proposalId,
      status: 'ready-for-review',
      queuePath: queued.queuePath,
      projectionPath: queued.projectionPath,
      queued: true,
      dryRun: true,
      behaviorId: options.behaviorId,
      legacyTarget: options.legacyTarget,
      guidanceSession: options.guidanceSession,
      humanReviewRequired: true,
      rollbackProofRequired: true
    }
  });
}

function enqueueGuidedLegacyProposal(cwd: string, proposal: Record<string, unknown>) {
  const queuePath = path.join(cwd, '.atm', 'history', 'reports', 'upgrade-proposals.json');
  const projectionPath = path.join(cwd, '.atm', 'history', 'reports', 'upgrade-proposals.md');
  const existingQueue = loadHumanReviewQueueDocument(queuePath)
    ?? createHumanReviewQueueDocument([], { generatedAt: new Date().toISOString() });
  const nextRecord = createHumanReviewQueueRecord(proposal, { status: 'pending' });
  const nextQueue = findHumanReviewQueueRecord(existingQueue, nextRecord.proposalId)
    ? replaceHumanReviewQueueRecord(existingQueue, nextRecord)
    : createHumanReviewQueueDocument([...existingQueue.entries, nextRecord], {
        generatedAt: new Date().toISOString(),
        migration: existingQueue.migration
      });
  writeHumanReviewQueueDocument(queuePath, nextQueue);
  mkdirSync(path.dirname(projectionPath), { recursive: true });
  writeFileSync(projectionPath, renderHumanReviewQueueMarkdown(nextQueue), 'utf8');
  return {
    queuePath: path.relative(cwd, queuePath).replace(/\\/g, '/'),
    projectionPath: path.relative(cwd, projectionPath).replace(/\\/g, '/')
  };
}

function loadExplicitInputDocuments(cwd: any, inputPaths: any) {
  return inputPaths.map((inputPath: any) => {
    const resolvedPath = path.isAbsolute(inputPath) ? inputPath : path.resolve(cwd, inputPath);
    const rawDocument = readJsonFile(resolvedPath, 'ATM_UPGRADE_INPUT_NOT_FOUND');
    const document = normalizeUpgradeInputDocument(rawDocument);
    return {
      path: path.relative(cwd, resolvedPath).replace(/\\/g, '/'),
      document
    };
  });
}

function normalizeUpgradeInputDocument(document: any) {
  if (document && typeof document === 'object' && !Array.isArray(document) && document.expectedReport && !document.schemaId) {
    return document.expectedReport;
  }
  return document;
}

function discoverInputDocuments(cwd: any) {
  const reportsRoot = path.join(cwd, '.atm', 'history', 'reports');
  if (!existsSync(reportsRoot)) {
    throw new CliError('ATM_UPGRADE_INPUTS_NOT_FOUND', 'Upgrade requires input reports. Provide --input paths or stage reports under .atm/history/reports.', {
      exitCode: 2,
      details: { reportsRoot }
    });
  }

  const discoveredFiles = collectJsonFiles(reportsRoot).sort((left: any, right: any) => left.localeCompare(right));
  const discoveredDocuments = discoveredFiles.map((filePath: any) => ({
    path: path.relative(cwd, filePath).replace(/\\/g, '/'),
    document: readJsonFile(filePath, 'ATM_UPGRADE_INPUT_NOT_FOUND')
  }));

  const inputDocuments = [];
  for (const kind of ['hash-diff', 'execution-evidence', 'non-regression', 'quality-comparison', 'registry-candidate']) {
    const match = discoveredDocuments.find((entry: any) => inferInputKind(entry.document.schemaId) === kind);
    if (match) {
      inputDocuments.push(match);
    }
  }

  if (inputDocuments.length === 0) {
    throw new CliError('ATM_UPGRADE_INPUTS_NOT_FOUND', 'Upgrade could not discover any recognized input reports under .atm/history/reports.', {
      exitCode: 2,
      details: { reportsRoot }
    });
  }

  return inputDocuments;
}

function discoverDetectorReportDocuments(cwd: any) {
  const reportsRoot = path.join(cwd, '.atm', 'history', 'reports');
  if (!existsSync(reportsRoot)) {
    return [];
  }

  const discoveredFiles = collectJsonFiles(reportsRoot).sort((left: any, right: any) => left.localeCompare(right));
  return discoveredFiles
    .map((filePath: any) => ({
      path: path.relative(cwd, filePath).replace(/\\/g, '/'),
      document: readJsonFile(filePath, 'ATM_EVIDENCE_SCAN_INPUT_NOT_FOUND')
    }))
    .filter((entry: any) => entry.document?.schemaId === 'atm.evidencePatternDetectorReport');
}

async function evaluateUpgradeContextBudget(options: any, inputDocuments: any) {
  const hashDiffInput = inputDocuments.find((entry: any) => inferInputKind(entry.document.schemaId) === 'hash-diff');
  const qualityComparisonInput = inputDocuments.find((entry: any) => inferInputKind(entry.document.schemaId) === 'quality-comparison');
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
  const evaluation = governanceEnabled
    ? await resolveValue((createLocalGovernanceAdapter({ repositoryRoot: options.cwd }).stores.contextBudgetGuard as any).evaluateBudget(evaluationInput))
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
    ? await materializeUpgradeHardStop(options.cwd, atomId, qualityComparisonInput.path, evaluation, options.proposedAt ?? new Date().toISOString())
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

async function materializeUpgradeHardStop(cwd: any, atomId: any, qualityReportPath: any, evaluation: any, generatedAt: any) {
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

function readUpgradeContextBudgetPolicy(cwd: any) {
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

function evaluateContextBudgetInline(policy: any, input: any, generatedAt: any, reportPath: any) {
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
    summaryPath: decision === 'pass' ? undefined : `.atm/runtime/budget/${sanitizeUpgradeBudgetId(input.budgetId)}.md`
  };
}

function sanitizeUpgradeBudgetId(value: any) {
  return String(value || 'context-budget').replace(/\\/g, '/').replace(/[/:]+/g, '-');
}

function collectJsonFiles(rootDir: any): string[] {
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

function inferInputKind(schemaId: any) {
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
    case 'atm.evidencePatternDetectorReport':
      return 'evidence-pattern-report';
    default:
      return null;
  }
}

function requireOptionValue(argv: any, optionIndex: any, optionName: any) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `upgrade requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}
