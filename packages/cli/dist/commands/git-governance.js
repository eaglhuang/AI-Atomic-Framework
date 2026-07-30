import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createForwardAttestation, evaluateHistoricalWorkAdmission, HISTORICAL_WORK_ADMISSION_ATTESTATION_PATH } from '../../../core/dist/broker/historical-work-admission-attestation.js';
import { pathMatchesWriteScope } from '../../../core/dist/broker/write-scope-policy.js';
import { evaluateTaskWorkAdmissionGate, evaluateWorkAdmissionGate, readWorkAdmissionTicket, resolveWorkAdmissionTicket } from './git-governance/work-admission-check.js';
import { makeResult, message } from './shared.js';
import { captureGitHeadEvidencePreparation, evaluateGitGovernanceCheck, listTaskOwnedProtectedOverrideAuditFiles, resolveActorGitIdentityForCommit, resolveGitExecutable, resolveTaskScopedCommitBundle, reconcileResolvedCrossTaskMutationIncident, rollbackFailedGitHeadEvidencePreparation, runAtmGit as runAtmGitImplementation } from './git-governance/implementation.js';
export { captureGitHeadEvidencePreparation, evaluateGitGovernanceCheck, listTaskOwnedProtectedOverrideAuditFiles, resolveActorGitIdentityForCommit, resolveGitExecutable, resolveTaskScopedCommitBundle, reconcileResolvedCrossTaskMutationIncident, rollbackFailedGitHeadEvidencePreparation };
/**
 * The public git facade is the coverage seam for claim-issued admission.
 * It intentionally delegates all Git behaviour to the established module and
 * adds no independent policy; task-bound commit/push only proceed after the
 * ticket authority accepts the observed operation.
 */
export async function runAtmGit(argv) {
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
        cwd, taskId, actorId, operation: action, files: [],
        producingAtmCommand: `node atm.mjs git ${action} --task ${taskId} --json`
    };
    const ledgerTicket = readWorkAdmissionTicket(cwd, taskId);
    const initialTicket = ledgerTicket ?? resolveWorkAdmissionTicket(ticketInput);
    const files = action === 'commit'
        ? selectTicketValidatedCommitFiles(readStagedFiles(cwd), initialTicket, argv.includes('--defer-foreign-staged'), argv.includes('--auto-stage'))
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
 * `--defer-foreign-staged` promises that the governed commit will preserve
 * foreign index entries. Admission must therefore see the same filtered
 * bundle, rather than reject the current task for paths it will not mutate.
 */
