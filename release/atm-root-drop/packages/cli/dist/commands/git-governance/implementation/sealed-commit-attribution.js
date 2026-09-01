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
import { ATM_COMMIT_ATTRIBUTION_MISMATCH, ATM_COMMIT_ATTRIBUTION_UNSEALED_BUNDLE, assertSealedBundleNotEmpty, compareCommitTreeToSealedBundle, findSealedBundleProvenanceConflicts, isTombstone, sealCommitBundle } from '../../../_vendor/core/dist/commit-attribution/sealed-commit-bundle.js';
import { CliError } from '../../shared.js';
import { runGitCommand, runGitCommandWithEnv } from './git-process-port.js';
import { attachLiveIndexReconciliation, captureLiveIndexSnapshot, readHeadCommit, reconcileLiveIndexAfterCommitAttempt } from './live-index-reconciliation.js';
const QUIET_STDIO = ['ignore', 'pipe', 'pipe'];
/** `<mode> <objectId> <stage>\t<path>` as emitted by `git ls-files -s`. */
const LS_FILES_STAGE_PATTERN = /^(\d+) ([0-9a-f]+) \d+\t(.+)$/i;
/** `<mode> blob <objectId>\t<path>` as emitted by `git ls-tree -r`. */
const LS_TREE_PATTERN = /^(\d+) blob ([0-9a-f]+)\t(.+)$/i;
/** `:<srcMode> <dstMode> <srcSha> <dstSha> <status>\t<path>` from diff plumbing. */
const RAW_DIFF_PATTERN = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*\t(.+)$/i;
const NULL_OBJECT_ID = /^0+$/;
function normalizePath(value) {
    return String(value ?? '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}
function splitLines(output) {
    return String(output ?? '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}
/**
 * Seal the admitted paths against the live index exactly once. Every later
 * step reads this snapshot instead of the index, which is what closes the
 * substitution window between admission and assembly.
 */
export function sealCommitBundleFromLiveIndex(input) {
    const paths = [...new Set(input.paths.map(normalizePath).filter(Boolean))].sort();
    if (paths.length === 0) {
        return sealCommitBundle({ entries: [], baseTreeSha: input.baseTreeSha ?? null });
    }
    const entries = [];
    for (const line of splitLines(runGitCommand(input.cwd, ['ls-files', '-s', '--', ...paths]))) {
        const match = line.match(LS_FILES_STAGE_PATTERN);
        if (!match)
            continue;
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
export function withWorktreeCandidateIndex(input) {
    const paths = [...new Set(input.paths.map(normalizePath).filter(Boolean))].sort();
    const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-worktree-candidate-index-'));
    const env = { ...process.env, GIT_INDEX_FILE: path.join(tempDir, 'index') };
    try {
        runGitCommandWithEnv(input.cwd, ['read-tree', 'HEAD'], env, [...QUIET_STDIO]);
        if (paths.length > 0) {
            runGitCommandWithEnv(input.cwd, ['add', '-A', '-f', '--', ...paths], env, [...QUIET_STDIO]);
        }
        return input.run(env);
    }
    finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}
/**
 * Paths the index removes relative to the base tree, sealed with their
 * pre-image mode so the tombstone still carries identity.
 */
function readStagedDeletionEntries(input) {
    const entries = [];
    for (const line of splitLines(input.env
        ? runGitCommandWithEnv(input.cwd, ['diff-index', '--cached', '--raw', '--diff-filter=D', input.baseRef, '--', ...input.paths], input.env, [...QUIET_STDIO])
        : runGitCommand(input.cwd, ['diff-index', '--cached', '--raw', '--diff-filter=D', input.baseRef, '--', ...input.paths]))) {
        const match = line.match(RAW_DIFF_PATTERN);
        if (!match)
            continue;
        entries.push({
            path: normalizePath(match[6]),
            mode: match[1],
            blobId: '',
            provenance: input.provenance ?? 'task-scope',
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
export function mergeSealedCommitBundles(base, overlay, options) {
    const superseding = new Set((options?.supersedingPaths ?? []).map(normalizePath).filter(Boolean));
    const conflicts = findSealedBundleProvenanceConflicts([...base.entries, ...overlay.entries])
        .filter((finding) => !superseding.has(finding.path));
    if (conflicts.length > 0) {
        throw new CliError(ATM_COMMIT_ATTRIBUTION_MISMATCH, `Sealed commit bundle declares conflicting provenance for ${conflicts.map((finding) => finding.path).join(', ')}.`, {
            exitCode: 1,
            details: {
                surface: options?.surface ?? 'seal-composition',
                findings: conflicts,
                safeNextActions: [
                    're-resolve-the-commit-bundle-and-retry',
                    'declare-the-superseding-paths-explicitly'
                ]
            }
        });
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
export function assembleSealedCommitIndex(input) {
    runGitCommandWithEnv(input.cwd, ['read-tree', input.baseRef ?? 'HEAD'], input.env, [...QUIET_STDIO]);
    const paths = input.bundle.entries.map((entry) => entry.path);
    if (paths.length === 0)
        return;
    // Every sealed path is first removed from the candidate index. Tombstoned
    // paths stop here: they are never re-added, and because the content is taken
    // from the seal rather than the worktree, a file that still exists on disk
    // cannot resurrect itself into the commit.
    runGitCommandWithEnv(input.cwd, ['rm', '--cached', '--quiet', '--ignore-unmatch', '--force', '--', ...paths], input.env, [...QUIET_STDIO]);
    const presentEntries = input.bundle.entries.filter((entry) => !isTombstone(entry));
    const baseRef = input.baseRef ?? 'HEAD';
    const inheritedEntries = presentEntries.filter((entry) => isTrackedInBaseTree({
        cwd: input.cwd,
        env: input.env,
        baseRef,
        path: entry.path
    }));
    const newEntryPaths = presentEntries
        .filter((entry) => !inheritedEntries.some((inherited) => inherited.path === entry.path))
        .map((entry) => entry.path);
    for (const entry of presentEntries) {
        runGitCommandWithEnv(input.cwd, ['update-index', '--add', '--cacheinfo', `${entry.mode},${entry.blobId},${entry.path}`], input.env, [...QUIET_STDIO]);
    }
    // `update-index --cacheinfo` creates a valid sealed entry but no worktree
    // stat data. Git then drops an ignored, newly-created path during commit as
    // though the candidate were empty. Force-adding only new entries supplies
    // that stat data; the attribution proof immediately below still compares
    // their resulting blobs to the seal before any ref can move.
    if (newEntryPaths.length > 0) {
        runGitCommandWithEnv(input.cwd, ['add', '-A', '-f', '--', ...newEntryPaths], input.env, [...QUIET_STDIO]);
    }
    // `update-index --cacheinfo` writes entries with no stat data, which makes
    // `git commit` refresh them against the worktree and silently re-hash
    // whatever a concurrent writer left there — reintroducing the exact
    // substitution this seal exists to prevent. Marking the sealed entries
    // assume-unchanged tells the refresh to trust the index. The bit only ever
    // exists in the throwaway candidate index, never in the live one.
    if (inheritedEntries.length === 0)
        return;
    runGitCommandWithEnv(input.cwd, ['update-index', '--assume-unchanged', '--', ...inheritedEntries.map((entry) => entry.path)], input.env, [...QUIET_STDIO]);
}
/**
 * A newly introduced (often ignored) governance artifact has no base-tree
 * entry. Marking it assume-unchanged makes Git omit it from the candidate
 * commit entirely, so retain the seal bit only for inherited paths.
 */
function isTrackedInBaseTree(input) {
    try {
        runGitCommandWithEnv(input.cwd, ['cat-file', '-e', `${input.baseRef}:${input.path}`], input.env, [...QUIET_STDIO]);
        return true;
    }
    catch {
        return false;
    }
}
function parseRawDiffEntries(output) {
    const entries = [];
    for (const line of splitLines(output)) {
        const match = line.match(RAW_DIFF_PATTERN);
        if (!match)
            continue;
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
export function readCandidateTreeEntries(input) {
    const sealedPaths = [...new Set((input.sealedPaths ?? []).map(normalizePath).filter(Boolean))].sort();
    const entries = new Map();
    if (sealedPaths.length > 0) {
        for (const line of splitLines(runGitCommandWithEnv(input.cwd, ['ls-files', '-s', '--', ...sealedPaths], input.env, [...QUIET_STDIO]))) {
            const match = line.match(LS_FILES_STAGE_PATTERN);
            if (!match)
                continue;
            entries.set(normalizePath(match[3]), { path: normalizePath(match[3]), mode: match[1], blobId: match[2], disposition: 'present' });
        }
    }
    const diffEntries = parseRawDiffEntries(runGitCommandWithEnv(input.cwd, ['diff-index', '--cached', '--raw', '-M', input.baseRef ?? 'HEAD'], input.env, [
        ...QUIET_STDIO
    ]));
    for (const entry of diffEntries) {
        if (entries.has(entry.path))
            continue;
        entries.set(entry.path, entry);
    }
    return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
}
/**
 * Post-image entries recorded by an existing commit, projected to the sealed
 * paths plus any changed intruders. A diff alone cannot represent a sealed
 * path inherited unchanged from the parent; the committed tree is therefore
 * authoritative for sealed paths, while the diff remains authoritative for
 * unsealed additions, modifications, and deletions.
 */
export function readCommittedTreeEntries(cwd, commitSha, sealedPaths = []) {
    const normalizedSealedPaths = [...new Set(sealedPaths.map(normalizePath).filter(Boolean))].sort();
    const entries = new Map();
    if (normalizedSealedPaths.length > 0) {
        for (const line of splitLines(runGitCommand(cwd, ['ls-tree', '-r', commitSha, '--', ...normalizedSealedPaths]))) {
            const match = line.match(LS_TREE_PATTERN);
            if (!match)
                continue;
            entries.set(normalizePath(match[3]), { path: normalizePath(match[3]), mode: match[1], blobId: match[2], disposition: 'present' });
        }
    }
    for (const entry of parseRawDiffEntries(runGitCommand(cwd, ['diff-tree', '--no-commit-id', '--raw', '-r', '-M', commitSha]))) {
        if (!entries.has(entry.path))
            entries.set(entry.path, entry);
    }
    return [...entries.values()].sort((left, right) => left.path.localeCompare(right.path));
}
export function proveCommitAttribution(input) {
    // Deletions seal an empty blob id on both sides, so they compare equal
    // without special-casing the comparison policy in core.
    return compareCommitTreeToSealedBundle({ sealed: input.sealed, actual: input.actual });
}
/**
 * Fail closed before a ref moves. This is intentionally a hard error rather
 * than a diagnostic: an unexplained entry in the candidate tree means the
 * commit would attribute someone else's content to this actor.
 */
export function assertCommitAttribution(input) {
    const proof = proveCommitAttribution({ sealed: input.sealed, actual: input.actual });
    if (proof.ok)
        return proof;
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
/**
 * Resolve the seal a governed commit will be proved against.
 *
 * Both governed branches seal explicitly: a resolved task-scope bundle is
 * reused as admitted, and a commit that has only a pre-staged index seals that
 * index here, under its own provenance, rather than letting the transaction
 * discover an unsealed state later and improvise.
 */
export function resolveGovernedCommitSeal(input) {
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
export function runWithSealedTaskScopedCommitIndex(input) {
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
            ? mergeSealedCommitBundles(sealed, sealCommitBundleFromCandidateIndex({ cwd: input.cwd, env, paths: evidencePaths }), { supersedingPaths: evidencePaths, surface: input.surface })
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
        let result;
        try {
            result = input.run(env);
        }
        catch (commitError) {
            throw attachLiveIndexReconciliation(commitError, reconcileLiveIndexAfterCommitAttempt({
                cwd: input.cwd,
                snapshot: liveIndexSnapshot,
                headBefore: headBeforeCommit
            }));
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
    }
    finally {
        rmSync(tempDir, { recursive: true, force: true });
    }
}
/**
 * Reject an unnamed seal before a temporary index is even created. A caller
 * that reaches assembly without a bundle and without asking for the diagnostic
 * route would otherwise commit whatever the shared index holds.
 */
function assertNamedSealSource(source, surface) {
    if (source?.kind === 'sealed-bundle' || (source?.kind === 'live-index-diagnostic' && source.reason.trim())) {
        return source;
    }
    throw new CliError(ATM_COMMIT_ATTRIBUTION_UNSEALED_BUNDLE, 'A governed commit requires an admitted sealed bundle; sealing the live shared index is only available as a named diagnostic route with a reason.', {
        exitCode: 1,
        details: {
            surface,
            sealSourceKind: source?.kind ?? null,
            safeNextActions: [
                'resolve-and-admit-the-commit-bundle-before-committing',
                'pass-a-live-index-diagnostic-reason-for-non-governed-probes'
            ]
        }
    });
}
/** Seal specific paths from an already-assembled candidate index. */
export function sealCommitBundleFromCandidateIndex(input) {
    const paths = [...new Set(input.paths.map(normalizePath).filter(Boolean))].sort();
    if (paths.length === 0)
        return sealCommitBundle({ entries: [] });
    const entries = [];
    for (const line of splitLines(runGitCommandWithEnv(input.cwd, ['ls-files', '-s', '--', ...paths], input.env, [...QUIET_STDIO]))) {
        const match = line.match(LS_FILES_STAGE_PATTERN);
        if (!match)
            continue;
        entries.push({
            path: normalizePath(match[3]),
            mode: match[1],
            blobId: match[2],
            provenance: 'governance-evidence'
        });
    }
    for (const entry of readStagedDeletionEntries({
        cwd: input.cwd,
        paths,
        baseRef: 'HEAD',
        env: input.env,
        provenance: 'governance-evidence'
    })) {
        entries.push(entry);
    }
    return sealCommitBundle({ entries });
}
