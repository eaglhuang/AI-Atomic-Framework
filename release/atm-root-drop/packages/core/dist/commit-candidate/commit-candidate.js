/**
 * VCS-neutral commit-candidate isolation (ATM-GOV-0261).
 *
 * ATM core owns commit isolation as a durable, repository-agnostic envelope.
 * Git pathspec / `git commit --only` / temporary-index tricks are only one
 * repository adapter's final write operation; they must never become ATM's
 * authority model. Nothing in this module imports or assumes Git.
 */
/**
 * Exact ErrorCodes for the commit-candidate lane. `ATM_GIT_PATHSPEC_*` is
 * prefix-documented under `ATM_GIT_`; the `ATM_COMMIT_CANDIDATE_*` family is
 * owned by ATM-GOV-0261. Adapters re-export these; never mint parallels.
 */
export const ATM_COMMIT_CANDIDATE_CONFLICT = 'ATM_COMMIT_CANDIDATE_CONFLICT';
export const ATM_COMMIT_CANDIDATE_STALE_BASE = 'ATM_COMMIT_CANDIDATE_STALE_BASE';
export const ATM_COMMIT_CANDIDATE_ADAPTER_REQUIRED = 'ATM_COMMIT_CANDIDATE_ADAPTER_REQUIRED';
export const ATM_GIT_PATHSPEC_FALLBACK_REQUIRES_EMERGENCY = 'ATM_GIT_PATHSPEC_FALLBACK_REQUIRES_EMERGENCY';
export const ATM_COMMIT_CANDIDATE_INDEX_RESIDUE_BLOCKED = 'ATM_COMMIT_CANDIDATE_INDEX_RESIDUE_BLOCKED';
export const COMMIT_CANDIDATE_SCHEMA_ID = 'atm.commitCandidate.v1';
const COMPOSE_COMMAND = 'node atm.mjs broker compose --proposal-file <path> --json';
const REBASE_CANDIDATE_COMMAND = 'node atm.mjs git commit --actor <id> --task <task> --message "<summary>" --json';
const ADAPTER_COMMAND = 'node atm.mjs git commit --actor <id> --task <task> --message "<summary>" --auto-stage --json';
/**
 * Pure admission for a commit candidate. Returns exactly one verdict and, on a
 * blocking verdict, an exact recovery command. A bare refusal is never emitted
 * (INV-ATM-008): every blocked state names its resolution path.
 */
