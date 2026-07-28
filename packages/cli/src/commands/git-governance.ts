import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  createHistoricalWorkAdmissionAttestation,
  HISTORICAL_WORK_ADMISSION_ATTESTATION_PATH,
  type HistoricalWorkAdmissionAttestation
} from '../../../core/src/broker/historical-work-admission-attestation.ts';
import { evaluateTaskWorkAdmissionGate, readWorkAdmissionTicket } from './git-governance/work-admission-check.ts';
import { makeResult, message } from './shared.ts';
import {
  captureGitHeadEvidencePreparation,
  evaluateGitGovernanceCheck,
  listTaskOwnedProtectedOverrideAuditFiles,
  resolveActorGitIdentityForCommit,
  resolveGitExecutable,
  resolveTaskScopedCommitBundle,
  reconcileResolvedCrossTaskMutationIncident,
  rollbackFailedGitHeadEvidencePreparation,
  runAtmGit as runAtmGitImplementation
} from './git-governance/implementation.ts';

export {
  captureGitHeadEvidencePreparation,
  evaluateGitGovernanceCheck,
  listTaskOwnedProtectedOverrideAuditFiles,
  resolveActorGitIdentityForCommit,
  resolveGitExecutable,
  resolveTaskScopedCommitBundle,
  reconcileResolvedCrossTaskMutationIncident,
  rollbackFailedGitHeadEvidencePreparation
};

/**
 * The public git facade is the coverage seam for claim-issued admission.
 * It intentionally delegates all Git behaviour to the established module and
 * adds no independent policy; task-bound commit/push only proceed after the
 * ticket authority accepts the observed operation.
 */
export async function runAtmGit(argv: string[]) {
  const action = argv.find((entry) => entry === 'commit' || entry === 'push' || entry === 'attest') ?? '';
  if (action === 'attest') {
    return recordHistoricalWorkAdmissionAttestation(argv);
  }
  const taskId = readOption(argv, '--task');
  if (!taskId || (action !== 'commit' && action !== 'push')) {
    return runAtmGitImplementation(argv);
  }
  const cwd = readOption(argv, '--cwd') ?? process.cwd();
  const ticket = readWorkAdmissionTicket(cwd, taskId);
  const files = action === 'commit'
    ? readStagedFiles(cwd)
    : ticket?.grants.find((grant) => grant.kind === 'file-write')?.values ?? [];
  const gate = evaluateTaskWorkAdmissionGate({
    cwd,
    taskId,
    operation: action,
    files,
    producingAtmCommand: `node atm.mjs git ${action} --task ${taskId} --json`,
    observedContent: JSON.stringify({ action, files: [...files].sort() })
  });
  if (!gate.decision.ok) {
    return makeResult({
      ok: false,
      command: 'git',
      cwd,
      messages: [message('error', gate.decision.code, gate.decision.reason, { taskId, action, files })],
      evidence: { action, taskId, workAdmission: { decision: gate.decision, receipt: null } }
    });
  }
  const governedArgv = action === 'commit' && ticket
    ? appendWorkAdmissionTrailer(argv, ticket.ticketId, ticket.ticketDigest)
    : argv;
  const result = await runAtmGitImplementation(governedArgv);
  return {
    ...result,
    evidence: {
      ...(result.evidence ?? {}),
      workAdmission: { decision: gate.decision, receipt: gate.receipt }
    }
  };
}

