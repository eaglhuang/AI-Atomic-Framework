/**
 * ATM-GOV-0276 — atm.planning-source-seal-policy
 *
 * Policy Object / Result Contract for planning-source identity.
 *
 * `import-task.ts` owns *how* a seal is built and read from disk; this module owns
 * *what a seal delta means*. Keeping the classification here means the four
 * outcomes (unchanged, benign seal upgrade, governed amendment, blocking drift)
 * are decided in one place instead of being re-derived by each caller surface
 * (claim, close, closeback path resolution).
 *
 * The benign case this module exists for: a task card imported while still
 * untracked seals `planningCommitSha: null`. Committing that identical card later
 * moves the sha from `null` to a real commit while `contentDigest` stays byte
 * identical. That is a storage-identity upgrade, not a planning amendment, and it
 * must not force operators toward `tasks import --force` or a false
 * `amendment_epoch` bump.
 */

export type PlanningSourceDriftKind =
  | 'path'
  | 'commit'
  | 'content'
  | 'repo-identity'
  | 'amendment-epoch';

export type PlanningSourceSealStatus =
  | 'match'
  | 'benign-seal-upgrade'
  | 'governed-amendment'
  | 'drift';

/** The identity fields a seal classification is allowed to look at. */
export interface PlanningSourceSealIdentity {
  readonly repoIdentity: string;
  readonly taskCardPath: string;
  readonly planningCommitSha: string | null;
  readonly contentDigest: string;
  readonly amendmentEpoch: number;
}

export interface PlanningSourceSealClassification {
  readonly schemaId: 'atm.planningSourceSealClassification.v1';
  readonly ok: boolean;
  readonly status: PlanningSourceSealStatus;
  readonly driftKinds: readonly PlanningSourceDriftKind[];
  /**
   * Drift kinds that were observed but reclassified as a benign storage-identity
   * upgrade. Empty unless `status === 'benign-seal-upgrade'`.
   */
  readonly benignUpgradeKinds: readonly PlanningSourceDriftKind[];
  readonly diagnostics: {
    readonly codes: readonly string[];
    readonly messages: readonly string[];
  };
}

export const PLANNING_SOURCE_SEAL_MATCH_CODE = 'ATM_PLANNING_SOURCE_SEAL_MATCH';
export const PLANNING_SOURCE_SEAL_BENIGN_UPGRADE_CODE = 'ATM_PLANNING_SOURCE_SEAL_BENIGN_UPGRADE';

/**
 * Compare a stored seal against the current on-disk card identity.
 *
 * Callers pass identities only; git access, path resolution, and digesting all
 * stay in `import-task.ts`.
 */
export function diffPlanningSourceSealIdentity(input: {
  readonly sealed: PlanningSourceSealIdentity;
  readonly current: PlanningSourceSealIdentity;
  /**
   * The plan path recorded on `task.source.planPath`. It is compared separately
   * because a task may point at a card that has since been renamed.
   */
  readonly sourcePlanPath?: string | null;
}): readonly PlanningSourceDriftKind[] {
  const { sealed, current } = input;
  const sourcePlanPath = input.sourcePlanPath ?? sealed.taskCardPath;
  const driftKinds: PlanningSourceDriftKind[] = [];
  if (current.taskCardPath !== sealed.taskCardPath || sourcePlanPath !== sealed.taskCardPath) driftKinds.push('path');
  if (current.repoIdentity !== sealed.repoIdentity) driftKinds.push('repo-identity');
  if (current.planningCommitSha !== sealed.planningCommitSha) driftKinds.push('commit');
  if (current.contentDigest !== sealed.contentDigest) driftKinds.push('content');
  if (current.amendmentEpoch !== sealed.amendmentEpoch) driftKinds.push('amendment-epoch');
  return driftKinds;
}

