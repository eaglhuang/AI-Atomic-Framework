import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  createHumanReviewDecisionLog,
  createHumanReviewQueueRecord,
  findHumanReviewQueueRecord,
  loadHumanReviewQueueDocument,
  renderHumanReviewQueueMarkdown,
  replaceHumanReviewQueueRecord,
  writeHumanReviewQueueDocument
} from '../../../plugin-human-review/src/index.ts';
import { CliError, makeResult, message, relativePathFrom } from './shared.mjs';

export function runReview(argv) {
  const options = parseReviewOptions(argv);
  const queuePath = resolvePath(options.cwd, options.queuePath);
  const projectionPath = resolvePath(options.cwd, options.projectionPath);
  const decisionLogPath = resolvePath(options.cwd, options.decisionLogPath);

  const queueDocument = loadHumanReviewQueueDocument(queuePath);
  if (!queueDocument) {
    throw new CliError('ATM_REVIEW_QUEUE_MISSING', 'Human review queue not found. Generate upgrade proposals first.', {
      exitCode: 2,
      details: { queuePath: relativePathFrom(options.cwd, queuePath) }
    });
  }

  if (options.action === 'list') {
    return makeResult({
      ok: true,
      command: 'review',
      cwd: options.cwd,
      messages: [message('info', 'ATM_REVIEW_LIST_OK', `Loaded ${queueDocument.entries.length} review proposal(s).`)],
      evidence: {
        action: 'list',
        queuePath: relativePathFrom(options.cwd, queuePath),
        generatedAt: queueDocument.generatedAt,
        proposals: queueDocument.entries
      }
    });
  }

  if (!options.proposalId) {
    throw new CliError('ATM_CLI_USAGE', `review ${options.action} requires --proposal`, { exitCode: 2 });
  }

  const queueRecord = findHumanReviewQueueRecord(queueDocument, options.proposalId);
  if (!queueRecord) {
    throw new CliError('ATM_REVIEW_PROPOSAL_NOT_FOUND', `Proposal not found in review queue: ${options.proposalId}`, {
      exitCode: 2,
      details: {
        proposalId: options.proposalId,
        queuePath: relativePathFrom(options.cwd, queuePath)
      }
    });
  }

  if (options.action === 'show') {
    return makeResult({
      ok: true,
      command: 'review',
      cwd: options.cwd,
      messages: [message('info', 'ATM_REVIEW_SHOW_OK', `Loaded review proposal ${options.proposalId}.`)],
      evidence: {
        action: 'show',
        queuePath: relativePathFrom(options.cwd, queuePath),
        proposal: queueRecord
      }
    });
  }

  const decision = options.action === 'approve' ? 'approve' : 'reject';
  if (!options.reason) {
    throw new CliError('ATM_CLI_USAGE', `review ${options.action} requires --reason`, { exitCode: 2 });
  }
  if (queueRecord.status === 'approved' || queueRecord.status === 'rejected') {
    throw new CliError('ATM_REVIEW_ALREADY_DECIDED', `Proposal ${options.proposalId} is already ${queueRecord.status}.`, {
      exitCode: 2,
      details: { proposalId: options.proposalId, status: queueRecord.status }
    });
  }

  const reviewedQueueRecord = createHumanReviewQueueRecord(queueRecord.proposal, {
    status: decision === 'approve' ? 'approved' : 'rejected',
    review: {
      decision,
      reason: options.reason,
      decidedBy: options.decidedBy,
      decidedAt: options.decidedAt,
      decisionSnapshotHash: queueRecord.proposalSnapshotHash,
      evidenceId: `human-review.${queueRecord.proposalId}.${decision}`
    }
  });
  const updatedQueueDocument = replaceHumanReviewQueueRecord(queueDocument, reviewedQueueRecord);

  writeHumanReviewQueueDocument(queuePath, updatedQueueDocument);
  writeTextFile(projectionPath, renderHumanReviewQueueMarkdown(updatedQueueDocument));

  const decisionLog = createHumanReviewDecisionLog({
    queueRecord,
    decision,
    reason: options.reason,
    decidedBy: options.decidedBy,
    decidedAt: options.decidedAt,
    queuePath: relativePathFrom(options.cwd, queuePath),
    projectionPath: relativePathFrom(options.cwd, projectionPath),
    evidenceId: `human-review.${queueRecord.proposalId}.${decision}`
  });
  const decisionLogs = readDecisionLogFile(decisionLogPath);
  decisionLogs.push(decisionLog);
  writeJsonFile(decisionLogPath, decisionLogs);

  return makeResult({
    ok: true,
    command: 'review',
    cwd: options.cwd,
    messages: [
      message('info', 'ATM_REVIEW_DECISION_RECORDED', `Recorded ${decision} decision for ${queueRecord.proposalId}.`, {
        proposalId: queueRecord.proposalId,
        decision
      })
    ],
    evidence: {
      action: decision,
      proposalId: queueRecord.proposalId,
      atomId: queueRecord.atomId,
      queuePath: relativePathFrom(options.cwd, queuePath),
      projectionPath: relativePathFrom(options.cwd, projectionPath),
      decisionLogPath: relativePathFrom(options.cwd, decisionLogPath),
      decisionLog,
      evidence: decisionLog.evidence
    }
  });
}

