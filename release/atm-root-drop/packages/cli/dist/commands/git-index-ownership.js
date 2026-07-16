import { execFileSync } from 'node:child_process';
import { listActorWorkSessions } from './actor-session.js';
import { readActiveTaskDirectionLocks } from './task-direction.js';
import { isPathAllowedByScope } from './work-channels.js';
export const ATM_INDEX_FOREIGN_ACTIVE_STAGED = 'ATM_INDEX_FOREIGN_ACTIVE_STAGED';
export function inspectGitIndexOwnership(input) {
    const currentTaskId = normalizeTaskId(input.taskId ?? null);
    const stagedFiles = uniqueSorted(input.stagedFiles ?? readStagedFiles(input.cwd));
    const stagedBlobs = readStagedBlobMap(input.cwd, stagedFiles);
    const activeLocks = readActiveTaskDirectionLocks(input.cwd);
    const sessionsByTaskActor = readActiveSessionMap(input.cwd);
    const entries = stagedFiles.map((filePath) => {
        const governanceTaskId = extractGovernanceTaskId(filePath);
        const lockOwner = activeLocks.find((lock) => isPathAllowedByScope(filePath, lock.allowedFiles)) ?? null;
        const ownerTaskId = governanceTaskId ?? lockOwner?.taskId ?? null;
        const ownerActorId = lockOwner?.actorId ?? null;
        const ownerSessionId = lockOwner?.sessionId ?? resolveOwnerSessionId(sessionsByTaskActor, ownerTaskId, ownerActorId);
        const stagedBlob = stagedBlobs.get(normalizeRelativePath(filePath).toLowerCase()) ?? null;
        if (ownerTaskId) {
            const normalizedOwner = normalizeTaskId(ownerTaskId);
            const isCurrent = Boolean(currentTaskId && normalizedOwner === currentTaskId);
            const isActive = activeLocks.some((lock) => normalizeTaskId(lock.taskId) === normalizedOwner && lock.status === 'active');
            return {
                path: normalizeRelativePath(filePath),
                ownership: isCurrent ? 'current-task-owned' : isActive ? 'foreign-active-owned' : 'foreign-released-or-abandoned',
                ownerTaskId: normalizedOwner,
                ownerActorId,
                ownerSessionId,
                stagedBlobId: stagedBlob?.objectId ?? null,
                stagedMode: stagedBlob?.mode ?? null,
                source: governanceTaskId ? 'governance-path' : 'active-direction-lock'
            };
        }
        const normalized = normalizeRelativePath(filePath).toLowerCase();
        if (normalized.startsWith('.atm/history/') || normalized.startsWith('.atm/runtime/')) {
            return {
                path: normalizeRelativePath(filePath),
                ownership: 'unknown-governance-artifact',
                ownerTaskId: null,
                ownerActorId: null,
                ownerSessionId: null,
                stagedBlobId: stagedBlob?.objectId ?? null,
                stagedMode: stagedBlob?.mode ?? null,
                source: 'governance-path'
            };
        }
        return {
            path: normalizeRelativePath(filePath),
            ownership: 'ordinary-unowned',
            ownerTaskId: null,
            ownerActorId: null,
            ownerSessionId: null,
            stagedBlobId: stagedBlob?.objectId ?? null,
            stagedMode: stagedBlob?.mode ?? null,
            source: 'ordinary'
        };
    });
    const foreignActiveStaged = entries.filter((entry) => entry.ownership === 'foreign-active-owned');
    return {
        schemaId: 'atm.gitIndexOwnership.v1',
        taskId: currentTaskId,
        generatedAt: new Date().toISOString(),
        entries,
        foreignActiveStaged,
        indexLane: buildIndexLane(currentTaskId, entries, foreignActiveStaged)
    };
}
export function buildForeignActiveStagedDiagnostic(report) {
    const owners = uniqueSorted(report.foreignActiveStaged.map((entry) => entry.ownerTaskId ?? '').filter(Boolean));
    return {
        code: ATM_INDEX_FOREIGN_ACTIVE_STAGED,
        ownerTaskIds: owners,
        ownerActorIds: uniqueSorted(report.foreignActiveStaged.map((entry) => entry.ownerActorId ?? '').filter(Boolean)),
        ownerSessionIds: uniqueSorted(report.foreignActiveStaged.map((entry) => entry.ownerSessionId ?? '').filter(Boolean)),
        stagedPaths: report.foreignActiveStaged.map((entry) => entry.path),
        indexLane: report.indexLane,
        safeNextActions: [
            'wait-for-owner',
            'request-broker-index-lane',
            'use-explicit-stage-override-lease-if-human-approved'
        ],
        requiredCommand: 'node atm.mjs git lease stage-override --task <task-id> --actor <actor-id> --paths <paths> --reason <human-approved-reason> --json'
    };
}
export function buildGitIndexLeaseParkPlan(input) {
    const expected = new Set(input.expectedStageFiles.map((entry) => normalizeRelativePath(entry).toLowerCase()));
    const foreignEntries = input.report.entries
        .filter((entry) => !expected.has(normalizeRelativePath(entry.path).toLowerCase()))
        .map((entry) => ({
        path: entry.path,
        ownerTaskId: entry.ownerTaskId,
        ownerActorId: entry.ownerActorId,
        stagedBlobId: entry.stagedBlobId,
        stagedMode: entry.stagedMode,
        restoreIdentity: `${entry.stagedMode ?? 'missing'}:${entry.stagedBlobId ?? 'missing'}:${entry.path}`
    }));
    const approvedPartialStagedBlobIds = uniqueSorted(foreignEntries.map((entry) => entry.stagedBlobId ?? '').filter(Boolean));
    const leaseId = input.leaseId?.trim()
        || `index-lease-${shortDigest([
            input.report.taskId ?? 'no-task',
            ...foreignEntries.map((entry) => entry.restoreIdentity)
        ].join('\n'))}`;
    if (input.report.foreignActiveStaged.length > 0) {
        return {
            schemaId: 'atm.gitIndexLeaseParkPlan.v1',
            taskId: input.report.taskId,
            leaseId,
            generatedAt: input.generatedAt ?? new Date().toISOString(),
            status: 'blocked-foreign-active-staged',
            parkEntries: foreignEntries,
            restoreEntries: foreignEntries,
            approvedPartialStagedBlobIds,
            reason: 'Foreign active staged paths require an explicit stage-override lease before park/restore.'
        };
    }
    if (foreignEntries.length === 0) {
        return {
            schemaId: 'atm.gitIndexLeaseParkPlan.v1',
            taskId: input.report.taskId,
            leaseId,
            generatedAt: input.generatedAt ?? new Date().toISOString(),
            status: 'not-needed',
            parkEntries: [],
            restoreEntries: [],
            approvedPartialStagedBlobIds: [],
            reason: 'Shared Git index already contains only expected close-bundle paths.'
        };
    }
    return {
        schemaId: 'atm.gitIndexLeaseParkPlan.v1',
        taskId: input.report.taskId,
        leaseId,
        generatedAt: input.generatedAt ?? new Date().toISOString(),
        status: 'park-and-restore',
        parkEntries: foreignEntries,
        restoreEntries: foreignEntries,
        approvedPartialStagedBlobIds,
        reason: 'Foreign complete bundles can be parked from the live index and restored byte-identically after close-bundle assembly.'
    };
}
export function parkGitIndexLease(cwd, plan) {
    if (plan.status !== 'park-and-restore' || plan.parkEntries.length === 0) {
        return [];
    }
    const paths = plan.parkEntries.map((entry) => entry.path);
    execFileSync('git', ['restore', '--staged', '--', ...paths], {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
    });
    return paths;
}
export function restoreGitIndexLease(cwd, plan) {
    if (plan.status !== 'park-and-restore' || plan.restoreEntries.length === 0) {
        return [];
    }
    const restored = [];
    for (const entry of plan.restoreEntries) {
        if (!entry.stagedMode || !entry.stagedBlobId)
            continue;
        execFileSync('git', ['update-index', '--add', '--cacheinfo', `${entry.stagedMode},${entry.stagedBlobId},${entry.path}`], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe']
        });
        restored.push(entry.path);
    }
    return uniqueSorted(restored);
}
function buildIndexLane(currentTaskId, entries, foreignActiveStaged) {
    if (entries.length === 0) {
        return {
            schemaId: 'atm.gitIndexLane.v1',
            status: 'free',
            ownerTaskId: null,
            ownerActorId: null,
            ownerSessionId: null,
            reason: 'No staged paths are present in the shared Git index.'
        };
    }
    if (foreignActiveStaged.length > 0) {
        const owner = foreignActiveStaged[0];
        return {
            schemaId: 'atm.gitIndexLane.v1',
            status: 'blocked-foreign-active-staged',
            ownerTaskId: owner.ownerTaskId,
            ownerActorId: owner.ownerActorId,
            ownerSessionId: owner.ownerSessionId,
            reason: `The shared Git index contains foreign-active staged paths owned by ${owner.ownerTaskId ?? 'unknown-task'}.`
        };
    }
    const currentOwned = entries.filter((entry) => entry.ownership === 'current-task-owned');
    if (currentOwned.length > 0) {
        return {
            schemaId: 'atm.gitIndexLane.v1',
            status: 'owned-by-task',
            ownerTaskId: currentTaskId,
            ownerActorId: currentOwned[0]?.ownerActorId ?? null,
            ownerSessionId: currentOwned[0]?.ownerSessionId ?? null,
            reason: `The shared Git index currently belongs to ${currentTaskId ?? 'the current task'}.`
        };
    }
    if (entries.some((entry) => entry.ownership === 'unknown-governance-artifact')) {
        return {
            schemaId: 'atm.gitIndexLane.v1',
            status: 'requires-staging-steward',
            ownerTaskId: null,
            ownerActorId: null,
            ownerSessionId: null,
            reason: 'The shared Git index contains governance artifacts whose owner cannot be resolved.'
        };
    }
    return {
        schemaId: 'atm.gitIndexLane.v1',
        status: 'queued',
        ownerTaskId: null,
        ownerActorId: null,
        ownerSessionId: null,
        reason: 'The shared Git index contains staged files but no current-task ownership proof.'
    };
}
function readActiveSessionMap(cwd) {
    const sessions = new Map();
    for (const session of listActorWorkSessions(cwd)) {
        if (session.status !== 'active')
            continue;
        sessions.set(sessionKey(session.taskId, session.actorId), session.sessionId);
    }
    return sessions;
}
function resolveOwnerSessionId(sessionsByTaskActor, ownerTaskId, ownerActorId) {
    if (!ownerTaskId || !ownerActorId)
        return null;
    return sessionsByTaskActor.get(sessionKey(ownerTaskId, ownerActorId)) ?? null;
}
function sessionKey(taskId, actorId) {
    return `${normalizeTaskId(taskId) ?? taskId}::${actorId}`;
}
function readStagedFiles(cwd) {
    try {
        return uniqueSorted(execFileSync('git', ['diff', '--cached', '--name-only'], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).split(/\r?\n/));
    }
    catch {
        return [];
    }
}
function readStagedBlobMap(cwd, stagedFiles) {
    const map = new Map();
    if (stagedFiles.length === 0)
        return map;
    try {
        const output = execFileSync('git', ['ls-files', '-s', '--', ...stagedFiles], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        });
        for (const line of output.split(/\r?\n/)) {
            const match = line.match(/^(\d+)\s+([0-9a-f]+)\s+\d+\t(.+)$/i);
            if (!match)
                continue;
            map.set(normalizeRelativePath(match[3]).toLowerCase(), { mode: match[1], objectId: match[2] });
        }
    }
    catch {
        // Missing blob metadata should not hide ownership classification.
    }
    return map;
}
function extractGovernanceTaskId(filePath) {
    const normalized = normalizeRelativePath(filePath);
    const match = normalized.match(/^\.atm\/history\/(?:tasks|evidence|task-events)\/([^/.]+)(?:[/.]|$)/i);
    return match ? normalizeTaskId(match[1]) : null;
}
function normalizeTaskId(value) {
    const normalized = String(value ?? '').trim().toUpperCase();
    return normalized || null;
}
function normalizeRelativePath(value) {
    return value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}
function uniqueSorted(values) {
    return [...new Set(values.map(normalizeRelativePath).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}
function shortDigest(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}
