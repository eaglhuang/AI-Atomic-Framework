/**
 * Sealed commit attribution contract.
 *
 * A governed commit is admitted as a set of paths, but a path is not what gets
 * committed — a `{mode, blobId}` pair is. Between the moment a bundle is
 * admitted and the moment the candidate tree is assembled, another actor
 * sharing the same worktree can replace the content behind an admitted path.
 * Path-scoped admission cannot see that substitution, so the commit ships
 * content that was never admitted while every path-level check still passes.
 *
 * This module makes the admitted content itself the transaction authority:
 * the bundle seals `{path, mode, blobId, provenance}`, and the candidate tree
 * must equal that seal exactly before any ref may move. It is deliberately
 * VCS-neutral — callers supply entries, and the Git adapter lives in the CLI
 * boundary.
 *
 * Error codes below are prefix-documented under `ATM_COMMIT_`.
 */

export const ATM_COMMIT_ATTRIBUTION_MISMATCH = 'ATM_COMMIT_ATTRIBUTION_MISMATCH' as const;
export const ATM_COMMIT_ATTRIBUTION_EMPTY_BUNDLE = 'ATM_COMMIT_ATTRIBUTION_EMPTY_BUNDLE' as const;

/**
 * Why an entry is allowed in the bundle. Provenance is sealed alongside the
 * content so a later reader can tell an admitted task-scope change apart from
 * governance evidence ATM staged on the actor's behalf.
 */
export type SealedCommitEntryProvenance =
  | 'task-scope'
  | 'governance-evidence'
  | 'framework-claim'
  | 'shared-delivery-slice'
  | 'pre-staged-index';

/**
 * `present` seals content that must exist in the committed tree. `deleted` is
 * a tombstone: the path must be absent from the committed tree.
 *
 * Tombstones exist because absence cannot be sealed by omission. A staged
 * deletion has no index entry, so a bundle that only records what `ls-files`
 * returns has no way to distinguish "this path must go" from "this path is not
 * mine" — and the removal is silently dropped from the candidate tree.
 */
export type SealedCommitEntryDisposition = 'present' | 'deleted';

export interface SealedCommitBundleEntry {
  /** Repository-relative, forward-slash normalized. */
  readonly path: string;
  /** Git file mode. For a tombstone this is the pre-image mode from the base tree. */
  readonly mode: string;
  /** Content identity: a blob object id, or any digest the adapter seals. Empty for a tombstone. */
  readonly blobId: string;
  readonly provenance: SealedCommitEntryProvenance;
  /** Defaults to `present` so existing callers keep their meaning. */
  readonly disposition?: SealedCommitEntryDisposition;
}

export interface SealedCommitBundle {
  readonly schemaId: 'atm.sealedCommitBundle.v1';
  readonly specVersion: '0.1.0';
  readonly sealedAt: string;
  /** Tree the candidate is built on top of, when the adapter knows it. */
  readonly baseTreeSha: string | null;
  readonly entries: readonly SealedCommitBundleEntry[];
}

export type CommitAttributionFindingKind =
  | 'missing-path'
  | 'unexpected-path'
  | 'mode-mismatch'
  | 'content-mismatch'
  /** A tombstoned path is still present in the candidate tree. */
  | 'undeleted-path';

export interface CommitAttributionFinding {
  readonly kind: CommitAttributionFindingKind;
  readonly path: string;
  readonly sealedMode: string | null;
  readonly actualMode: string | null;
  readonly sealedBlobId: string | null;
  readonly actualBlobId: string | null;
}

export interface CommitAttributionProof {
  readonly schemaId: 'atm.commitAttributionProof.v1';
  readonly specVersion: '0.1.0';
  readonly ok: boolean;
  readonly code: typeof ATM_COMMIT_ATTRIBUTION_MISMATCH | null;
  readonly sealedEntryCount: number;
  readonly actualEntryCount: number;
  readonly matchedEntryCount: number;
  readonly findings: readonly CommitAttributionFinding[];
  readonly summary: string;
}

export interface CommitTreeEntry {
  readonly path: string;
  readonly mode: string;
  readonly blobId: string;
  /**
   * `deleted` when the observed tree removes the path. Adapters that only
   * report present entries may omit this.
   */
  readonly disposition?: SealedCommitEntryDisposition;
}

function dispositionOf(entry: { readonly disposition?: SealedCommitEntryDisposition; readonly blobId?: string }): SealedCommitEntryDisposition {
  if (entry.disposition) return entry.disposition;
  // An empty blob id can only mean "no post-image content".
  return entry.blobId ? 'present' : 'deleted';
}