export function selectTicketValidatedCommitFiles(stagedFiles, ticket, deferForeignStaged, useTicketScopeWhenDeferredIndexIsEmpty = false) {
    if (!deferForeignStaged || !ticket)
        return stagedFiles;
    const fileScopes = ticket.grants.find((grant) => grant.kind === 'file-write')?.values ?? [];
    const filtered = stagedFiles.filter((file) => fileScopes.some((scope) => pathMatchesWriteScope(file, scope)));
    return filtered.length > 0 || !useTicketScopeWhenDeferredIndexIsEmpty
        ? filtered
        : fileScopes;
}
function recordHistoricalWorkAdmissionAttestation(argv) {
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
    const scalar = (args) => {
        try {
            return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        }
        catch {
            return '';
        }
    };
    const resolvedCommit = scalar(['rev-parse', '--verify', commitSha]);
    const parentCommitSha = scalar(['rev-parse', '--verify', `${commitSha}^`]);
    const treeSha = scalar(['show', '-s', '--format=%T', commitSha]);
    let ancestor = false;
    try {
        execFileSync('git', ['merge-base', '--is-ancestor', resolvedCommit, 'HEAD'], { cwd, stdio: 'ignore' });
        ancestor = true;
    }
    catch { /* handled below */ }
    if (!resolvedCommit || !parentCommitSha || !treeSha || !ancestor) {
        return makeResult({
            ok: false,
            command: 'git',
            cwd,
            messages: [message('error', 'ATM_HISTORICAL_WORK_ADMISSION_ATTESTATION_INVALID', 'Historical attestation requires an existing non-root commit that is an ancestor of HEAD.', { commitSha })]
        });
    }
    let provenanceBytes;
    if (provenanceRef === `git:${resolvedCommit}`) {
        const commitMessage = scalar(['log', '-1', '--format=%B', resolvedCommit]);
        if (!commitMessage.includes('ATM-Emergency-Reason:')) {
            return makeResult({ ok: false, command: 'git', cwd, messages: [message('error', 'ATM_HISTORICAL_WORK_ADMISSION_ATTESTATION_INVALID', 'A git:<commit> provenance reference requires the immutable commit message to carry ATM-Emergency-Reason.', { commitSha: resolvedCommit })] });
        }
        provenanceBytes = Buffer.from(commitMessage, 'utf8');
    }
    else {
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
        provenance: { kind: provenanceKind, digest: provenanceDigest, ref: provenanceRef.replace(/\\/g, '/') },
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
    let attestations = [];
    if (existsSync(destination)) {
        try {
            const parsed = JSON.parse(readFileSync(destination, 'utf8'));
            attestations = Array.isArray(parsed.attestations) ? parsed.attestations : [];
        }
        catch {
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
function readHistoricalAttestationLedger(cwd) {
    const destination = path.join(cwd, HISTORICAL_WORK_ADMISSION_ATTESTATION_PATH);
    if (!existsSync(destination))
        return { attestations: [] };
    const parsed = JSON.parse(readFileSync(destination, 'utf8'));
    return { attestations: Array.isArray(parsed.attestations) ? parsed.attestations : [] };
}
function validateExistingHistoricalAttestation(cwd, entry) {
    const scalar = (args) => {
        try {
            return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        }
        catch {
            return '';
        }
    };
    const parentCommitSha = scalar(['rev-parse', '--verify', `${entry.commitSha}^`]);
    const treeSha = scalar(['show', '-s', '--format=%T', entry.commitSha]);
    const ancestor = (() => {
        try {
            execFileSync('git', ['merge-base', '--is-ancestor', entry.commitSha, 'HEAD'], { cwd, stdio: 'ignore' });
            return true;
        }
        catch {
            return false;
        }
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
            if (!existsSync(provenancePath))
                return false;
            const bytes = readFileSync(provenancePath);
            return `sha256:${createHash('sha256').update(bytes).digest('hex')}` === record.provenance.digest
                && bytes.toString('utf8').includes(record.commitSha);
        }
    });
    return evaluation.decision === 'covered' ? [] : [{ commitSha: entry.commitSha, code: evaluation.code, reason: evaluation.reason }];
}
function appendWorkAdmissionTrailer(argv, ticketId, ticketDigest) {
    const messageIndex = argv.indexOf('--message');
    const message = messageIndex >= 0 ? argv[messageIndex + 1] : null;
    if (!message || message.includes('ATM-Work-Admission:'))
        return [...argv];
    const next = [...argv];
    next[messageIndex + 1] = `${message}\n\nATM-Work-Admission: ${ticketId} ${ticketDigest}`;
    return next;
}
function readOption(argv, flag) {
    const index = argv.indexOf(flag);
    const value = index >= 0 ? argv[index + 1] : null;
    return value && !value.startsWith('--') ? value : null;
}
function readRepeatedOption(argv, flag) {
    const values = [];
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] !== flag)
            continue;
        const value = argv[index + 1];
        if (!value || value.startsWith('--'))
            continue;
        values.push(...value.split(',').map((entry) => entry.trim()).filter(Boolean));
    }
    return [...new Set(values)];
}
function readStagedFiles(cwd) {
    try {
        return execFileSync('git', ['diff', '--cached', '--name-only'], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).split(/\r?\n/).map((entry) => entry.trim().replace(/\\/g, '/')).filter(Boolean);
    }
    catch {
        return [];
    }
}