function recordHistoricalWorkAdmissionAttestation(argv: readonly string[]) {
  const cwd = readOption(argv, '--cwd') ?? process.cwd();
  const commitSha = readOption(argv, '--commit');
  const taskId = readOption(argv, '--task');
  const actorId = readOption(argv, '--actor');
  const laneSessionId = readOption(argv, '--lane');
  const provenanceKind = readOption(argv, '--provenance-kind');
  const provenanceDigest = readOption(argv, '--provenance-digest');
  const provenanceRef = readOption(argv, '--provenance-ref');
  if (!commitSha || !taskId || !actorId || !laneSessionId || !provenanceDigest || !provenanceRef || !['ticket', 'emergency'].includes(provenanceKind ?? '')) {
    return makeResult({
      ok: false,
      command: 'git',
      cwd,
      messages: [message('error', 'ATM_CLI_USAGE', 'git attest requires --commit, --task, --actor, --lane, --provenance-kind ticket|emergency, --provenance-ref, and --provenance-digest.', {})]
    });
  }
  const scalar = (args: string[]) => {
    try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
  };
  const resolvedCommit = scalar(['rev-parse', '--verify', commitSha]);
  const parentCommitSha = scalar(['rev-parse', '--verify', `${commitSha}^`]);
  const treeSha = scalar(['show', '-s', '--format=%T', commitSha]);
  let ancestor = false;
  try { execFileSync('git', ['merge-base', '--is-ancestor', resolvedCommit, 'HEAD'], { cwd, stdio: 'ignore' }); ancestor = true; } catch { /* handled below */ }
  if (!resolvedCommit || !parentCommitSha || !treeSha || !ancestor) {
    return makeResult({
      ok: false,
      command: 'git',
      cwd,
      messages: [message('error', 'ATM_HISTORICAL_WORK_ADMISSION_ATTESTATION_INVALID', 'Historical attestation requires an existing non-root commit that is an ancestor of HEAD.', { commitSha })]
    });
  }
  const provenancePath = path.resolve(cwd, provenanceRef);
  if (!existsSync(provenancePath)) {
    return makeResult({ ok: false, command: 'git', cwd, messages: [message('error', 'ATM_HISTORICAL_WORK_ADMISSION_ATTESTATION_INVALID', 'Attestation provenance reference must be an existing immutable evidence file.', { provenanceRef })] });
  }
  const provenanceBytes = readFileSync(provenancePath);
  const observedProvenanceDigest = `sha256:${createHash('sha256').update(provenanceBytes).digest('hex')}`;
  if (observedProvenanceDigest !== provenanceDigest || !provenanceBytes.toString('utf8').includes(resolvedCommit)) {
    return makeResult({ ok: false, command: 'git', cwd, messages: [message('error', 'ATM_HISTORICAL_WORK_ADMISSION_ATTESTATION_INVALID', 'Attestation provenance digest or commit binding does not match the referenced evidence.', { provenanceRef, commitSha: resolvedCommit })] });
  }
  const record = createHistoricalWorkAdmissionAttestation({
    commitSha: resolvedCommit,
    parentCommitSha,
    treeSha,
    provenance: { kind: provenanceKind as 'ticket' | 'emergency', digest: provenanceDigest, ref: provenanceRef.replace(/\\/g, '/') },
    taskId,
    laneSessionId,
    attestedBy: actorId,
    attestedAt: new Date().toISOString()
  });
  const destination = path.join(cwd, HISTORICAL_WORK_ADMISSION_ATTESTATION_PATH);
  let attestations: HistoricalWorkAdmissionAttestation[] = [];
  if (existsSync(destination)) {
    try {
      const parsed = JSON.parse(readFileSync(destination, 'utf8')) as { attestations?: HistoricalWorkAdmissionAttestation[] };
      attestations = Array.isArray(parsed.attestations) ? parsed.attestations : [];
    } catch {
      return makeResult({ ok: false, command: 'git', cwd, messages: [message('error', 'ATM_HISTORICAL_WORK_ADMISSION_ATTESTATION_INVALID', 'Existing historical attestation ledger is not valid JSON.', { path: HISTORICAL_WORK_ADMISSION_ATTESTATION_PATH })] });
    }
  }
  if (attestations.some((entry) => entry.commitSha === resolvedCommit)) {
    return makeResult({ ok: false, command: 'git', cwd, messages: [message('error', 'ATM_HISTORICAL_WORK_ADMISSION_ATTESTATION_INVALID', 'A historical commit may have exactly one forward attestation.', { commitSha: resolvedCommit })] });
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, `${JSON.stringify({ schemaId: 'atm.historicalWorkAdmissionAttestationLedger.v1', attestations: [...attestations, record] }, null, 2)}\n`, 'utf8');
  return makeResult({ ok: true, command: 'git', cwd, messages: [message('info', 'ATM_HISTORICAL_WORK_ADMISSION_ATTESTED', 'Created an append-only historical work-admission attestation; commit it through the governed task bundle before push.', { path: HISTORICAL_WORK_ADMISSION_ATTESTATION_PATH, record })], evidence: { historicalWorkAdmissionAttestation: record } });
}

function appendWorkAdmissionTrailer(argv: readonly string[], ticketId: string, ticketDigest: string): string[] {
  const messageIndex = argv.indexOf('--message');
  const message = messageIndex >= 0 ? argv[messageIndex + 1] : null;
  if (!message || message.includes('ATM-Work-Admission:')) return [...argv];
  const next = [...argv];
  next[messageIndex + 1] = `${message}\n\nATM-Work-Admission: ${ticketId} ${ticketDigest}`;
  return next;
}

function readOption(argv: readonly string[], flag: string): string | null {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : null;
  return value && !value.startsWith('--') ? value : null;
}

function readStagedFiles(cwd: string): readonly string[] {
  try {
    return execFileSync('git', ['diff', '--cached', '--name-only'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).split(/\r?\n/).map((entry) => entry.trim().replace(/\\/g, '/')).filter(Boolean);
  } catch {
    return [];
  }
}
