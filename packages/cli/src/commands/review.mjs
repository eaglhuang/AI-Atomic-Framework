import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createLocalGovernanceAdapter } from '../../../plugin-governance-local/src/index.ts';
import {
  computeDecisionSnapshotHash,
  createHumanReviewDecisionLog,
  createHumanReviewQueueDocument,
  createHumanReviewQueueRecord,
  findHumanReviewQueueRecord,
  loadHumanReviewQueueDocument,
  renderHumanReviewQueueMarkdown,
  replaceHumanReviewQueueRecord,
  validateHumanReviewDecisionLog,
  validateHumanReviewQueueDocument,
  validateHumanReviewQueueRecord,
  writeHumanReviewQueueDocument
} from '../../../plugin-human-review/src/index.ts';
import { CliError, makeResult, message, relativePathFrom } from './shared.mjs';

export function runReview(argv) {
  const { options, positional } = parseReviewOptions(argv);
  const action = positional[0] ? String(positional[0]).trim().toLowerCase() : 'list';
  const proposalId = positional[1] ? String(positional[1]).trim() : '';

  if (!['list', 'show', 'approve', 'reject'].includes(action)) {
    throw new CliError('ATM_CLI_USAGE', `Unsupported review action: ${action}`, { exitCode: 2 });
  }

  const queuePath = resolvePath(options.cwd, options.queuePath);
  const projectionPath = resolvePath(options.cwd, options.projectionPath);
  const decisionLogPath = resolvePath(options.cwd, options.decisionLogPath);

  if (action === 'list') {
    return runReviewList(options.cwd, queuePath, projectionPath);
  }

  const queueDocument = loadHumanReviewQueueDocument(queuePath);
  if (!queueDocument) {
    throw new CliError('ATM_REVIEW_QUEUE_MISSING', 'Human review queue not found. Generate upgrade proposals first.', {
      exitCode: 2,
      details: { queuePath: relativePathFrom(options.cwd, queuePath) }
    });
  }

  const queueValidation = validateHumanReviewQueueDocument(queueDocument);
  if (!queueValidation.ok) {
    throw new CliError('ATM_REVIEW_QUEUE_INVALID', 'Human review queue is invalid.', {
      exitCode: 2,
      details: { issues: queueValidation.issues }
    });
  }

  if (!proposalId) {
    throw new CliError('ATM_CLI_USAGE', `review ${action} requires <proposalId>`, { exitCode: 2 });
  }

  const queueRecord = findHumanReviewQueueRecord(queueDocument, proposalId);
  if (!queueRecord) {
    throw new CliError('ATM_REVIEW_PROPOSAL_NOT_FOUND', `Proposal not found in review queue: ${proposalId}`, {
      exitCode: 2,
      details: {
        proposalId,
        queuePath: relativePathFrom(options.cwd, queuePath)
      }
    });
  }

  if (action === 'show') {
    const markdown = renderHumanReviewQueueMarkdown(queueDocument);
    writeTextFile(projectionPath, markdown);
    return makeResult({
      ok: true,
      command: 'review',
      cwd: options.cwd,
      messages: [message('info', 'ATM_REVIEW_SHOW_OK', `Loaded review proposal ${proposalId}.`)],
      evidence: {
        action: 'show',
        queuePath: relativePathFrom(options.cwd, queuePath),
        projectionPath: relativePathFrom(options.cwd, projectionPath),
        proposal: queueRecord,
        markdown
      }
    });
  }

  if (!options.reason) {
    throw new CliError('ATM_CLI_USAGE', `review ${action} requires --reason`, { exitCode: 2 });
  }
  if (queueRecord.status === 'approved' || queueRecord.status === 'rejected') {
    throw new CliError('ATM_REVIEW_ALREADY_DECIDED', `Proposal ${proposalId} is already ${queueRecord.status}.`, {
      exitCode: 2,
      details: { proposalId, status: queueRecord.status }
    });
  }

  const currentValidation = validateHumanReviewQueueRecord(queueRecord);
  if (!currentValidation.ok) {
    throw new CliError('ATM_REVIEW_RECORD_INVALID', 'Proposal queue record is invalid.', {
      exitCode: 2,
      details: { issues: currentValidation.issues }
    });
  }

  const decision = action === 'approve' ? 'approve' : 'reject';
  const decisionSnapshotHash = computeDecisionSnapshotHash(queueRecord.proposal);
  if (decisionSnapshotHash !== queueRecord.proposalSnapshotHash) {
    throw new CliError('ATM_HUMAN_REVIEW_SNAPSHOT_MISMATCH', 'decision-snapshot.hash mismatch.', {
      exitCode: 2,
      details: {
        proposalId,
        expected: queueRecord.proposalSnapshotHash,
        actual: decisionSnapshotHash
      }
    });
  }

  const reviewedQueueRecord = createHumanReviewQueueRecord(queueRecord.proposal, {
    status: decision === 'approve' ? 'approved' : 'rejected',
    review: {
      decision,
      reason: options.reason,
      decidedBy: options.decidedBy,
      decidedAt: options.decidedAt,
      decisionSnapshotHash,
      evidenceId: `human-review.${queueRecord.proposalId}.${decision}`
    }
  });
  const updatedQueueDocument = replaceHumanReviewQueueRecord(queueDocument, reviewedQueueRecord);

  const decisionLog = createHumanReviewDecisionLog({
    queueRecord: reviewedQueueRecord,
    decision,
    reason: options.reason,
    decidedBy: options.decidedBy,
    decidedAt: options.decidedAt,
    queuePath: relativePathFrom(options.cwd, queuePath),
    projectionPath: relativePathFrom(options.cwd, projectionPath),
    evidenceId: `human-review.${queueRecord.proposalId}.${decision}`
  });
  const decisionLogValidation = validateHumanReviewDecisionLog(decisionLog);
  if (!decisionLogValidation.ok) {
    throw new CliError('ATM_REVIEW_DECISION_INVALID', 'Generated decision log is invalid.', {
      exitCode: 2,
      details: { issues: decisionLogValidation.issues }
    });
  }

  writeHumanReviewQueueDocument(queuePath, updatedQueueDocument);
  const markdown = renderHumanReviewQueueMarkdown(updatedQueueDocument);
  writeTextFile(projectionPath, markdown);

  const decisionLogs = readDecisionLogFile(decisionLogPath);
  decisionLogs.push(decisionLog);
  writeJsonFile(decisionLogPath, decisionLogs);

  const governance = createLocalGovernanceAdapter({ repositoryRoot: options.cwd });
  const storedEvidence = governance.stores.evidenceStore.writeEvidence(queueRecord.atomId, decisionLog.evidence);
  const evidencePath = path.join(options.cwd, '.atm', 'evidence', `${queueRecord.atomId}.json`);

  return makeResult({
    ok: true,
    command: 'review',
    cwd: options.cwd,
    messages: [
      message('info', decision === 'approve' ? 'ATM_REVIEW_APPROVED' : 'ATM_REVIEW_REJECTED', `Recorded ${decision} decision for ${queueRecord.proposalId}.`, {
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
      evidence: storedEvidence,
      evidencePath: relativePathFrom(options.cwd, evidencePath),
      decisionSnapshotHash,
      status: reviewedQueueRecord.status
    }
  });
}

function runReviewList(cwd, queuePath, projectionPath) {
  const queueDocument = loadHumanReviewQueueDocument(queuePath)
    ?? createHumanReviewQueueDocument([], { generatedAt: new Date().toISOString() });
  const queueValidation = validateHumanReviewQueueDocument(queueDocument);
  if (!queueValidation.ok && queueDocument.entries.length > 0) {
    throw new CliError('ATM_REVIEW_QUEUE_INVALID', 'Human review queue is invalid.', {
      exitCode: 2,
      details: { issues: queueValidation.issues }
    });
  }

  writeHumanReviewQueueDocument(queuePath, queueDocument);
  const markdown = renderHumanReviewQueueMarkdown(queueDocument);
  writeTextFile(projectionPath, markdown);

  return makeResult({
    ok: true,
    command: 'review',
    cwd,
    messages: [message('info', 'ATM_REVIEW_LIST_OK', `Loaded ${queueDocument.entries.length} review proposal(s).`)],
    evidence: {
      action: 'list',
      queuePath: relativePathFrom(cwd, queuePath),
      projectionPath: relativePathFrom(cwd, projectionPath),
      generatedAt: queueDocument.generatedAt,
      proposals: queueDocument.entries,
      markdown
    }
  });
}

function parseReviewOptions(argv) {
  const options = {
    cwd: process.cwd(),
    queuePath: '.atm/reports/upgrade-proposals.json',
    projectionPath: '.atm/reports/upgrade-proposals.md',
    decisionLogPath: '.atm/reports/human-review-decisions.json',
    reason: '',
    decidedBy: process.env.AGENT_IDENTITY || 'ATM reviewer',
    decidedAt: new Date().toISOString()
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
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
      throw new CliError('ATM_CLI_USAGE', `review does not support option ${arg}`, { exitCode: 2 });
    }
    positional.push(arg);
  }

  return {
    options: {
      ...options,
      cwd: path.resolve(options.cwd)
    },
    positional
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
