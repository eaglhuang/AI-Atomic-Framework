import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeTaskId } from './task-import-validators.js';
import { normalizeRelativePath } from './task-file-io-helpers.js';
import { CliError, quoteCliValue, relativePathFrom } from '../shared.js';
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
    const grouped = new Map();
    for (const filePath of unexpected) {
        const foreignTaskId = extractGovernanceTaskId(filePath);
        if (!foreignTaskId || foreignTaskId === normalizeTaskId(input.taskId))
            continue;
        const bucket = grouped.get(foreignTaskId) ?? [];
        bucket.push(filePath);
        grouped.set(foreignTaskId, bucket);
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
function writeForeignStagedSnapshot(cwd, taskId, files) {
    const snapshotPath = `.atm/runtime/snapshots/close-window-foreign-staged-${taskId}-${Date.now()}.json`;
    mkdirSync(path.dirname(path.join(cwd, snapshotPath)), { recursive: true });
    writeFileSync(path.join(cwd, snapshotPath), `${JSON.stringify({
        schemaId: 'atm.closeWindowForeignStagedSnapshot.v1',
        taskId,
        createdAt: new Date().toISOString(),
        files: uniqueSorted(files)
    }, null, 2)}\n`, 'utf8');
    return snapshotPath;
}
function deferForeignStagedFiles(cwd, unexpectedStagedTasks) {
    if (unexpectedStagedTasks.length === 0)
        return null;
    const files = uniqueSorted(unexpectedStagedTasks.flatMap((entry) => entry.stagedFiles));
    const snapshotPath = writeForeignStagedSnapshot(cwd, unexpectedStagedTasks[0]?.taskId ?? 'foreign', files);
    execFileSync(resolveGitExecutable(), ['restore', '--staged', '--', ...files], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    return snapshotPath;
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
    let foreignStagedSnapshotPath = null;
    if (unexpectedStagedTasks.length > 0 && !input.deferForeignStaged) {
        return {
            schemaId: CLOSE_WINDOW_STAGED_INDEX_LOCK_SCHEMA_ID,
            ok: false,
            lockPath: relativePathFrom(input.cwd, lockPath),
            lock: existing,
            unexpectedStagedTasks,
            foreignStagedSnapshotPath: null,
            blockedCode: 'ATM_CLOSE_WINDOW_FOREIGN_STAGED_TASKS',
            blockedSummary: `Close window blocked by foreign staged tasks (${unexpectedStagedTasks.map((entry) => entry.taskId).join(', ')}); defer explicitly or wait for the other agent to commit.`
        };
    }
    if (unexpectedStagedTasks.length > 0 && input.deferForeignStaged) {
        foreignStagedSnapshotPath = deferForeignStagedFiles(input.cwd, unexpectedStagedTasks);
    }
    const record = {
        schemaId: CLOSE_WINDOW_STAGED_INDEX_LOCK_SCHEMA_ID,
        specVersion: '0.1.0',
        taskId: normalizeTaskId(input.taskId),
        actorId: input.actorId,
        acquiredAt: new Date().toISOString(),
        status: 'active',
        expectedStageFiles: uniqueSorted(input.expectedStageFiles),
        foreignStagedSnapshotPath,
        unexpectedStagedTasks,
        releasedAt: null,
        releaseOutcome: null
    };
    mkdirSync(path.dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    return {
        schemaId: CLOSE_WINDOW_STAGED_INDEX_LOCK_SCHEMA_ID,
        ok: true,
        lockPath: relativePathFrom(input.cwd, lockPath),
        lock: record,
        unexpectedStagedTasks,
        foreignStagedSnapshotPath,
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
    cleanupForeignStagedSnapshot(input.cwd, existing.foreignStagedSnapshotPath);
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
