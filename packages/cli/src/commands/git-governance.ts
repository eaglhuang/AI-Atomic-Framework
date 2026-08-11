import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  createForwardAttestation,
  evaluateHistoricalWorkAdmission,
  HISTORICAL_WORK_ADMISSION_ATTESTATION_PATH,
  type HistoricalWorkAdmissionAttestation
} from '../../../core/src/broker/historical-work-admission-attestation.ts';
import { pathMatchesWriteScope } from '../../../core/src/broker/write-scope-policy.ts';
import { evaluateTaskWorkAdmissionGate, evaluateWorkAdmissionGate, readWorkAdmissionTicket, resolveWorkAdmissionTicket } from './git-governance/work-admission-check.ts';
import { makeResult, message } from './shared.ts';
import {
  captureGitHeadEvidencePreparation,
  evaluateGitGovernanceCheck,
  listTaskOwnedProtectedOverrideAuditFiles,
  inspectGitIndexLock,
  recoverGitIndexLock,
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
  inspectGitIndexLock,
  recoverGitIndexLock,
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
  const actorId = readOption(argv, '--actor') ?? '';
  const ticketInput = {
    cwd, taskId, actorId, operation: action as 'commit' | 'push', files: [] as readonly string[],
    producingAtmCommand: `node atm.mjs git ${action} --task ${taskId} --json`
  };
  const ledgerTicket = readWorkAdmissionTicket(cwd, taskId);
  const initialTicket = ledgerTicket ?? resolveWorkAdmissionTicket(ticketInput);
  const files = action === 'commit'
    ? selectTicketValidatedCommitFiles(
      readStagedFiles(cwd),
      initialTicket,
      argv.includes('--defer-foreign-staged'),
      argv.includes('--auto-stage')
    )
    : initialTicket?.grants.find((grant) => grant.kind === 'file-write')?.values ?? [];
  const ticket = resolveWorkAdmissionTicket({ ...ticketInput, files });
  const gate = ledgerTicket
    ? evaluateTaskWorkAdmissionGate({ cwd, taskId, operation: action, files, producingAtmCommand: ticketInput.producingAtmCommand, observedContent: JSON.stringify({ action, files: [...files].sort() }) })
    : evaluateWorkAdmissionGate({ ...ticketInput, files, observedContent: JSON.stringify({ action, files: [...files].sort() }) });
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

/**
 * Decide which staged paths a governed commit is admitted against.
 *
 * Admission has to judge the paths the commit will actually write. Once any
 * in-scope path is staged, the commit resolves a task-scoped bundle and runs it
 * through a sealed candidate index, which is exactly the mechanism that keeps
 * unrelated staged entries out of the commit. Judging that commit against those
 * entries rejects it for something it cannot do.
 *
 * That mattered more than it looks. Scoping used to be conditional on
 * `--defer-foreign-staged`, so a commit whose own bundle was fully in scope was
 * denied whenever any other lane had something staged, and the only documented
 * way forward was the flag — which unstages the other lane's paths. A gate
 * meant to stop one lane from touching another lane's index bytes was making
 * that touch the only route past it. Scoping now follows transaction state, and
 * the flag governs only whether foreign entries are snapshotted and unstaged.
 *
 * `--auto-stage` reaches admission before it has staged anything, so nothing in
 * scope is staged yet even though the commit is provably task-scoped: the flag
 * is a declaration that exactly the ticket bundle will be staged. Admission
 * therefore judges that bundle. Keying this on the deferral flag instead would
 * reintroduce the same conflation in the other branch.
 *
 * The final fallback is the safety property, not a leftover. With nothing in
 * scope staged and no declared bundle, the commit falls back to the whole
 * staged surface; admission must then see that whole surface, or an
 * out-of-scope path would be committed unjudged.
 */
export function selectTicketValidatedCommitFiles(
  stagedFiles: readonly string[],
  ticket: ReturnType<typeof resolveWorkAdmissionTicket>,
  deferForeignStaged: boolean,
  stagesExactlyTheTicketBundle = false
): readonly string[] {
  if (!ticket) return stagedFiles;
  const fileScopes = ticket.grants.find((grant) => grant.kind === 'file-write')?.values ?? [];
  const filtered = stagedFiles.filter((file) => fileScopes.some((scope) => pathMatchesWriteScope(file, scope)));
  if (filtered.length > 0) return filtered;
  if (stagesExactlyTheTicketBundle) return fileScopes;
  return deferForeignStaged ? filtered : stagedFiles;
}

function recordHistoricalWorkAdmissionAttestation(argv: readonly string[]) {
  const cwd = readOption(argv, '--cwd') ?? process.cwd();
  const statusOnly = argv.includes('--status');
  const validateOnly = argv.includes('--validate');
  const dryRun = argv.includes('--dry-run');
  const commitSha = readOption(argv, '--commit');
  const taskId = readOption(argv, '--task');
  const actorId = readOption(argv, '--actor');
  const laneSessionId = readOption(argv, '--lane');
  const provenanceKind = readOption(argv, '--provenance-kind');
  const provenanceDigest = readOption(argv, '--provenance-digest');
  const provenanceRef = readOption(argv, '--provenance-ref');
  const reason = readOption(argv, '--reason');
  const emergencyClass = readOption(argv, '--emergency-class');
  const evidenceRefs = readRepeatedOption(argv, '--evidence-ref');
  const scope = readRepeatedOption(argv, '--scope');
  const ledger = readHistoricalAttestationLedger(cwd);
  if (statusOnly) {
    const matching = commitSha ? ledger.attestations.filter((entry) => entry.commitSha === commitSha) : [];
    return makeResult({
      ok: true,
      command: 'git',
      cwd,
      messages: [message('info', 'ATM_HISTORICAL_WORK_ADMISSION_ATTESTATION_STATUS', 'Historical work-admission attestation ledger status is available.', {
        path: HISTORICAL_WORK_ADMISSION_ATTESTATION_PATH,
        attestationCount: ledger.attestations.length,
        commitSha: commitSha ?? null,
        matchingCount: matching.length
      })],
      evidence: { action: 'attest-status', path: HISTORICAL_WORK_ADMISSION_ATTESTATION_PATH, attestationCount: ledger.attestations.length, matching }
    });
  }
  if (validateOnly) {
    const findings = ledger.attestations.flatMap((entry) => validateExistingHistoricalAttestation(cwd, entry));
    return makeResult({
      ok: findings.length === 0,
      command: 'git',
      cwd,
      messages: [findings.length === 0
        ? message('info', 'ATM_HISTORICAL_WORK_ADMISSION_ATTESTATION_VALID', 'Historical work-admission attestations are valid.', { path: HISTORICAL_WORK_ADMISSION_ATTESTATION_PATH, attestationCount: ledger.attestations.length })
        : message('error', 'ATM_HISTORICAL_WORK_ADMISSION_ATTESTATION_INVALID', 'Historical work-admission attestation validation failed.', { path: HISTORICAL_WORK_ADMISSION_ATTESTATION_PATH, findings })],
      evidence: { action: 'attest-validate', path: HISTORICAL_WORK_ADMISSION_ATTESTATION_PATH, attestationCount: ledger.attestations.length, findings }
    });
  }
  if (!commitSha || !taskId || !actorId || !laneSessionId || !provenanceDigest || !provenanceRef || !['ticket', 'emergency'].includes(provenanceKind ?? '')) {
    return makeResult({
      ok: false,
      command: 'git',
      cwd,
      messages: [message('error', 'ATM_CLI_USAGE', 'git attest requires --commit, --task, --actor, --lane, --provenance-kind ticket|emergency, --provenance-ref, and --provenance-digest. Use --dry-run to preview, --status to inspect, or --validate to verify the ledger.', {})]
    });
  }
  if (provenanceKind === 'emergency') {
    const missing = [
      !reason ? '--reason' : null,
      evidenceRefs.length === 0 ? '--evidence-ref' : null,
      !emergencyClass ? '--emergency-class' : null,
      scope.length === 0 ? '--scope' : null
    ].filter(Boolean);
    if (missing.length > 0) {
      return makeResult({
        ok: false,
        command: 'git',
        cwd,
        messages: [message('error', 'ATM_CLI_USAGE', `git attest emergency mode requires ${missing.join(', ')}.`, {
          requiredCommand: 'node atm.mjs git attest --commit <sha> --task <task-id> --actor <actor> --lane <lane-id> --provenance-kind emergency --provenance-ref <file-or-git:sha> --provenance-digest sha256:<digest> --reason <reason> --emergency-class <class> --scope <path> --evidence-ref <ref> --dry-run --json'
        })]
      });
    }
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
  let provenanceBytes: Buffer;
  if (provenanceRef === `git:${resolvedCommit}`) {
    const commitMessage = scalar(['log', '-1', '--format=%B', resolvedCommit]);
    if (!commitMessage.includes('ATM-Emergency-Reason:')) {
      return makeResult({ ok: false, command: 'git', cwd, messages: [message('error', 'ATM_HISTORICAL_WORK_ADMISSION_ATTESTATION_INVALID', 'A git:<commit> provenance reference requires the immutable commit message to carry ATM-Emergency-Reason.', { commitSha: resolvedCommit })] });
    }
    provenanceBytes = Buffer.from(commitMessage, 'utf8');
  } else {
    const provenancePath = path.resolve(cwd, provenanceRef);
    if (!existsSync(provenancePath)) {
      return makeResult({ ok: false, command: 'git', cwd, messages: [message('error', 'ATM_HISTORICAL_WORK_ADMISSION_ATTESTATION_INVALID', 'Attestation provenance reference must be an existing immutable evidence file or git:<commit>.', { provenanceRef })] });
    }
    provenanceBytes = readFileSync(provenancePath);
  }
  const observedProvenanceDigest = `sha256:${createHash('sha256').update(provenanceBytes).digest('hex')}`;
  if (observedProvenanceDigest !== provenanceDigest || (!provenanceRef.startsWith('git:') && !provenanceBytes.toString('utf8').includes(resolvedCommit))) {
    return makeResult({ ok: false, command: 'git', cwd, messages: [message('error', 'ATM_HISTORICAL_WORK_ADMISSION_ATTESTATION_INVALID', 'Attestation provenance digest or commit binding does not match the referenced evidence.', { provenanceRef, commitSha: resolvedCommit })] });
  }
  const record = createForwardAttestation({
    commit: { commitSha: resolvedCommit, parentCommitSha, treeSha },
    provenance: { kind: provenanceKind as 'ticket' | 'emergency', digest: provenanceDigest, ref: provenanceRef.replace(/\\/g, '/') },
    reason,
    evidenceRefs,
    emergencyClass,
    scope,
    taskId,
    laneSessionId,
    attestedBy: actorId,
    attestedAt: new Date().toISOString()
  });
  if (dryRun) {
    return makeResult({
      ok: true,
      command: 'git',
      cwd,
      messages: [message('info', 'ATM_HISTORICAL_WORK_ADMISSION_ATTESTATION_DRY_RUN', 'Forward attestation dry-run succeeded; no ledger was written.', { record })],
      evidence: { action: 'attest-dry-run', historicalWorkAdmissionAttestation: record }
    });
  }
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

function readHistoricalAttestationLedger(cwd: string): { attestations: HistoricalWorkAdmissionAttestation[] } {
  const destination = path.join(cwd, HISTORICAL_WORK_ADMISSION_ATTESTATION_PATH);
  if (!existsSync(destination)) return { attestations: [] };
  const parsed = JSON.parse(readFileSync(destination, 'utf8')) as { attestations?: HistoricalWorkAdmissionAttestation[] };
  return { attestations: Array.isArray(parsed.attestations) ? parsed.attestations : [] };
}

function validateExistingHistoricalAttestation(cwd: string, entry: HistoricalWorkAdmissionAttestation) {
  const scalar = (args: string[]) => {
    try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; }
  };
  const parentCommitSha = scalar(['rev-parse', '--verify', `${entry.commitSha}^`]);
  const treeSha = scalar(['show', '-s', '--format=%T', entry.commitSha]);
  const ancestor = (() => {
    try { execFileSync('git', ['merge-base', '--is-ancestor', entry.commitSha, 'HEAD'], { cwd, stdio: 'ignore' }); return true; } catch { return false; }
  })();
  const evaluation = evaluateHistoricalWorkAdmission({
    commit: { commitSha: entry.commitSha, parentCommitSha, treeSha, isAncestorOfHead: ancestor },
    hasNormalWorkAdmissionTrailer: false,
    attestations: [entry],
    isProvenanceValid: (record) => {
      if (record.provenance.ref === `git:${record.commitSha}`) {
        const messageText = scalar(['log', '-1', '--format=%B', record.commitSha]);
        return messageText.includes('ATM-Emergency-Reason:')
          && `sha256:${createHash('sha256').update(messageText).digest('hex')}` === record.provenance.digest;
      }
      const provenancePath = path.resolve(cwd, record.provenance.ref);
      if (!existsSync(provenancePath)) return false;
      const bytes = readFileSync(provenancePath);
      return `sha256:${createHash('sha256').update(bytes).digest('hex')}` === record.provenance.digest
        && bytes.toString('utf8').includes(record.commitSha);
    }
  });
  return evaluation.decision === 'covered' ? [] : [{ commitSha: entry.commitSha, code: evaluation.code, reason: evaluation.reason }];
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

function readRepeatedOption(argv: readonly string[], flag: string): readonly string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== flag) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) continue;
    values.push(...value.split(',').map((entry) => entry.trim()).filter(Boolean));
  }
  return [...new Set(values)];
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
