import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeTaskId } from './task-import-validators.js';
import { normalizeRelativePath } from './task-file-io-helpers.js';
import { CliError, quoteCliValue, relativePathFrom } from '../shared.js';
import { inspectGitIndexOwnership } from '../git-index-ownership.js';
export const CLOSE_WINDOW_STAGED_INDEX_LOCK_SCHEMA_ID = 'atm.closeWindowStagedIndexLock.v1';
function resolveGitExecutable() {
    const configured = process.env.ATM_GIT_EXECUTABLE?.trim();
    if (configured && existsSync(configured)) {
        return configured;
    }
    if (process.platform === 'win32') {
        const windowsGit = 'C:\\Program Files\\Git\\cmd\\git.exe';
        if (existsSync(windowsGit)) {
            return windowsGit;
        }
    }
    return 'git';
}
function closeWindowStagedIndexLockPath(cwd) {
    return path.join(cwd, '.atm', 'runtime', 'locks', 'close-window-staged-index.lock.json');
}
function uniqueSorted(values) {
    return [...new Set(values.map((entry) => normalizeRelativePath(entry)).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
function readStagedFiles(repoRoot) {
    try {
        return uniqueSorted(execFileSync(resolveGitExecutable(), ['diff', '--cached', '--name-only'], {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).split(/\r?\n/));
    }
    catch {
        return [];
    }
}
function extractGovernanceTaskId(filePath) {
    const normalized = normalizeRelativePath(filePath);
    if (!normalized.startsWith('.atm/history/'))
        return null;
    const tasksMatch = normalized.match(/^\.atm\/history\/tasks\/([^/]+)\.json$/i);
    if (tasksMatch)
        return normalizeTaskId(tasksMatch[1]);
    const evidenceMatch = normalized.match(/^\.atm\/history\/evidence\/([^/.]+)(?:\.[^/]+)?$/i);
    if (evidenceMatch)
        return normalizeTaskId(evidenceMatch[1]);
    const eventMatch = normalized.match(/^\.atm\/history\/task-events\/([^/]+)\//i);
    if (eventMatch)
        return normalizeTaskId(eventMatch[1]);
    return null;
}
export function inspectForeignStagedTasksForCloseWindow(input) {
    const expected = new Set(uniqueSorted(input.expectedStageFiles));
    const stagedFiles = readStagedFiles(input.cwd);
    const unexpected = stagedFiles.filter((filePath) => !expected.has(filePath));
    const ownership = inspectGitIndexOwnership({
        cwd: input.cwd,
        taskId: input.taskId,
        stagedFiles: unexpected
    });
    const grouped = new Map();
    for (const entry of ownership.foreignActiveStaged) {
        if (!entry.ownerTaskId)
            continue;
        const bucket = grouped.get(entry.ownerTaskId) ?? [];
        bucket.push(entry.path);
        grouped.set(entry.ownerTaskId, bucket);
    }
    return [...grouped.entries()].map(([foreignTaskId, files]) => {
        const uniqueFiles = uniqueSorted(files);
        return {
            taskId: foreignTaskId,
            stagedFiles: uniqueFiles,
            restoreChoice: `Do not silently unstage ${foreignTaskId}. Wait for that agent to commit, request a Broker index lane, or use an explicit ATM stage-override lease if the human approved disrupting another active agent.`,
            deferCommand: `node atm.mjs git lease stage-override --task ${input.taskId} --actor <actor-id> --paths ${uniqueFiles.map(quoteCliValue).join(',')} --reason "<human-approved reason>" --json`
        };
    });
}
function readCloseWindowStagedIndexLock(cwd) {
    const lockPath = closeWindowStagedIndexLockPath(cwd);
    if (!existsSync(lockPath))
        return null;
    try {
        const parsed = JSON.parse(readFileSync(lockPath, 'utf8'));
        if (parsed?.schemaId !== CLOSE_WINDOW_STAGED_INDEX_LOCK_SCHEMA_ID)
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
const INDEX_LOCK_RETRY_DELAYS_MS = [25, 50, 100, 200, 400, 800, 1600];
function isGitIndexLockContention(error) {
    const message = error instanceof Error ? error.message : String(error);
    return /(?:index\.lock|unable to create .*\.git[\\/]index\.lock)/i.test(message);
}
function waitForIndexLockRetry(delayMs) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
}
/**
 * Runs one index mutation through a deliberately bounded retry window.
 * A close window never steals a live Git lock: it merely tolerates the short
 * hand-off interval after a child commit/hook releases the shared index.
 */
export function runGitIndexMutationWithRetry(input) {
    for (let attempt = 0;; attempt += 1) {
        try {
            (input.run ?? (() => execFileSync(resolveGitExecutable(), input.args, {
                cwd: input.cwd,
                stdio: ['ignore', 'pipe', 'pipe']
            })))();
            return;
        }
        catch (error) {
            const delayMs = INDEX_LOCK_RETRY_DELAYS_MS[attempt];
            if (!isGitIndexLockContention(error) || delayMs === undefined) {
                if (isGitIndexLockContention(error)) {
                    throw new CliError('ATM_CLOSE_WINDOW_FOREIGN_STAGED_TASKS', `Close window could not ${input.operation} because Git's shared index remained busy.`, {
                        exitCode: 1,
                        details: {
                            recoveryState: 'index-lock-timeout',
                            operation: input.operation,
                            attempts: attempt + 1,
                            remediation: 'Keep the close-window record and durable restore identity intact. Wait for the active Git operation to finish, then retry the governed close or rollback path.'
                        }
                    });
                }
                throw error;
            }
            waitForIndexLockRetry(delayMs);
        }
    }
}
function readStagedIndexEntries(cwd, files) {
    const requested = uniqueSorted(files);
    if (requested.length === 0)
        return [];
    const output = execFileSync(resolveGitExecutable(), ['ls-files', '-s', '--', ...requested], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
    const present = new Map(output.split(/\r?\n/).flatMap((line) => {
        const match = /^(\d+)\s+([0-9a-f]{40,})\s+\d+\t(.+)$/.exec(line.trim());
        return match ? [{ mode: match[1], blobId: match[2], path: normalizeRelativePath(match[3]) }] : [];
    }).filter((entry) => entry.path).map((entry) => [entry.path, entry]));
    return requested.map((filePath) => present.get(filePath) ?? { path: filePath, mode: null, blobId: null });
}
function writeForeignStagedSnapshot(cwd, taskId, files) {
    const entries = readStagedIndexEntries(cwd, files);
    const snapshotPath = `.atm/runtime/snapshots/close-window-foreign-staged-${taskId}-${Date.now()}.json`;
    mkdirSync(path.dirname(path.join(cwd, snapshotPath)), { recursive: true });
    writeFileSync(path.join(cwd, snapshotPath), `${JSON.stringify({
        schemaId: 'atm.closeWindowForeignStagedSnapshot.v1',
        taskId,
        createdAt: new Date().toISOString(),
        files: uniqueSorted(files),
        entries
    }, null, 2)}\n`, 'utf8');
    return { snapshotPath, entries };
}
function restoreForeignStagedEntries(cwd, entries, recoveryReference) {
    if (entries.length === 0) {
        throw new CliError('ATM_CLOSE_WINDOW_FOREIGN_STAGED_TASKS', 'Close window cannot restore a legacy or incomplete foreign staged snapshot.', {
            exitCode: 1,
            details: {
                recoveryState: 'restore-snapshot-incomplete',
                snapshotPath: recoveryReference,
                remediation: 'The close-window lock and recovery snapshot were retained. Repair the durable snapshot before retrying release; do not delete the snapshot or claim success.'
            }
        });
    }
    for (const entry of entries) {
        const args = entry.mode === null || entry.blobId === null
            ? ['update-index', '--force-remove', '--', entry.path]
            : ['update-index', '--add', '--cacheinfo', `${entry.mode},${entry.blobId},${entry.path}`];
        runGitIndexMutationWithRetry({
            cwd,
            args,
            operation: `restore foreign staged entry ${entry.path}`
        });
    }
    const restored = readStagedIndexEntries(cwd, entries.map((entry) => entry.path));
    const describe = (entry) => `${entry.mode ?? 'deleted'}:${entry.blobId ?? 'deleted'}:${entry.path}`;
    const expected = entries.map(describe).sort();
    const actual = restored.map(describe).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new CliError('ATM_CLOSE_WINDOW_FOREIGN_STAGED_TASKS', 'Close window restored foreign staged entries but byte-identity verification failed.', {
            exitCode: 1,
            details: {
                recoveryState: 'restore-verification-failed',
                snapshotPath: recoveryReference,
                expected,
                actual,
                remediation: 'The close-window lock and recovery snapshot were retained. Do not finalize the close until the foreign index entries match the durable snapshot byte-for-byte.'
            }
        });
    }
}
function deferForeignStagedFiles(cwd, taskId, files) {
    const normalizedFiles = uniqueSorted(files);
    if (normalizedFiles.length === 0)
        return null;
    const snapshot = writeForeignStagedSnapshot(cwd, taskId, normalizedFiles);
    runGitIndexMutationWithRetry({
        cwd,
        args: ['restore', '--staged', '--', ...files],
        operation: 'defer foreign staged entries'
    });
    return snapshot;
}
function cleanupForeignStagedSnapshot(cwd, snapshotPath) {
    if (!snapshotPath)
        return;
    const absolutePath = path.join(cwd, snapshotPath);
    if (!existsSync(absolutePath))
        return;
    try {
        unlinkSync(absolutePath);
    }
    catch {
        // best-effort runtime residue cleanup
    }
}
export function acquireCloseWindowStagedIndexLock(input) {
    const lockPath = closeWindowStagedIndexLockPath(input.cwd);
    const existing = readCloseWindowStagedIndexLock(input.cwd);
    if (existing?.status === 'active' && existing.taskId !== normalizeTaskId(input.taskId)) {
        return {
            schemaId: CLOSE_WINDOW_STAGED_INDEX_LOCK_SCHEMA_ID,
            ok: false,
            lockPath: relativePathFrom(input.cwd, lockPath),
            lock: existing,
            unexpectedStagedTasks: existing.unexpectedStagedTasks,
            foreignStagedSnapshotPath: existing.foreignStagedSnapshotPath,
            blockedCode: 'ATM_CLOSE_WINDOW_STAGED_INDEX_LOCKED',
            blockedSummary: `Close window staged-index lock is already held by ${existing.taskId}; wait for release or inspect tasks status before staging.`
        };
    }
    const unexpectedStagedTasks = inspectForeignStagedTasksForCloseWindow({
        cwd: input.cwd,
        taskId: input.taskId,
        expectedStageFiles: input.expectedStageFiles
    });
    const expectedStageFiles = new Set(uniqueSorted(input.expectedStageFiles));
    const unexpectedStagedFiles = readStagedFiles(input.cwd).filter((filePath) => !expectedStageFiles.has(filePath));
    if (unexpectedStagedFiles.length > 0 && !input.deferForeignStaged) {
        return {
            schemaId: CLOSE_WINDOW_STAGED_INDEX_LOCK_SCHEMA_ID,
            ok: false,
            lockPath: relativePathFrom(input.cwd, lockPath),
            lock: existing,
            unexpectedStagedTasks,
            foreignStagedSnapshotPath: null,
            blockedCode: 'ATM_CLOSE_WINDOW_FOREIGN_STAGED_TASKS',
            blockedSummary: unexpectedStagedTasks.length > 0
                ? `Close window blocked by foreign staged tasks (${unexpectedStagedTasks.map((entry) => entry.taskId).join(', ')}); defer explicitly or wait for the other agent to commit.`
                : 'Close window blocked by staged entries outside the governed bundle; defer explicitly or reconcile the index before closing.'
        };
    }
    // Publish the coordination lease before touching Git's shared index.  The
    // former order parked foreign entries first, leaving an index-lock race.
    let record = {
        schemaId: CLOSE_WINDOW_STAGED_INDEX_LOCK_SCHEMA_ID,
        specVersion: '0.1.0',
        taskId: normalizeTaskId(input.taskId),
        actorId: input.actorId,
        acquiredAt: new Date().toISOString(),
        status: 'active',
        expectedStageFiles: uniqueSorted(input.expectedStageFiles),
        foreignStagedSnapshotPath: null,
        foreignStagedEntries: [],
        unexpectedStagedTasks,
        releasedAt: null,
        releaseOutcome: null
    };
    mkdirSync(path.dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    try {
        if (unexpectedStagedFiles.length > 0 && input.deferForeignStaged) {
            const deferred = deferForeignStagedFiles(input.cwd, input.taskId, unexpectedStagedFiles);
            record = {
                ...record,
                foreignStagedSnapshotPath: deferred?.snapshotPath ?? null,
                foreignStagedEntries: deferred?.entries ?? []
            };
            writeFileSync(lockPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
        }
    }
    catch (error) {
        unlinkSync(lockPath);
        throw error;
    }
    return {
        schemaId: CLOSE_WINDOW_STAGED_INDEX_LOCK_SCHEMA_ID,
        ok: true,
        lockPath: relativePathFrom(input.cwd, lockPath),
        lock: record,
        unexpectedStagedTasks,
        foreignStagedSnapshotPath: record.foreignStagedSnapshotPath,
        blockedCode: null,
        blockedSummary: null
    };
}
export function assertCloseWindowStagingAllowed(input) {
    const lock = readCloseWindowStagedIndexLock(input.cwd);
    if (!lock || lock.status !== 'active')
        return;
    if (lock.taskId === normalizeTaskId(input.taskId))
        return;
    throw new CliError('ATM_CLOSE_WINDOW_STAGED_INDEX_LOCKED', `Close window staged-index lock held by ${lock.taskId} blocks ${input.operation}.`, {
        exitCode: 1,
        details: {
            lockTaskId: lock.taskId,
            operation: input.operation,
            lockPath: relativePathFrom(input.cwd, closeWindowStagedIndexLockPath(input.cwd)),
            requiredCommand: `node atm.mjs tasks status --task ${lock.taskId} --json`
        }
    });
}
export function releaseCloseWindowStagedIndexLock(input) {
    const lockPath = closeWindowStagedIndexLockPath(input.cwd);
    const existing = readCloseWindowStagedIndexLock(input.cwd);
    if (!existing || existing.status !== 'active')
        return null;
    if (existing.taskId !== normalizeTaskId(input.taskId))
        return existing;
    if (existing.foreignStagedSnapshotPath) {
        restoreForeignStagedEntries(input.cwd, existing.foreignStagedEntries ?? [], existing.foreignStagedSnapshotPath);
        cleanupForeignStagedSnapshot(input.cwd, existing.foreignStagedSnapshotPath);
    }
    const released = {
        ...existing,
        status: 'released',
        releasedAt: new Date().toISOString(),
        releaseOutcome: input.outcome
    };
    try {
        unlinkSync(lockPath);
    }
    catch {
        writeFileSync(lockPath, `${JSON.stringify(released, null, 2)}\n`, 'utf8');
    }
    return released;
}
export function readCloseWindowStagedIndexLockReport(cwd) {
    return readCloseWindowStagedIndexLock(cwd);
}
