import { execFileSync } from 'node:child_process';
function git(cwd, args) {
    const executable = process.env.ATM_GIT_EXECUTABLE || 'git';
    return execFileSync(executable, ['-C', cwd, ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
}
function readIndexEntries(cwd) {
    const entries = new Map();
    let output = '';
    try {
        output = git(cwd, ['ls-files', '-s']);
    }
    catch {
        return entries;
    }
    for (const line of output.split(/\r?\n/)) {
        // `<mode> <object> <stage>\t<path>`
        const separator = line.indexOf('\t');
        if (separator === -1)
            continue;
        const [mode, objectId, stage] = line.slice(0, separator).split(/\s+/);
        const filePath = line.slice(separator + 1).trim();
        if (!mode || !objectId || !filePath)
            continue;
        entries.set(filePath, { mode, objectId, stage: stage ?? '0' });
    }
    return entries;
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
export function restoreIndexToSnapshot(cwd, snapshot) {
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
