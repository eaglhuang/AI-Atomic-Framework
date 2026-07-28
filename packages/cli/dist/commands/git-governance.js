import { execFileSync } from 'node:child_process';
import { evaluateTaskWorkAdmissionGate, readWorkAdmissionTicket } from './git-governance/work-admission-check.js';
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
    const action = argv.find((entry) => entry === 'commit' || entry === 'push') ?? '';
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
