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
  findSealedBundleProvenanceConflicts,
  isTombstone,
  sealCommitBundle,
  type CommitAttributionProof,
  type CommitTreeEntry,
  type SealedCommitBundle,
  type SealedCommitBundleEntry,
  type SealedCommitEntryProvenance
} from '../../../../../core/src/commit-attribution/sealed-commit-bundle.ts';
import { CliError } from '../../shared.ts';
import { runGitCommand, runGitCommandWithEnv } from './git-process-port.ts';

const QUIET_STDIO = ['ignore', 'pipe', 'pipe'] as const;
/** `<mode> <objectId> <stage>\t<path>` as emitted by `git ls-files -s`. */
const LS_FILES_STAGE_PATTERN = /^(\d+) ([0-9a-f]+) \d+\t(.+)$/i;
/** `:<srcMode> <dstMode> <srcSha> <dstSha> <status>\t<path>` from diff plumbing. */
const RAW_DIFF_PATTERN = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*\t(.+)$/i;
const NULL_OBJECT_ID = /^0+$/;

function normalizePath(value: string): string {
  return String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

function splitLines(output: string): readonly string[] {
  return String(output ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/**
 * Seal the admitted paths against the live index exactly once. Every later
 * step reads this snapshot instead of the index, which is what closes the
 * substitution window between admission and assembly.
 */
export function sealCommitBundleFromLiveIndex(input: {
  readonly cwd: string;
  readonly paths: readonly string[];
  readonly provenance: SealedCommitEntryProvenance;
  readonly baseTreeSha?: string | null;
  readonly baseRef?: string | null;
}): SealedCommitBundle {
  const paths = [...new Set(input.paths.map(normalizePath).filter(Boolean))].sort();
  if (paths.length === 0) {
    return sealCommitBundle({ entries: [], baseTreeSha: input.baseTreeSha ?? null });
  }
  const entries: SealedCommitBundleEntry[] = [];
  for (const line of splitLines(runGitCommand(input.cwd, ['ls-files', '-s', '--', ...paths]))) {
    const match = line.match(LS_FILES_STAGE_PATTERN);
    if (!match) continue;
    entries.push({
      path: normalizePath(match[3]),
      mode: match[1],
      blobId: match[2],
      provenance: input.provenance,
      disposition: 'present'
    });
  }
  // TASK-GIT-0030: a staged deletion has no index entry, so the loop above
  // cannot see it. Sealing only what `ls-files` returns silently drops the
  // removal from the candidate tree and the file survives the commit. Deletions
  // are therefore sealed explicitly as tombstones.
  for (const entry of readStagedDeletionEntries({ cwd: input.cwd, paths, baseRef: input.baseRef ?? 'HEAD' })) {
    entries.push({ ...entry, provenance: input.provenance });
  }
  return sealCommitBundle({ entries, baseTreeSha: input.baseTreeSha ?? null });
}

/**
 * Seal an explicit task-owned worktree overlay without touching the shared
 * index.  Auto-stage admission uses this so a stale shared-index entry cannot
 * turn a present protected artifact into a tombstone before the transaction
 * gets its isolated candidate index.
 */
export function withWorktreeCandidateIndex<T>(input: {
  readonly cwd: string;
  readonly paths: readonly string[];
  readonly run: (env: NodeJS.ProcessEnv) => T;
}): T {
  const paths = [...new Set(input.paths.map(normalizePath).filter(Boolean))].sort();
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-worktree-candidate-index-'));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(tempDir, 'index') };
  try {
    runGitCommandWithEnv(input.cwd, ['read-tree', 'HEAD'], env, [...QUIET_STDIO]);
    if (paths.length > 0) {
      runGitCommandWithEnv(input.cwd, ['add', '-A', '-f', '--', ...paths], env, [...QUIET_STDIO]);
    }
    return input.run(env);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Paths the index removes relative to the base tree, sealed with their
 * pre-image mode so the tombstone still carries identity.
 */
function readStagedDeletionEntries(input: {
  readonly cwd: string;
  readonly paths: readonly string[];
  readonly baseRef: string;
}): readonly SealedCommitBundleEntry[] {
  const entries: SealedCommitBundleEntry[] = [];
  for (const line of splitLines(
    runGitCommand(input.cwd, ['diff-index', '--cached', '--raw', '--diff-filter=D', input.baseRef, '--', ...input.paths])
  )) {
    const match = line.match(RAW_DIFF_PATTERN);
    if (!match) continue;
    entries.push({
      path: normalizePath(match[6]),
      mode: match[1],
      blobId: '',
      provenance: 'task-scope',
      disposition: 'deleted'
    });
  }
  return entries;
}

/**
 * Merge overlay entries (governance evidence) onto an already sealed bundle.
 *
 * Composition is where accountability can be quietly rewritten: the overlay
 * wins on duplicate paths, so an entry that re-declares an admitted path under
 * a different provenance would leave the seal describing the right content and
 * the wrong author. Supersession is therefore allowed only for the paths the
 * caller declares it staged in this transaction; every other cross-provenance
 * re-declaration is a named finding and fails closed.
 */
export function mergeSealedCommitBundles(
  base: SealedCommitBundle,
  overlay: SealedCommitBundle,
  options?: { readonly supersedingPaths?: readonly string[]; readonly surface?: string }
): SealedCommitBundle {
  const superseding = new Set((options?.supersedingPaths ?? []).map(normalizePath).filter(Boolean));
  const conflicts = findSealedBundleProvenanceConflicts([...base.entries, ...overlay.entries])
    .filter((finding) => !superseding.has(finding.path));
  if (conflicts.length > 0) {
    throw new CliError(
      ATM_COMMIT_ATTRIBUTION_MISMATCH,
      `Sealed commit bundle declares conflicting provenance for ${conflicts.map((finding) => finding.path).join(', ')}.`,
      {
        exitCode: 1,
        details: {
          surface: options?.surface ?? 'seal-composition',
          findings: conflicts,
          safeNextActions: [
            're-resolve-the-commit-bundle-and-retry',
            'declare-the-superseding-paths-explicitly'
          ]
        }
      }
    );
  }
  return sealCommitBundle({
    entries: [...base.entries, ...overlay.entries],
    baseTreeSha: base.baseTreeSha ?? overlay.baseTreeSha ?? null,
    sealedAt: base.sealedAt
  });
}

/**
 * Build the candidate index from sealed content only. `update-index
 * --cacheinfo` writes the sealed `{mode, blobId}` directly, so a concurrent
 * worktree or index mutation on the same path cannot leak into the candidate.
 */
export function assembleSealedCommitIndex(input: {
  readonly cwd: string;
  readonly bundle: SealedCommitBundle;
  readonly env: NodeJS.ProcessEnv;
  readonly baseRef?: string;
}): void {
  runGitCommandWithEnv(input.cwd, ['read-tree', input.baseRef ?? 'HEAD'], input.env, [...QUIET_STDIO]);
  const paths = input.bundle.entries.map((entry) => entry.path);
  if (paths.length === 0) return;
  // Every sealed path is first removed from the candidate index. Tombstoned
  // paths stop here: they are never re-added, and because the content is taken
  // from the seal rather than the worktree, a file that still exists on disk
  // cannot resurrect itself into the commit.
  runGitCommandWithEnv(
    input.cwd,
    ['rm', '--cached', '--quiet', '--ignore-unmatch', '--force', '--', ...paths],
    input.env,
    [...QUIET_STDIO]
  );
  const presentEntries = input.bundle.entries.filter((entry) => !isTombstone(entry));
  for (const entry of presentEntries) {
    runGitCommandWithEnv(
      input.cwd,
      ['update-index', '--add', '--cacheinfo', `${entry.mode},${entry.blobId},${entry.path}`],
      input.env,
      [...QUIET_STDIO]
    );
  }
  // `update-index --cacheinfo` writes entries with no stat data, which makes
  // `git commit` refresh them against the worktree and silently re-hash
  // whatever a concurrent writer left there — reintroducing the exact
  // substitution this seal exists to prevent. Marking the sealed entries
  // assume-unchanged tells the refresh to trust the index. The bit only ever
  // exists in the throwaway candidate index, never in the live one.
  if (presentEntries.length === 0) return;
  runGitCommandWithEnv(
    input.cwd,
    ['update-index', '--assume-unchanged', '--', ...presentEntries.map((entry) => entry.path)],
    input.env,
    [...QUIET_STDIO]
  );
}

function parseRawDiffEntries(output: string): readonly CommitTreeEntry[] {
  const entries: CommitTreeEntry[] = [];
  for (const line of splitLines(output)) {
    const match = line.match(RAW_DIFF_PATTERN);
    if (!match) continue;
    const [, sourceMode, targetMode, , targetBlob, status, filePath] = match;
    // A deletion carries no post-image content; seal it by its pre-image mode
    // so the bundle can still express "this path must disappear".
    const deleted = status.toUpperCase() === 'D' || NULL_OBJECT_ID.test(targetBlob);
    entries.push({
      path: normalizePath(filePath),
      mode: deleted ? sourceMode : targetMode,
      blobId: deleted ? '' : targetBlob,
      disposition: deleted ? 'deleted' : 'present'
    });
  }
  return entries;
}

/**
 * What the candidate index will actually commit, expressed so it can be
 * compared to a seal.
 *
 * Two sources are needed. A sealed path whose content already matches the base
 * tree produces no diff entry at all, so the index itself is the authority for
 * sealed paths. Anything that appears in the diff without being sealed is an
 * intruder, and only the diff can reveal it — the index is full of base-tree
 * entries that are not part of this commit.
 */
export function readCandidateTreeEntries(input: {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly baseRef?: string;
  readonly sealedPaths?: readonly string[];
}): readonly CommitTreeEntry[] {
  const sealedPaths = [...new Set((input.sealedPaths ?? []).map(normalizePath).filter(Boolean))].sort();
  const entries = new Map<string, CommitTreeEntry>();
  if (sealedPaths.length > 0) {
    for (const line of splitLines(
      runGitCommandWithEnv(input.cwd, ['ls-files', '-s', '--', ...sealedPaths], input.env, [...QUIET_STDIO])
    )) {
      const match = line.match(LS_FILES_STAGE_PATTERN);
      if (!match) continue;
      entries.set(normalizePath(match[3]), { path: normalizePath(match[3]), mode: match[1], blobId: match[2], disposition: 'present' });
    }
  }
  const diffEntries = parseRawDiffEntries(
    runGitCommandWithEnv(input.cwd, ['diff-index', '--cached', '--raw', '-M', input.baseRef ?? 'HEAD'], input.env, [
      ...QUIET_STDIO
    ])
  );
  for (const entry of diffEntries) {
    if (entries.has(entry.path)) continue;
    entries.set(entry.path, entry);
  }
  return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
}

/** Post-image entries actually recorded by a commit that already exists. */
export function readCommittedTreeEntries(cwd: string, commitSha: string): readonly CommitTreeEntry[] {
  return parseRawDiffEntries(runGitCommand(cwd, ['diff-tree', '--no-commit-id', '--raw', '-r', '-M', commitSha]));
}

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
    return {
      result: input.run(env),
      bundle,
      proof,
      sealSource: sealSource.kind,
      liveIndexSealDiagnostic: sealSource.kind === 'live-index-diagnostic' ? { reason: sealSource.reason } : null
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

/** Seal specific paths from an already-assembled candidate index. */
export function sealCommitBundleFromCandidateIndex(input: {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly paths: readonly string[];
}): SealedCommitBundle {
  const paths = [...new Set(input.paths.map(normalizePath).filter(Boolean))].sort();
  if (paths.length === 0) return sealCommitBundle({ entries: [] });
  const entries: SealedCommitBundleEntry[] = [];
  for (const line of splitLines(
    runGitCommandWithEnv(input.cwd, ['ls-files', '-s', '--', ...paths], input.env, [...QUIET_STDIO])
  )) {
    const match = line.match(LS_FILES_STAGE_PATTERN);
    if (!match) continue;
    entries.push({
      path: normalizePath(match[3]),
      mode: match[1],
      blobId: match[2],
      provenance: 'governance-evidence'
    });
  }
  return sealCommitBundle({ entries });
}
