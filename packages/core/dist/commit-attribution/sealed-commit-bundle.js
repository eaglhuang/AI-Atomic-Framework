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
export const ATM_COMMIT_ATTRIBUTION_MISMATCH = 'ATM_COMMIT_ATTRIBUTION_MISMATCH';
export const ATM_COMMIT_ATTRIBUTION_EMPTY_BUNDLE = 'ATM_COMMIT_ATTRIBUTION_EMPTY_BUNDLE';
export const ATM_COMMIT_ATTRIBUTION_UNSEALED_BUNDLE = 'ATM_COMMIT_ATTRIBUTION_UNSEALED_BUNDLE';
function dispositionOf(entry) {
    if (entry.disposition)
        return entry.disposition;
    // An empty blob id can only mean "no post-image content".
    return entry.blobId ? 'present' : 'deleted';
}
export function isTombstone(entry) {
    return dispositionOf(entry) === 'deleted';
}
function normalizePath(value) {
    return value.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
/**
 * Git writes regular files as `100644` but the index and `diff-tree` disagree
 * on zero padding in some host versions, so compare on the significant digits.
 */
function normalizeMode(value) {
    return String(value ?? '').trim().replace(/^0+/, '');
}
export function sealCommitBundle(input) {
    const byPath = new Map();
    for (const entry of input.entries) {
        const path = normalizePath(entry.path);
        if (!path)
            continue;
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
 * Duplicate declarations of one path that disagree about provenance.
 *
 * `sealCommitBundle` resolves duplicates by last-declaration-wins so an overlay
 * can supersede an earlier entry, which is safe only while both declarations
 * agree about who admitted the path. When they do not, the surviving entry
 * silently carries the wrong accountability, so the seal has to be refused
 * before it is ever compared against a tree.
 */
export function findSealedBundleProvenanceConflicts(entries) {
    const declared = new Map();
    const findings = [];
    for (const entry of entries) {
        const path = normalizePath(entry.path);
        if (!path)
            continue;
        const first = declared.get(path);
        if (!first) {
            declared.set(path, entry);
            continue;
        }
        if (first.provenance === entry.provenance)
            continue;
        findings.push({
            kind: 'provenance-mismatch',
            path,
            sealedMode: first.mode,
            actualMode: entry.mode,
            sealedBlobId: first.blobId,
            actualBlobId: entry.blobId,
            sealedProvenance: first.provenance,
            conflictingProvenance: entry.provenance
        });
    }
    return findings.sort((left, right) => left.path.localeCompare(right.path));
}
/**
 * Exact-match assertion. The candidate tree diff must equal the sealed bundle
 * at path, mode and content granularity — a missing path, an extra path, or a
 * same-path different-blob substitution are all failures. There is no
 * "close enough" verdict: the caller either has the admitted content or it
 * must not move a ref.
 */
export function compareCommitTreeToSealedBundle(input) {
    const sealedByPath = new Map(input.sealed.entries.map((entry) => [normalizePath(entry.path), entry]));
    const actualByPath = new Map();
    for (const entry of input.actual) {
        const path = normalizePath(entry.path);
        if (!path)
            continue;
        actualByPath.set(path, { ...entry, path });
    }
    const findings = [];
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
        if (sealedByPath.has(path))
            continue;
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
export function assertSealedBundleNotEmpty(bundle) {
    if (bundle.entries.length > 0)
        return;
    const error = new Error('Sealed commit bundle is empty; a governed commit cannot fall back to committing the live shared index.');
    error.code = ATM_COMMIT_ATTRIBUTION_EMPTY_BUNDLE;
    throw error;
}
