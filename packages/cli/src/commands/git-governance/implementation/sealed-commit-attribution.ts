/**
 * Git adapter for the sealed commit attribution contract.
 *
 * The pure policy lives in `packages/core/src/commit-attribution`. This module
 * is the only place that turns Git index/tree state into sealed entries and
 * back, so the transaction rule stays enforceable without spreading Git
 * plumbing through the commit orchestration.
 *
 * The ordering rule this module exists to hold: seal the admitted content
 * first, assemble the candidate tree *from the seal* rather than from the
 * mutable live index, and prove the candidate equals the seal before anything
 * moves a ref.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ATM_COMMIT_ATTRIBUTION_MISMATCH,
  ATM_COMMIT_ATTRIBUTION_UNSEALED_BUNDLE,
  assertSealedBundleNotEmpty,
  compareCommitTreeToSealedBundle,
  type CommitAttributionProof,
  type CommitTreeEntry,
  type SealedCommitBundle,
  type SealedCommitEntryProvenance
} from '../../../../../core/src/commit-attribution/sealed-commit-bundle.ts';
import { CliError } from '../../shared.ts';
import {
  assembleSealedCommitIndex,
  mergeSealedCommitBundles,
  readCandidateTreeEntries,
  readCommittedTreeEntries,
  sealCommitBundleFromCandidateIndex,
  sealCommitBundleFromLiveIndex,
  withWorktreeCandidateIndex
} from './sealed-commit-candidate-index.ts';
export {
  assembleSealedCommitIndex,
  mergeSealedCommitBundles,
  readCandidateTreeEntries,
  readCommittedTreeEntries,
  sealCommitBundleFromCandidateIndex,
  sealCommitBundleFromLiveIndex,
  withWorktreeCandidateIndex
} from './sealed-commit-candidate-index.ts';
import {
  attachLiveIndexReconciliation,
  captureLiveIndexSnapshot,
  readHeadCommit,
  reconcileLiveIndexAfterCommitAttempt,
  type LiveIndexReconciliation
} from './live-index-reconciliation.ts';

export function proveCommitAttribution(input: {
  readonly sealed: SealedCommitBundle;
  readonly actual: readonly CommitTreeEntry[];
}): CommitAttributionProof {
  // Deletions seal an empty blob id on both sides, so they compare equal
  // without special-casing the comparison policy in core.
  return compareCommitTreeToSealedBundle({ sealed: input.sealed, actual: input.actual });
}

/**
 * Fail closed before a ref moves. This is intentionally a hard error rather
 * than a diagnostic: an unexplained entry in the candidate tree means the
 * commit would attribute someone else's content to this actor.
 */
export function assertCommitAttribution(input: {
  readonly sealed: SealedCommitBundle;
  readonly actual: readonly CommitTreeEntry[];
  readonly surface: string;
  readonly actorId?: string | null;
  readonly taskId?: string | null;
}): CommitAttributionProof {
  const proof = proveCommitAttribution({ sealed: input.sealed, actual: input.actual });
  if (proof.ok) return proof;
  throw new CliError(ATM_COMMIT_ATTRIBUTION_MISMATCH, proof.summary, {
    exitCode: 1,
    details: {
      surface: input.surface,
      actorId: input.actorId ?? null,
      taskId: input.taskId ?? null,
      sealedEntryCount: proof.sealedEntryCount,
      actualEntryCount: proof.actualEntryCount,
      findings: proof.findings,
      safeNextActions: [
        're-resolve-the-commit-bundle-and-retry',
        'wait-for-the-owner-of-the-unexpected-paths',
        'request-a-broker-index-lane'
      ]
    }
  });
}

export interface SealedCommitIndexOutcome<T> {
  readonly result: T;
  readonly bundle: SealedCommitBundle;
  readonly proof: CommitAttributionProof;
  /** Which named route produced the seal this transaction was proved against. */
  readonly sealSource: SealedCommitSealSource['kind'];
  /** Non-null only on the diagnostic route, and carried into the receipt. */
  readonly liveIndexSealDiagnostic: { readonly reason: string } | null;
  /** Task paths advanced to the new HEAD without overwriting concurrent bytes. */
  readonly liveIndexReconciliation: LiveIndexReconciliation;
}

/**
 * Where the seal came from. There is deliberately no "unset" case: sealing the
 * live index is a decision, not a default. A governed commit passes the bundle
 * it admitted; the diagnostic route exists for probes and tests that have no
 * prior admission, and it has to say why in a string that reaches the outcome.
 */
export type SealedCommitSealSource =
  | { readonly kind: 'sealed-bundle'; readonly bundle: SealedCommitBundle }
  | { readonly kind: 'live-index-diagnostic'; readonly reason: string };

/**
 * Resolve the seal a governed commit will be proved against.
 *
 * Both governed branches seal explicitly: a resolved task-scope bundle is
 * reused as admitted, and a commit that has only a pre-staged index seals that
 * index here, under its own provenance, rather than letting the transaction
 * discover an unsealed state later and improvise.
 */
export function resolveGovernedCommitSeal(input: {
  readonly cwd: string;
  readonly admittedBundle?: SealedCommitBundle | null;
  readonly paths: readonly string[];
  readonly provenance: SealedCommitEntryProvenance;
}): SealedCommitSealSource {
  return {
    kind: 'sealed-bundle',
    bundle: input.admittedBundle ?? sealCommitBundleFromLiveIndex({
      cwd: input.cwd,
      paths: input.paths,
      provenance: input.provenance
    })
  };
}

