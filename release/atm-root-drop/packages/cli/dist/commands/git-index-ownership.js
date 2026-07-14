import { execFileSync } from 'node:child_process';
import { readActiveTaskDirectionLocks } from './task-direction.js';
import { isPathAllowedByScope } from './work-channels.js';
export const ATM_INDEX_FOREIGN_ACTIVE_STAGED = 'ATM_INDEX_FOREIGN_ACTIVE_STAGED';
export function inspectGitIndexOwnership(input) {
    const currentTaskId = normalizeTaskId(input.taskId ?? null);
    const stagedFiles = uniqueSorted(input.stagedFiles ?? readStagedFiles(input.cwd));
    const stagedBlobs = readStagedBlobMap(input.cwd, stagedFiles);
    const activeLocks = readActiveTaskDirectionLocks(input.cwd);
    const entries = stagedFiles.map((filePath) => {
        const governanceTaskId = extractGovernanceTaskId(filePath);
        const lockOwner = activeLocks.find((lock) => isPathAllowedByScope(filePath, lock.allowedFiles)) ?? null;
        const ownerTaskId = governanceTaskId ?? lockOwner?.taskId ?? null;
        const ownerActorId = lockOwner?.actorId ?? null;
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
function buildIndexLane(currentTaskId, entries, foreignActiveStaged) {
    if (entries.length === 0) {
        return {
            schemaId: 'atm.gitIndexLane.v1',
            status: 'free',
            ownerTaskId: null,
            ownerActorId: null,
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
            reason: `The shared Git index currently belongs to ${currentTaskId ?? 'the current task'}.`
        };
    }
    if (entries.some((entry) => entry.ownership === 'unknown-governance-artifact')) {
        return {
            schemaId: 'atm.gitIndexLane.v1',
            status: 'requires-staging-steward',
            ownerTaskId: null,
            ownerActorId: null,
            reason: 'The shared Git index contains governance artifacts whose owner cannot be resolved.'
        };
    }
    return {
        schemaId: 'atm.gitIndexLane.v1',
        status: 'queued',
        ownerTaskId: null,
        ownerActorId: null,
        reason: 'The shared Git index contains staged files but no current-task ownership proof.'
    };
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
