import { evaluateTeamPreCommitGate } from '../../team-runtime-gates.js';
/** Adapts team runtime policy into the pre-commit failure envelope. */
export function buildTeamGateFindings(cwd, stagedFiles) {
    return evaluateTeamPreCommitGate({
        cwd,
        actorId: process.env.ATM_COMMIT_ACTOR_ID ?? process.env.ATM_ACTOR_ID ?? null,
        stagedFiles
    }).map((finding) => ({
        code: finding.code,
        source: 'team-runtime-gate',
        detail: finding.detail,
        files: finding.files,
        requiredCommand: finding.requiredCommand,
        classification: 'current-task',
        blockerKind: 'governance-state',
        scope: 'staged',
        data: finding
    }));
}