export function isTombstone(entry: SealedCommitBundleEntry): boolean {
  return dispositionOf(entry) === 'deleted';
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

/**
 * Git writes regular files as `100644` but the index and `diff-tree` disagree
 * on zero padding in some host versions, so compare on the significant digits.
 */
function normalizeMode(value: string): string {
  return String(value ?? '').trim().replace(/^0+/, '');
}

export function sealCommitBundle(input: {
  readonly entries: readonly SealedCommitBundleEntry[];
  readonly baseTreeSha?: string | null;
  readonly sealedAt?: string | null;
}): SealedCommitBundle {
  const byPath = new Map<string, SealedCommitBundleEntry>();
  for (const entry of input.entries) {
    const path = normalizePath(entry.path);
    if (!path) continue;
    // Last declaration wins so a governance-evidence overlay can supersede an
    // earlier task-scope entry for the same path without duplicating it.
    byPath.set(path, { ...entry, path });
  }
  return {
    schemaId: 'atm.sealedCommitBundle.v1',
    specVersion: '0.1.0',
    sealedAt: input.sealedAt ?? new Date().toISOString(),
    baseTreeSha: input.baseTreeSha ?? null,
    entries: [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path))
  };
}

/**
 * Exact-match assertion. The candidate tree diff must equal the sealed bundle
 * at path, mode and content granularity — a missing path, an extra path, or a
 * same-path different-blob substitution are all failures. There is no
 * "close enough" verdict: the caller either has the admitted content or it
 * must not move a ref.
 */
export function compareCommitTreeToSealedBundle(input: {
  readonly sealed: SealedCommitBundle;
  readonly actual: readonly CommitTreeEntry[];
}): CommitAttributionProof {
  const sealedByPath = new Map(input.sealed.entries.map((entry) => [normalizePath(entry.path), entry]));
  const actualByPath = new Map<string, CommitTreeEntry>();
  for (const entry of input.actual) {
    const path = normalizePath(entry.path);
    if (!path) continue;
    actualByPath.set(path, { ...entry, path });
  }
  const findings: CommitAttributionFinding[] = [];
  let matched = 0;
  for (const [path, sealedEntry] of sealedByPath) {
    const actualEntry = actualByPath.get(path);
    if (isTombstone(sealedEntry)) {
      // A tombstone is satisfied either by an observed deletion or by the path
      // simply not being in the observed tree — both mean the commit does not
      // carry that content. Anything with post-image content is a failure.
      if (!actualEntry || dispositionOf(actualEntry) === 'deleted') {
        matched += 1;
        continue;
      }
      findings.push({
        kind: 'undeleted-path',
        path,
        sealedMode: sealedEntry.mode,
        actualMode: actualEntry.mode,
        sealedBlobId: null,
        actualBlobId: actualEntry.blobId
      });
      continue;
    }
    if (!actualEntry || dispositionOf(actualEntry) === 'deleted') {
      findings.push({
        kind: 'missing-path',
        path,
        sealedMode: sealedEntry.mode,
        actualMode: actualEntry?.mode ?? null,
        sealedBlobId: sealedEntry.blobId,
        actualBlobId: null
      });
      continue;
    }
    if (normalizeMode(sealedEntry.mode) !== normalizeMode(actualEntry.mode)) {
      findings.push({
        kind: 'mode-mismatch',
        path,
        sealedMode: sealedEntry.mode,
        actualMode: actualEntry.mode,
        sealedBlobId: sealedEntry.blobId,
        actualBlobId: actualEntry.blobId
      });
      continue;
    }
    if (sealedEntry.blobId !== actualEntry.blobId) {
      findings.push({
        kind: 'content-mismatch',
        path,
        sealedMode: sealedEntry.mode,
        actualMode: actualEntry.mode,
        sealedBlobId: sealedEntry.blobId,
        actualBlobId: actualEntry.blobId
      });
      continue;
    }
    matched += 1;
  }
  for (const [path, actualEntry] of actualByPath) {
    if (sealedByPath.has(path)) continue;
    findings.push({
      kind: 'unexpected-path',
      path,
      sealedMode: null,
      actualMode: actualEntry.mode,
      sealedBlobId: null,
      actualBlobId: actualEntry.blobId
    });
  }
  const ordered = findings.sort((left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind));
  const ok = ordered.length === 0;
  return {
    schemaId: 'atm.commitAttributionProof.v1',
    specVersion: '0.1.0',
    ok,
    code: ok ? null : ATM_COMMIT_ATTRIBUTION_MISMATCH,
    sealedEntryCount: sealedByPath.size,
    actualEntryCount: actualByPath.size,
    matchedEntryCount: matched,
    findings: ordered,
    summary: ok
      ? `Candidate tree matches the sealed commit bundle exactly (${matched} entries).`
      : `Candidate tree does not match the sealed commit bundle: ${ordered
        .slice(0, 5)
        .map((finding) => `${finding.kind} ${finding.path}`)
        .join(', ')}${ordered.length > 5 ? `, and ${ordered.length - 5} more` : ''}.`
  };
}

/**
 * An empty bundle is not a permission to commit whatever the shared index
 * happens to hold. Callers must resolve emptiness explicitly before assembly.
 */
export function assertSealedBundleNotEmpty(bundle: SealedCommitBundle): void {
  if (bundle.entries.length > 0) return;
  const error = new Error(
    'Sealed commit bundle is empty; a governed commit cannot fall back to committing the live shared index.'
  ) as Error & { code?: string };
  error.code = ATM_COMMIT_ATTRIBUTION_EMPTY_BUNDLE;
  throw error;
}