/**
 * True only for the narrow "untracked card was later committed unchanged" case:
 * the sealed sha is absent, the current sha exists, and nothing else moved.
 *
 * Any content change disqualifies the upgrade even when the sha delta looks the
 * same, so a rewritten card can never ride in on a benign classification.
 */
export function isBenignSealUpgrade(input: {
  readonly sealed: PlanningSourceSealIdentity;
  readonly current: PlanningSourceSealIdentity;
  readonly driftKinds: readonly PlanningSourceDriftKind[];
}): boolean {
  const { sealed, current, driftKinds } = input;
  if (driftKinds.length !== 1 || driftKinds[0] !== 'commit') return false;
  if (sealed.planningCommitSha !== null) return false;
  if (typeof current.planningCommitSha !== 'string' || current.planningCommitSha.trim().length === 0) return false;
  // Redundant with the drift-kind check above, but stated explicitly so the
  // fail-closed contract survives future drift-kind refactors.
  if (current.contentDigest !== sealed.contentDigest) return false;
  if (current.amendmentEpoch !== sealed.amendmentEpoch) return false;
  if (current.repoIdentity !== sealed.repoIdentity) return false;
  if (current.taskCardPath !== sealed.taskCardPath) return false;
  return true;
}

/**
 * A governed amendment is an intentional planning edit: the card content moved
 * *and* the human author advanced `amendment_epoch`.
 */
export function isGovernedAmendment(input: {
  readonly sealed: PlanningSourceSealIdentity;
  readonly current: PlanningSourceSealIdentity;
  readonly driftKinds: readonly PlanningSourceDriftKind[];
}): boolean {
  const amendable: readonly PlanningSourceDriftKind[] = ['commit', 'content', 'amendment-epoch'];
  return input.driftKinds.every((kind) => amendable.includes(kind))
    && input.current.amendmentEpoch > input.sealed.amendmentEpoch;
}

function driftCode(kind: PlanningSourceDriftKind): string {
  return `ATM_PLANNING_SOURCE_DRIFT_${kind.toUpperCase().replace(/-/g, '_')}`;
}

export function classifyPlanningSourceSeal(input: {
  readonly sealed: PlanningSourceSealIdentity;
  readonly current: PlanningSourceSealIdentity;
  readonly sourcePlanPath?: string | null;
}): PlanningSourceSealClassification {
  const driftKinds = diffPlanningSourceSealIdentity(input);
  if (driftKinds.length === 0) {
    return {
      schemaId: 'atm.planningSourceSealClassification.v1',
      ok: true,
      status: 'match',
      driftKinds,
      benignUpgradeKinds: [],
      diagnostics: {
        codes: [PLANNING_SOURCE_SEAL_MATCH_CODE],
        messages: ['Planning-source seal matches the current external task card.']
      }
    };
  }
  if (isBenignSealUpgrade({ sealed: input.sealed, current: input.current, driftKinds })) {
    return {
      schemaId: 'atm.planningSourceSealClassification.v1',
      ok: true,
      status: 'benign-seal-upgrade',
      driftKinds: [],
      benignUpgradeKinds: driftKinds,
      diagnostics: {
        codes: [PLANNING_SOURCE_SEAL_BENIGN_UPGRADE_CODE],
        messages: [
          'Planning-source seal upgraded benignly: the card was imported while untracked and has since been committed with identical content. No amendment epoch is required.'
        ]
      }
    };
  }
  const governedAmendment = isGovernedAmendment({ sealed: input.sealed, current: input.current, driftKinds });
  const status: PlanningSourceSealStatus = governedAmendment ? 'governed-amendment' : 'drift';
  return {
    schemaId: 'atm.planningSourceSealClassification.v1',
    ok: governedAmendment,
    status,
    driftKinds,
    benignUpgradeKinds: [],
    diagnostics: {
      codes: driftKinds.map(driftCode),
      messages: [`Planning-source seal ${status}: ${driftKinds.join(', ')}.`]
    }
  };
}