/**
 * Run `run` against a candidate index that provably contains the sealed bundle
 * and nothing else.
 *
 * Governance evidence ATM itself writes during the transaction is folded into
 * the seal through `stageGovernanceEvidence`, which reports the exact paths it
 * added. That keeps the seal honest — content authored by this transaction is
 * admitted, content authored concurrently by anyone else is not — without
 * degrading the assertion into "accept whatever ended up in the index".
 */
export function runWithSealedTaskScopedCommitIndex<T>(input: {
  readonly cwd: string;
  readonly paths: readonly string[];
  readonly provenance: SealedCommitEntryProvenance;
  readonly actorId?: string | null;
  readonly taskId?: string | null;
  readonly surface: string;
  readonly stageGovernanceEvidence?: (env: NodeJS.ProcessEnv) => readonly string[];
  /**
   * Where the seal comes from. Governed callers resolve and admit their bundle
   * before reaching the commit step and pass it here, so the content admitted
   * is the content committed even if the live index changed in between. There
   * is no implicit fallback: a caller with no bundle has to ask for the named
   * diagnostic route and say why.
   */
  readonly sealSource: SealedCommitSealSource;
  readonly run: (env: NodeJS.ProcessEnv) => T;
}): SealedCommitIndexOutcome<T> {
  const sealSource = assertNamedSealSource(input.sealSource, input.surface);
  const sealed = sealSource.kind === 'sealed-bundle'
    ? sealSource.bundle
    : sealCommitBundleFromLiveIndex({
      cwd: input.cwd,
      paths: input.paths,
      provenance: input.provenance
    });
  assertSealedBundleNotEmpty(sealed);
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-sealed-commit-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(tempDir, 'index') };
  try {
    assembleSealedCommitIndex({ cwd: input.cwd, bundle: sealed, env });
    const evidencePaths = input.stageGovernanceEvidence?.(env) ?? [];
    const bundle = evidencePaths.length > 0
      ? mergeSealedCommitBundles(
        sealed,
        sealCommitBundleFromCandidateIndex({ cwd: input.cwd, env, paths: evidencePaths }),
        { supersedingPaths: evidencePaths, surface: input.surface }
      )
      : sealed;
    const proof = assertCommitAttribution({
      sealed: bundle,
      actual: readCandidateTreeEntries({ cwd: input.cwd, env, sealedPaths: bundle.entries.map((entry) => entry.path) }),
      surface: input.surface,
      actorId: input.actorId,
      taskId: input.taskId
    });
    // The candidate index leaves the live index behind whether `run` returns or
    // throws, and a commit that failed downstream of its own commit object has
    // still moved HEAD. So the snapshot and the pre-attempt HEAD are taken
    // before the attempt, and the same boundary settles both exits: it decides
    // on HEAD movement rather than on control flow, and it never converts an
    // index problem into a commit failure or a commit failure into silence.
    const liveIndexSnapshot = captureLiveIndexSnapshot(input.cwd, bundle.entries.map((entry) => entry.path));
    const headBeforeCommit = readHeadCommit(input.cwd);
    let result: T;
    try {
      result = input.run(env);
    } catch (commitError) {
      throw attachLiveIndexReconciliation(
        commitError,
        reconcileLiveIndexAfterCommitAttempt({
          cwd: input.cwd,
          snapshot: liveIndexSnapshot,
          headBefore: headBeforeCommit
        })
      );
    }
    const committedHead = readHeadCommit(input.cwd);
    if (!committedHead) {
      throw new CliError(ATM_COMMIT_ATTRIBUTION_MISMATCH, 'Post-commit attribution cannot resolve the committed HEAD.', {
        exitCode: 1,
        details: { surface: `${input.surface} post-commit tree`, actorId: input.actorId ?? null, taskId: input.taskId ?? null }
      });
    }
    const committedProof = assertCommitAttribution({
      sealed: bundle,
      actual: readCommittedTreeEntries(input.cwd, committedHead, bundle.entries.map((entry) => entry.path)),
      surface: `${input.surface} post-commit tree`,
      actorId: input.actorId,
      taskId: input.taskId
    });
    const liveIndexReconciliation = reconcileLiveIndexAfterCommitAttempt({
      cwd: input.cwd,
      snapshot: liveIndexSnapshot,
      headBefore: headBeforeCommit
    });
    return {
      result,
      bundle,
      proof: committedProof,
      sealSource: sealSource.kind,
      liveIndexSealDiagnostic: sealSource.kind === 'live-index-diagnostic' ? { reason: sealSource.reason } : null,
      liveIndexReconciliation
    };
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Reject an unnamed seal before a temporary index is even created. A caller
 * that reaches assembly without a bundle and without asking for the diagnostic
 * route would otherwise commit whatever the shared index holds.
 */
function assertNamedSealSource(source: SealedCommitSealSource | null | undefined, surface: string): SealedCommitSealSource {
  if (source?.kind === 'sealed-bundle' || (source?.kind === 'live-index-diagnostic' && source.reason.trim())) {
    return source;
  }
  throw new CliError(
    ATM_COMMIT_ATTRIBUTION_UNSEALED_BUNDLE,
    'A governed commit requires an admitted sealed bundle; sealing the live shared index is only available as a named diagnostic route with a reason.',
    {
      exitCode: 1,
      details: {
        surface,
        sealSourceKind: source?.kind ?? null,
        safeNextActions: [
          'resolve-and-admit-the-commit-bundle-before-committing',
          'pass-a-live-index-diagnostic-reason-for-non-governed-probes'
        ]
      }
    }
  );
}