function parseReviewOptions(argv) {
  if (argv.length === 0) {
    throw new CliError('ATM_CLI_USAGE', 'review requires an action: list, show, approve, reject', { exitCode: 2 });
  }

  const action = argv[0];
  if (!['list', 'show', 'approve', 'reject'].includes(action)) {
    throw new CliError('ATM_CLI_USAGE', `Unsupported review action: ${action}`, { exitCode: 2 });
  }

  const options = {
    action,
    cwd: process.cwd(),
    queuePath: '.atm/reports/upgrade-proposals.json',
    projectionPath: '.atm/reports/upgrade-proposals.md',
    decisionLogPath: '.atm/reports/human-review-decisions.json',
    proposalId: null,
    reason: '',
    decidedBy: 'ATM reviewer',
    decidedAt: new Date().toISOString()
  };

  for (let index = 1; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--cwd') {
      options.cwd = requireOptionValue(argv, index, '--cwd');
      index += 1;
      continue;
    }
    if (arg === '--queue') {
      options.queuePath = requireOptionValue(argv, index, '--queue');
      index += 1;
      continue;
    }
    if (arg === '--projection') {
      options.projectionPath = requireOptionValue(argv, index, '--projection');
      index += 1;
      continue;
    }
    if (arg === '--decision-log') {
      options.decisionLogPath = requireOptionValue(argv, index, '--decision-log');
      index += 1;
      continue;
    }
    if (arg === '--proposal') {
      options.proposalId = requireOptionValue(argv, index, '--proposal');
      index += 1;
      continue;
    }
    if (arg === '--reason') {
      options.reason = requireOptionValue(argv, index, '--reason');
      index += 1;
      continue;
    }
    if (arg === '--by') {
      options.decidedBy = requireOptionValue(argv, index, '--by');
      index += 1;
      continue;
    }
    if (arg === '--at') {
      options.decidedAt = requireOptionValue(argv, index, '--at');
      index += 1;
      continue;
    }
    if (arg === '--json') {
      continue;
    }
    if (arg.startsWith('--')) {
      throw new CliError('ATM_CLI_USAGE', `review ${options.action} does not support option ${arg}`, { exitCode: 2 });
    }
  }

  return {
    ...options,
    cwd: path.resolve(options.cwd)
  };
}

function requireOptionValue(argv, optionIndex, optionName) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `review requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}

function resolvePath(cwd, maybeRelativePath) {
  return path.isAbsolute(maybeRelativePath)
    ? maybeRelativePath
    : path.resolve(cwd, maybeRelativePath);
}

function readDecisionLogFile(filePath) {
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJsonFile(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeTextFile(filePath, text) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, text, 'utf8');
}