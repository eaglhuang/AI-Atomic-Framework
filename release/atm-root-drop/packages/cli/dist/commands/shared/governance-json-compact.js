const CLAIM_EVIDENCE_OMIT = [
    'teamRecommendation',
    'integrationBootstrap',
    'runtimeAdapterReadiness',
    'planScopedPreflight',
    'dirtyWipAdmission',
    'oversizedExtractionAdmission',
    'claimLatency',
    'preClaimBrokerTransaction',
    'actorSession'
];
const CLOSE_EVIDENCE_OMIT = [
    'closebackPlan',
    'governedCommitBundle',
    'residueDiagnosis',
    'delegationContract',
    'backendResult',
    'planningCardCloseback',
    'rosterCloseback',
    'observedTaskEvidence',
    'closebackPathResolution',
    'preCloseDeliveryCommit',
    'closeWriteTransaction',
    'brokerRuntimeCleanup',
    'deferredGovernanceDirty'
];
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
const DOCTOR_DETAIL_KEEP = new Set([
    'git-head-evidence',
    'git-worktree-readiness',
    'governance-entry-readiness',
    'package-dist'
]);
function slimDoctorChecks(checks) {
    if (!Array.isArray(checks))
        return checks;
    return checks.map((check) => {
        if (!isRecord(check) || check.ok !== true || DOCTOR_DETAIL_KEEP.has(String(check.name)))
            return check;
        return { name: check.name, ok: true };
    });
}
export function printedGovernanceJsonIsCompact(command) {
    if (process.argv.includes('--verbose'))
        return false;
    const argv = process.argv;
    if (command === 'doctor' && argv.includes('doctor'))
        return true;
    if (command === 'next' && argv.includes('--claim'))
        return true;
    if ((command === 'taskflow close' || command === 'taskflow pre-close') && (argv.includes('close') || argv.includes('pre-close')))
        return true;
    return false;
}
/**
 * Default printed envelope for claim, doctor, pre-close, and close.
 * Keeps commands, playbook, lane session, task ids, message codes,
 * diagnostics, failing doctor checks, and close blockers. `--verbose`
 * bypasses this and prints the full pretty envelope.
 */
export function compactPrintedGovernanceJson(result) {
    const copy = structuredClone(result);
    const evidence = isRecord(copy.evidence) ? copy.evidence : null;
    if (!evidence)
        return copy;
    const command = String(copy.command ?? '');
    if (command === 'doctor') {
        if (Array.isArray(evidence.checks))
            evidence.checks = slimDoctorChecks(evidence.checks);
        delete evidence.integrationBootstrap;
        delete evidence.frameworkHookReadiness;
    }
    const omit = command === 'next'
        ? CLAIM_EVIDENCE_OMIT
        : command === 'taskflow close' || command === 'taskflow pre-close'
            ? CLOSE_EVIDENCE_OMIT
            : [];
    for (const key of omit)
        delete evidence[key];
    evidence.compactOutput = {
        compacted: true,
        fullOutput: 'rerun the same command with --verbose --json'
    };
    return copy;
}