export function admitCommitCandidate(candidate, context) {
    const reasons = [];
    // 1. Stale base / CAS failure wins first: an out-of-date candidate must not
    //    be persisted even if nothing else conflicts.
    if (candidate.baseSeal !== context.currentBaseSeal) {
        if (context.revalidatable === true) {
            return decide(candidate, 'revalidation-required', null, [], [
                'base-advanced-candidate-revalidatable'
            ], REBASE_CANDIDATE_COMMAND);
        }
        return decide(candidate, 'stale-base', ATM_COMMIT_CANDIDATE_STALE_BASE, [], [
            `candidate-base-seal ${candidate.baseSeal} != current-base-seal ${context.currentBaseSeal}`
        ], REBASE_CANDIDATE_COMMAND);
    }
    // 2. Adapter must be resolved before any persistence verdict.
    if (!candidate.adapterTarget || !context.adapterResolved) {
        return decide(candidate, 'adapter-required', ATM_COMMIT_CANDIDATE_ADAPTER_REQUIRED, [], [
            candidate.adapterTarget
                ? `adapter ${candidate.adapterTarget} is not resolved`
                : 'candidate has no adapterTarget'
        ], ADAPTER_COMMAND);
    }
    // 3. The adapter must be able to isolate the candidate from unrelated index
    //    residue. Residue existing is fine; the adapter consuming it is not.
    const residue = uniqueSorted(context.unrelatedIndexResidue ?? []);
    if (residue.length > 0 && context.adapterWouldConsumeResidue === true) {
        return decide(candidate, 'blocked', ATM_COMMIT_CANDIDATE_INDEX_RESIDUE_BLOCKED, [], [
            `adapter would consume unrelated index residue: ${residue.join(', ')}`
        ], ADAPTER_COMMAND);
    }
    // 4. Resource-key overlap with candidates ahead in the shared keyspace.
    const ownKeys = new Set(candidate.allowedResourceKeys);
    const overlapping = context.aheadCandidates.filter((member) => member.allowedResourceKeys.some((key) => ownKeys.has(key)));
    if (overlapping.length === 0) {
        // Disjoint from everything ahead: execute now (or wait behind position).
        return decide(candidate, 'execute-now', null, [], ['disjoint-resource-keys'], null);
    }
    const allComposeEligible = candidate.composeEligible
        && overlapping.every((member) => member.composeEligible);
    if (allComposeEligible) {
        return decide(candidate, 'compose-eligible', null, overlapping.map((m) => m.candidateId), [
            'overlapping-but-compose-eligible'
        ], COMPOSE_COMMAND);
    }
    // A true logical conflict with a non-composable candidate ahead: this is the
    // fallback (queue/escalate), never a silent shared-index refusal.
    const nonComposable = overlapping.filter((member) => !(candidate.composeEligible && member.composeEligible));
    return decide(candidate, 'blocked', ATM_COMMIT_CANDIDATE_CONFLICT, nonComposable.map((m) => m.candidateId), [
        `overlapping non-composable resource keys with ${nonComposable.map((m) => m.candidateId).join(', ')}`
    ], COMPOSE_COMMAND);
}
/**
 * Classify a direct native pathspec / `--only` commit. Outside the admitted
 * adapter path, this is emergency-only and must carry an emergency approval.
 */
export function classifyPathspecFallback(input) {
    const emergencyOk = input.emergencyApprovalPresent === true;
    if (input.candidateAdmitted && input.invokedByGitAdapter) {
        return {
            schemaId: 'atm.commitCandidateAdmission.v1',
            candidateId: 'git-adapter-pathspec',
            verdict: 'execute-now',
            code: null,
            ok: true,
            conflictingCandidateIds: [],
            reasons: ['pathspec-is-adapter-operation-after-admission'],
            recoveryCommand: null
        };
    }
    return {
        schemaId: 'atm.commitCandidateAdmission.v1',
        candidateId: 'git-adapter-pathspec',
        verdict: 'blocked',
        code: ATM_GIT_PATHSPEC_FALLBACK_REQUIRES_EMERGENCY,
        ok: emergencyOk,
        conflictingCandidateIds: [],
        reasons: emergencyOk
            ? ['emergency-pathspec-classified-as-anomaly-evidence']
            : ['direct-native-pathspec-requires-emergency-approval'],
        recoveryCommand: 'node atm.mjs emergency approve --task <task> --actor <id> --permission backend.git.pathspec-fallback --allowed-flag "--pathspec-emergency" --approval-text "<why>" --reason "<why>" --json'
    };
}
/** Build a well-formed candidate, filling schema id and stable ordering. */
export function buildCommitCandidate(input) {
    return {
        schemaId: COMMIT_CANDIDATE_SCHEMA_ID,
        ...input,
        files: [...input.files].sort((a, b) => a.path.localeCompare(b.path)),
        allowedResourceKeys: uniqueSorted(input.allowedResourceKeys)
    };
}
function decide(candidate, verdict, code, conflictingCandidateIds, reasons, recoveryCommand) {
    const ok = verdict === 'execute-now';
    return {
        schemaId: 'atm.commitCandidateAdmission.v1',
        candidateId: candidate.candidateId,
        verdict,
        code,
        ok,
        conflictingCandidateIds: uniqueSorted(conflictingCandidateIds),
        reasons,
        recoveryCommand
    };
}
function uniqueSorted(values) {
    return [...new Set(values.filter((value) => value && value.trim().length > 0))].sort();
}
