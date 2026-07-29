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
export const ATM_COMMIT_CANDIDATE_CONFLICT = 'ATM_COMMIT_CANDIDATE_CONFLICT' as const;
export const ATM_COMMIT_CANDIDATE_STALE_BASE = 'ATM_COMMIT_CANDIDATE_STALE_BASE' as const;
export const ATM_COMMIT_CANDIDATE_ADAPTER_REQUIRED = 'ATM_COMMIT_CANDIDATE_ADAPTER_REQUIRED' as const;
export const ATM_GIT_PATHSPEC_FALLBACK_REQUIRES_EMERGENCY = 'ATM_GIT_PATHSPEC_FALLBACK_REQUIRES_EMERGENCY' as const;
export const ATM_COMMIT_CANDIDATE_INDEX_RESIDUE_BLOCKED = 'ATM_COMMIT_CANDIDATE_INDEX_RESIDUE_BLOCKED' as const;

export type CommitCandidateCode =
  | typeof ATM_COMMIT_CANDIDATE_CONFLICT
  | typeof ATM_COMMIT_CANDIDATE_STALE_BASE
  | typeof ATM_COMMIT_CANDIDATE_ADAPTER_REQUIRED
  | typeof ATM_GIT_PATHSPEC_FALLBACK_REQUIRES_EMERGENCY
  | typeof ATM_COMMIT_CANDIDATE_INDEX_RESIDUE_BLOCKED;

export const COMMIT_CANDIDATE_SCHEMA_ID = 'atm.commitCandidate.v1' as const;

/** One file the candidate intends to persist, with its exact content digest. */
export interface CommitCandidateFile {
  readonly path: string;
  readonly contentDigest: string;
  readonly changeKind: 'add' | 'modify' | 'delete';
}

/**
 * VCS-neutral commit candidate. Carries everything a repository adapter needs
 * to persist the change, plus everything the broker/steward needs to admit it,
 * without referencing any Git-specific concept.
 */
export interface CommitCandidate {
  readonly schemaId: typeof COMMIT_CANDIDATE_SCHEMA_ID;
  readonly candidateId: string;
  readonly actorId: string;
  /** Governed task id, or a framework-temp id; one of them must be present. */
  readonly taskId: string | null;
  readonly frameworkTempId: string | null;
  readonly laneSessionId: string | null;
  readonly leaseId: string | null;
  /** Seal of the base the candidate was authored against (base/HEAD CAS). */
  readonly baseSeal: string;
  readonly files: readonly CommitCandidateFile[];
  /** Broker keyspace resource keys this candidate writes (atoms/files/etc.). */
  readonly allowedResourceKeys: readonly string[];
  readonly validationPlan: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly expectedTrailers: Readonly<Record<string, string>>;
  /** Which repository adapter persists this candidate (e.g. 'local-git'). */
  readonly adapterTarget: string | null;
  readonly composeEligible: boolean;
  readonly createdAt: string;
}

export type CommitCandidateVerdict =
  | 'execute-now'
  | 'queued'
  | 'compose-eligible'
  | 'revalidation-required'
  | 'stale-base'
  | 'adapter-required'
  | 'blocked';

export interface CommitCandidateAdmissionContext {
  /** Current base seal of the canonical worktree (CAS check target). */
  readonly currentBaseSeal: string;
  /**
   * Other live candidates ahead of this one in the broker keyspace, ordered by
   * queue position. This is the SAME keyspace as git-index/branch-commit/
   * runner-sync writes — there is no second queue.
   */
  readonly aheadCandidates: readonly CommitCandidateQueueMember[];
  /** Whether the target repository adapter has been resolved and is ready. */
  readonly adapterResolved: boolean;
  /**
   * Physical index/worktree residue: staged or dirty resource keys NOT owned by
   * this candidate. Their mere presence never blocks (isolation is the point);
   * they only block if the adapter would consume them into the persisted set.
   */
  readonly unrelatedIndexResidue?: readonly string[];
  /** True when the adapter cannot isolate and would consume the residue. */
  readonly adapterWouldConsumeResidue?: boolean;
  /** True when the base advanced but this candidate can be revalidated in place. */
  readonly revalidatable?: boolean;
}

export interface CommitCandidateQueueMember {
  readonly candidateId: string;
  readonly allowedResourceKeys: readonly string[];
  readonly composeEligible: boolean;
}

export interface CommitCandidateAdmissionDecision {
  readonly schemaId: 'atm.commitCandidateAdmission.v1';
  readonly candidateId: string;
  readonly verdict: CommitCandidateVerdict;
  readonly code: CommitCandidateCode | null;
  readonly ok: boolean;
  readonly conflictingCandidateIds: readonly string[];
  readonly reasons: readonly string[];
  readonly recoveryCommand: string | null;
}

const COMPOSE_COMMAND = 'node atm.mjs broker compose --proposal-file <path> --json';
const REBASE_CANDIDATE_COMMAND = 'node atm.mjs git commit --actor <id> --task <task> --message "<summary>" --json';
const ADAPTER_COMMAND = 'node atm.mjs git commit --actor <id> --task <task> --message "<summary>" --auto-stage --json';

/**
 * Pure admission for a commit candidate. Returns exactly one verdict and, on a
 * blocking verdict, an exact recovery command. A bare refusal is never emitted
 * (INV-ATM-008): every blocked state names its resolution path.
 */
export function admitCommitCandidate(
  candidate: CommitCandidate,
  context: CommitCandidateAdmissionContext
): CommitCandidateAdmissionDecision {
  const reasons: string[] = [];

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
  const overlapping = context.aheadCandidates.filter((member) =>
    member.allowedResourceKeys.some((key) => ownKeys.has(key)));

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
  const nonComposable = overlapping.filter((member) =>
    !(candidate.composeEligible && member.composeEligible));
  return decide(candidate, 'blocked', ATM_COMMIT_CANDIDATE_CONFLICT, nonComposable.map((m) => m.candidateId), [
    `overlapping non-composable resource keys with ${nonComposable.map((m) => m.candidateId).join(', ')}`
  ], COMPOSE_COMMAND);
}

/**
 * Classify a direct native pathspec / `--only` commit. Outside the admitted
 * adapter path, this is emergency-only and must carry an emergency approval.
 */
export function classifyPathspecFallback(input: {
  readonly candidateAdmitted: boolean;
  readonly invokedByGitAdapter: boolean;
  readonly emergencyApprovalPresent: boolean;
}): CommitCandidateAdmissionDecision {
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
export function buildCommitCandidate(input: Omit<CommitCandidate, 'schemaId'>): CommitCandidate {
  return {
    schemaId: COMMIT_CANDIDATE_SCHEMA_ID,
    ...input,
    files: [...input.files].sort((a, b) => a.path.localeCompare(b.path)),
    allowedResourceKeys: uniqueSorted(input.allowedResourceKeys)
  };
}

function decide(
  candidate: CommitCandidate,
  verdict: CommitCandidateVerdict,
  code: CommitCandidateCode | null,
  conflictingCandidateIds: readonly string[],
  reasons: readonly string[],
  recoveryCommand: string | null
): CommitCandidateAdmissionDecision {
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

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value && value.trim().length > 0))].sort();
}
