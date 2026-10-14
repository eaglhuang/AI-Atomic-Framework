import { execFileSync } from 'node:child_process';
import { closeSync, copyFileSync, existsSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readCompleteIndexSnapshot } from './index-snapshot-read.js';
function git(cwd, args, env = process.env) {
    const executable = process.env.ATM_GIT_EXECUTABLE || 'git';
    return execFileSync(executable, ['-C', cwd, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'], env
    });
}
function readIndexEntries(cwd) {
    return readCompleteIndexSnapshot(cwd);
}
export function captureIndexRestorationSnapshot(cwd) {
    return { entries: readIndexEntries(cwd) };
}
function sameEntry(left, right) {
    if (!left || !right)
        return left === right;
    return left.mode === right.mode && left.objectId === right.objectId && left.stage === right.stage;
}
function diffPaths(snapshot, current) {
    const paths = new Set([...snapshot.keys(), ...current.keys()]);
    return [...paths].filter((filePath) => !sameEntry(snapshot.get(filePath), current.get(filePath))).sort();
}
/**
 * Put back exactly the paths that changed since the snapshot, and nothing else.
 *
 * Bounding restoration to the diff is what keeps another lane's staged work
 * intact: a path the operation never touched is never rewritten, so a foreign
 * staged blob is preserved as the bytes it already was rather than "restored"
 * from HEAD.
 */
export function restoreIndexToSnapshot(cwd, snapshot, ownership) {
    if (ownership)
        return restoreOwnedIndexEntries(cwd, snapshot, ownership);
    const changed = diffPaths(snapshot.entries, readIndexEntries(cwd));
    if (changed.length === 0) {
        return { restoredPaths: [], residualPaths: [], verified: true };
    }
    for (const filePath of changed) {
        const original = snapshot.entries.get(filePath);
        try {
            if (original) {
                // Rewrite the exact mode/blob/stage the index held, without consulting
                // HEAD or the worktree.
                git(cwd, ['update-index', '--add', '--cacheinfo', `${original.mode},${original.objectId},${filePath}`]);
            }
            else {
                // The path was untracked at capture time; remove the entry the
                // operation added rather than inventing content for it.
                git(cwd, ['update-index', '--force-remove', '--', filePath]);
            }
        }
        catch {
            // Fall through: the verification pass below reports what remains.
        }
    }
    const residualPaths = diffPaths(snapshot.entries, readIndexEntries(cwd));
    return {
        restoredPaths: changed.filter((filePath) => !residualPaths.includes(filePath)),
        residualPaths,
        verified: residualPaths.length === 0
    };
}
/** Restore only declared operation writes that still equal their observed
 * post-write entry. Hold Git's real index lock across comparison and atomic
 * publication, so a concurrent writer cannot slip between the two checks. */
function restoreOwnedIndexEntries(cwd, snapshot, ownership) {
    const paths = [...new Set(ownership.paths)].sort();
    if (paths.length === 0)
        return { restoredPaths: [], residualPaths: [], verified: true };
    const indexPath = path.resolve(cwd, git(cwd, ['rev-parse', '--git-path', 'index']).trim());
    const lockPath = `${indexPath}.lock`;
    let descriptor = null;
    let ownsLock = false;
    let tempDir = null;
    const restoredPaths = [];
    const residualPaths = [];
    try {
        descriptor = openSync(lockPath, 'wx');
        ownsLock = true;
        const current = readIndexEntries(cwd);
        const changed = paths.filter((file) => !sameEntry(snapshot.entries.get(file), current.get(file)));
        if (!changed.length)
            return { restoredPaths, residualPaths, verified: true };
        tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-owned-index-rollback-'));
        const candidate = path.join(tempDir, 'index');
        const env = { ...process.env, GIT_INDEX_FILE: candidate };
        if (existsSync(indexPath))
            copyFileSync(indexPath, candidate);
        else
            git(cwd, ['read-tree', '--empty'], env);
        for (const file of changed) {
            const expected = ownership.expected.entries.get(file);
            const original = snapshot.entries.get(file);
            if (!sameEntry(current.get(file), expected) || (original && original.stage !== '0') || (expected && expected.stage !== '0')) {
                residualPaths.push(file);
                continue;
            }
            if (original)
                git(cwd, ['update-index', '--add', '--cacheinfo', `${original.mode},${original.objectId},${file}`], env);
            else
                git(cwd, ['update-index', '--force-remove', '--', file], env);
            restoredPaths.push(file);
        }
        if (restoredPaths.length) {
            writeFileSync(descriptor, readFileSync(candidate));
            closeSync(descriptor);
            descriptor = null;
            renameSync(lockPath, indexPath);
            ownsLock = false;
        }
        return { restoredPaths, residualPaths, verified: residualPaths.length === 0 };
    }
    catch {
        return { restoredPaths: [], residualPaths: paths, verified: false };
    }
    finally {
        if (descriptor !== null)
            closeSync(descriptor);
        if (ownsLock)
            rmSync(lockPath, { force: true });
        if (tempDir)
            rmSync(tempDir, { recursive: true, force: true });
    }
}
