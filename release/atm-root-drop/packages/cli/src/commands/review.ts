import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createLocalGovernanceAdapter } from '../../../plugin-governance-local/src/index.ts';
import { checkProgression, pauseProgression, readProgressionPolicy } from '../../../core/src/registry/progression-policy.ts';
import { readShadowComparisonReport } from '../../../core/src/maps/shadow-comparator.ts';
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
import { CliError, makeResult, message, parseJsonText, relativePathFrom } from './shared.ts';

export function runReview(argv: any) {
  const { options, positional } = parseReviewOptions(argv);
  const action = positional[0] ? String(positional[0]).trim().toLowerCase() : 'list';
  const proposalId = positional[1] ? String(positional[1]).trim() : '';

  if (!['list', 'show', 'approve', 'reject', 'apply-ready', 'rollout-ready', 'check-progression'].includes(action)) {
    throw new CliError('ATM_CLI_USAGE', `Unsupported review action: ${action}`, { exitCode: 2 });
  }

  if (action === 'check-progression') {
    return runCheckProgression(options.cwd, options.map, options.forcePause);
  }

  const queuePath = resolveExistingPath(options.cwd, options.queuePath, '.atm/reports/upgrade-proposals.json');
  const projectionPath = resolveExistingPath(options.cwd, options.projectionPath, '.atm/reports/upgrade-proposals.md');
  const decisionLogPath = resolveExistingPath(options.cwd, options.decisionLogPath, '.atm/reports/human-review-decisions.json');

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

  if (action === 'apply-ready') {
    if (queueRecord.status !== 'approved') {
      throw new CliError('ATM_REVIEW_APPLY_READY_REQUIRES_APPROVAL', `Proposal ${proposalId} is not approved yet.`, {
        exitCode: 2,
        details: {
          proposalId,
          status: queueRecord.status
        }
      });
    }
    const markdown = renderHumanReviewQueueMarkdown(queueDocument);
    writeTextFile(projectionPath, markdown);
    const applyPacket = buildApplyReadyPacket(queueRecord);
    return makeResult({
      ok: true,
      command: 'review',
      cwd: options.cwd,
      messages: [message('info', 'ATM_REVIEW_APPLY_READY_OK', `Approved proposal ${proposalId} is ready for actual patch planning within the governed leaf boundary.`, {
        proposalId,
        legacyTarget: applyPacket.legacyTarget
      })],
      evidence: {
        action: 'apply-ready',
        queuePath: relativePathFrom(options.cwd, queuePath),
        projectionPath: relativePathFrom(options.cwd, projectionPath),
        proposal: queueRecord,
        applyPacket,
        markdown
      }
    });
  }

  if (action === 'rollout-ready') {
    if (queueRecord.status !== 'approved') {
      throw new CliError('ATM_REVIEW_ROLLOUT_READY_REQUIRES_APPROVAL', `Proposal ${proposalId} is not approved yet.`, {
        exitCode: 2,
        details: {
          proposalId,
          status: queueRecord.status
        }
      });
    }
    const rolloutPacket = buildRolloutReadyPacket(options.cwd, queueRecord);
    const markdown = renderHumanReviewQueueMarkdown(queueDocument);
    writeTextFile(projectionPath, markdown);
    return makeResult({
      ok: true,
      command: 'review',
      cwd: options.cwd,
      messages: [message('info', 'ATM_REVIEW_ROLLOUT_READY_OK', `Approved proposal ${proposalId} has actual patch evidence and rollback-ready proof; the governed rollout is ready for closeout review.`, {
        proposalId,
        legacyTarget: rolloutPacket.legacyTarget
      })],
      evidence: {
        action: 'rollout-ready',
        queuePath: relativePathFrom(options.cwd, queuePath),
        projectionPath: relativePathFrom(options.cwd, projectionPath),
        proposal: queueRecord,
        rolloutPacket,
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
  const evidencePath = path.join(options.cwd, '.atm', 'history', 'evidence', `${queueRecord.atomId}.json`);

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

function runReviewList(cwd: any, queuePath: any, projectionPath: any) {
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

function buildApplyReadyPacket(queueRecord: any) {
  const legacyTarget = typeof queueRecord.proposal?.legacyTarget === 'string' ? queueRecord.proposal.legacyTarget : null;
  const [targetFile, targetSymbol] = splitLegacyTarget(legacyTarget);
  const rollbackInstructions = Array.isArray(queueRecord.proposal?.rollbackInstructions)
    ? queueRecord.proposal.rollbackInstructions.filter((entry: unknown): entry is string => typeof entry === 'string')
    : [];
  return {
    proposalId: queueRecord.proposalId,
    behaviorId: queueRecord.proposal?.behaviorId ?? null,
    guidanceSession: queueRecord.proposal?.guidanceSession ?? null,
    legacyTarget,
    targetFile,
    targetSymbol,
    approvedBy: queueRecord.review?.decidedBy ?? null,
    approvedAt: queueRecord.review?.decidedAt ?? null,
    approvalReason: queueRecord.review?.reason ?? null,
    rollbackInstructions,
    mutationBoundary: {
      allowed: targetSymbol
        ? `Only modify the approved leaf ${targetSymbol} and any directly extracted helper module owned by that leaf.`
        : 'Only modify the approved legacy leaf and any directly extracted helper module owned by that leaf.',
      blocked: [
        'Do not rewrite trunk functions.',
        'Do not expand scope to unrelated callsites.',
        'Do not mutate host files outside the approved legacy leaf boundary.'
      ]
    },
    applyReadiness: {
      approved: true,
      reviewStatus: queueRecord.status,
      dryRunProposalSatisfied: true,
      rollbackInstructionsPresent: rollbackInstructions.length > 0
    },
    nextStep: 'Implement the actual patch inside the approved leaf boundary, then collect smoke evidence and rollback-ready proof before broader rollout.'
  };
}

function buildRolloutReadyPacket(cwd: string, queueRecord: any) {
  const applyReadyPacket = buildApplyReadyPacket(queueRecord);
  const actualPatchEvidence = loadActualPatchEvidence(cwd, queueRecord.proposalId);
  if (!actualPatchEvidence) {
    throw new CliError('ATM_REVIEW_ROLLOUT_READY_EVIDENCE_MISSING', `Actual patch evidence is missing for ${queueRecord.proposalId}.`, {
      exitCode: 2,
      details: { proposalId: queueRecord.proposalId }
    });
  }
  const rollbackProofPath = typeof actualPatchEvidence.rollbackReadyProof?.proofPath === 'string'
    ? actualPatchEvidence.rollbackReadyProof.proofPath
    : null;
  if (!rollbackProofPath) {
    throw new CliError('ATM_REVIEW_ROLLOUT_READY_EVIDENCE_MISSING', `Rollback-ready proof is missing for ${queueRecord.proposalId}.`, {
      exitCode: 2,
      details: { proposalId: queueRecord.proposalId }
    });
  }
  const rollbackProof = readJsonFileSafe(rollbackProofPath);
  return {
    ...applyReadyPacket,
    actualPatchEvidence,
    rollbackReadyProof: {
      path: rollbackProofPath,
      report: rollbackProof
    },
    rolloutCloseout: {
      smokeEvidenceSatisfied: Array.isArray(actualPatchEvidence.smokeEvidence) && actualPatchEvidence.smokeEvidence.length > 0,
      rollbackReadySatisfied: rollbackProof?.rollbackReady === true,
      patchFiles: Array.isArray(actualPatchEvidence.patchFiles) ? actualPatchEvidence.patchFiles : []
    },
    nextStep: 'Use this rollout-ready packet to close out the governed leaf rollout, then decide whether to promote broader map-level evolution or queue the next approved leaf.'
  };
}

function loadActualPatchEvidence(cwd: string, proposalId: string) {
  const reportsRoot = path.join(cwd, '.atm', 'history', 'reports');
  if (!existsSync(reportsRoot)) {
    return null;
  }
  const matches = readdirSync(reportsRoot)
    .filter((entry: string) => entry.startsWith('actual-patch-evidence.') && entry.endsWith('.json'))
    .map((entry: string) => path.join(reportsRoot, entry))
    .flatMap((reportPath: string) => {
      const parsed = readJsonFileSafe(reportPath);
      if (!parsed || parsed.proposalId !== proposalId) {
        return [];
      }
      return [{
        reportPath,
        ...parsed
      }];
    })
    .sort((left: any, right: any) => String(right.generatedAt ?? '').localeCompare(String(left.generatedAt ?? '')));
  return matches[0] ?? null;
}

function splitLegacyTarget(legacyTarget: string | null) {
  if (!legacyTarget) {
    return [null, null] as const;
  }
  const separatorIndex = legacyTarget.lastIndexOf('#');
  if (separatorIndex < 0) {
    return [legacyTarget, null] as const;
  }
  return [
    legacyTarget.slice(0, separatorIndex),
    legacyTarget.slice(separatorIndex + 1) || null
  ] as const;
}

function readJsonFileSafe(filePath: string) {
  try {
    return parseJsonText(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function parseReviewOptions(argv: any) {
  const options: {
    cwd: string;
    queuePath: string;
    projectionPath: string;
    decisionLogPath: string;
    reason: string;
    decidedBy: string;
    decidedAt: string;
    map?: string;
    forcePause?: boolean;
  } = {
    cwd: process.cwd(),
    queuePath: '.atm/history/reports/upgrade-proposals.json',
    projectionPath: '.atm/history/reports/upgrade-proposals.md',
    decisionLogPath: '.atm/history/reports/human-review-decisions.json',
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
    if (arg === '--map') {
      options.map = requireOptionValue(argv, index, '--map');
      index += 1;
      continue;
    }
    if (arg === '--force-pause') {
      options.forcePause = true;
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

function requireOptionValue(argv: any, optionIndex: any, optionName: any) {
  const value = argv[optionIndex + 1];
  if (!value || value.startsWith('--')) {
    throw new CliError('ATM_CLI_USAGE', `review requires a value for ${optionName}`, { exitCode: 2 });
  }
  return value;
}

function resolvePath(cwd: any, maybeRelativePath: any) {
  return path.isAbsolute(maybeRelativePath)
    ? maybeRelativePath
    : path.resolve(cwd, maybeRelativePath);
}

function resolveExistingPath(cwd: any, primaryRelativePath: any, legacyRelativePath: any) {
  const primaryPath = resolvePath(cwd, primaryRelativePath);
  if (existsSync(primaryPath)) {
    return primaryPath;
  }
  const legacyPath = resolvePath(cwd, legacyRelativePath);
  return existsSync(legacyPath) ? legacyPath : primaryPath;
}

function readDecisionLogFile(filePath: any) {
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const parsed = parseJsonText(readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeJsonFile(filePath: any, value: any) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeTextFile(filePath: any, text: any) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, text, 'utf8');
}

function runCheckProgression(cwd: string, mapId: string | undefined, forcePause?: boolean) {
  if (!mapId) {
    throw new CliError('ATM_CLI_USAGE', 'review check-progression requires --map <mapId>.', { exitCode: 2 });
  }

  if (forcePause) {
    const policy = pauseProgression(cwd, mapId, process.env.AGENT_IDENTITY ?? 'manual');
    return makeResult({
      ok: true,
      command: 'review',
      cwd,
      messages: [message('info', 'ATM_PROGRESSION_PAUSED', `Progression automation paused for map ${mapId}.`, { mapId })],
      evidence: { action: 'check-progression', mapId, paused: true, policy }
    });
  }

  const shadowReport = readShadowComparisonReport(cwd, mapId);
  const result = checkProgression(cwd, mapId, shadowReport);
  const policy = readProgressionPolicy(cwd, mapId);

  return makeResult({
    ok: result.canPromote,
    command: 'review',
    cwd,
    messages: [
      message(
        result.canPromote ? 'info' : 'warn',
        result.canPromote ? 'ATM_PROGRESSION_CAN_PROMOTE' : 'ATM_PROGRESSION_BLOCKED',
        result.canPromote
          ? `Progression check passed: ${mapId} can advance from ${result.currentLane} to ${result.nextLane}.`
          : `Progression blocked for ${mapId}: ${result.blockedReasons[0] ?? 'unknown reason'}.`,
        { mapId, canPromote: result.canPromote, blockedReasons: result.blockedReasons }
      )
    ],
    evidence: {
      action: 'check-progression',
      mapId,
      checkedAt: result.checkedAt,
      canPromote: result.canPromote,
      blockedReasons: result.blockedReasons,
      currentLane: result.currentLane,
      nextLane: result.nextLane,
      proposal: result.proposal ?? null,
      nextProposalHint: result.nextProposalHint ?? null,
      automationLevel: policy.automationLevel,
      paused: result.paused
    }
  });
}
