import path from 'node:path';
import { createContinuationSummaryRecord, createLocalGovernanceAdapter } from '../../../plugin-governance-local/src/index.ts';
import { detectGovernanceRuntime } from './governance-runtime.mjs';
import { CliError, makeResult, message } from './shared.mjs';

export function runHandoff(argv) {
  const options = parseHandoffArgs(argv);
  const runtime = detectGovernanceRuntime(options.cwd);
  const taskId = options.taskId ?? runtime.currentTaskId;
  if (!taskId) {
    throw new CliError('ATM_CLI_USAGE', 'handoff summarize requires --task when no current task is recorded.', { exitCode: 2 });
  }

  const adapter = createLocalGovernanceAdapter({ repositoryRoot: options.cwd });
  const task = adapter.stores.taskStore.getTask(taskId);
  const evidence = adapter.stores.evidenceStore.listEvidence(taskId);
  const artifacts = adapter.stores.artifactStore.listArtifacts(taskId);
  const lock = adapter.stores.lockStore.getLock(taskId);
  const nextActions = [];

  if (lock && lock.released !== true && lock.status !== 'released') {
    nextActions.push(`Review or release the active lock for ${taskId}.`);
  }
  if (evidence.length === 0) {
    nextActions.push(`Record validation evidence for ${taskId}.`);
  }
  nextActions.push('Run npm test before handoff.');

  const summary = adapter.stores.contextSummaryStore.writeSummary(createContinuationSummaryRecord({
    workItemId: taskId,
    generatedAt: new Date().toISOString(),
    summaryId: `summary.handoff.${taskId.toLowerCase()}`,
    summary: [
      task ? `${task.title} is currently ${task.status}.` : `Task ${taskId} is being tracked without a stored task title.`,
      evidence.length > 0 ? `${evidence.length} evidence record(s) are linked.` : 'No evidence records are linked yet.',
      artifacts.length > 0 ? `${artifacts.length} artifact record(s) are linked.` : 'No artifact records are linked yet.'
    ].join(' '),
    nextActions,
    artifactPaths: artifacts.map((entry) => entry.artifactPath),
    evidencePaths: evidence.flatMap((entry) => entry.artifactPaths ?? []),
    authoredBy: '@ai-atomic-framework/cli:handoff',
    handoffKind: 'continuation',
    continuationGoal: `Resume governed work on ${taskId} with the recorded ATM state.`,
    resumePrompt: 'Read the stored handoff summary first, then inspect the linked evidence and artifacts.',
    resumeCommand: ['node', 'atm.mjs', 'next', '--json'],
    budgetDecision: evidence.length === 0 ? 'summarize-before-continue' : 'pass',
    hardStop: false
  }));

  return makeResult({
    ok: true,
    command: 'handoff',
    cwd: options.cwd,
    messages: [message('info', 'ATM_HANDOFF_SUMMARY_WRITTEN', 'Handoff summary written.', { taskId, summaryPath: summary.summaryMarkdownPath ?? null })],
    evidence: {
      taskId,
      summaryPath: runtime.paths.contextSummaryPath.replace('BOOTSTRAP-0001', taskId),
      summaryMarkdownPath: summary.summaryMarkdownPath ?? null,
      artifactCount: artifacts.length,
      evidenceCount: evidence.length,
      lockOwner: lock?.lockedBy ?? lock?.owner ?? null
    }
  });
}

function parseHandoffArgs(argv) {
  const state = {
    cwd: process.cwd(),
    taskId: null,
    subcommand: null
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
    if (arg === '--json') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `handoff does not support option ${arg}`, { exitCode: 2 });
    }
    if (state.subcommand) {
      throw new CliError('ATM_CLI_USAGE', 'handoff accepts only one subcommand', { exitCode: 2 });
    }
    state.subcommand = arg;
  }

  if (state.subcommand !== 'summarize') {
    throw new CliError('ATM_CLI_USAGE', 'handoff currently supports only: summarize', { exitCode: 2 });
  }

  return {
    cwd: path.resolve(state.cwd),
    taskId: state.taskId
  };
}

function requireValue(argv, optionIndex, optionName) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `handoff requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}
