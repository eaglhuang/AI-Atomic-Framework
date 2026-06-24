import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { quoteCliValue, relativePathFrom } from '../shared.js';
function readTaskflowHeadBranchRef(cwd) {
    try {
        const value = execFileSync('git', ['symbolic-ref', '-q', 'HEAD'], {
            cwd,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        return value || null;
    }
    catch {
        return null;
    }
}
function taskflowBranchCommitQueueLockPath(cwd, branchRef) {
    const rawName = branchRef && branchRef.trim().length > 0 ? branchRef : 'detached-head';
    const safeName = rawName.replace(/[^A-Za-z0-9._-]+/g, '-');
    return path.join(cwd, '.atm', 'runtime', 'locks', `git-commit-queue-${safeName}.lock`);
}
export function evaluateTaskflowBranchCommitQueueGate(input) {
    const branchRef = readTaskflowHeadBranchRef(input.cwd);
    const branchName = branchRef ? branchRef.replace(/^refs\/heads\//, '') : 'detached-head';
    const lockPath = taskflowBranchCommitQueueLockPath(input.cwd, branchRef);
    const recordPath = path.join(lockPath, 'record.json');
    if (!existsSync(recordPath)) {
        return {
            schemaId: 'atm.taskflowBranchCommitQueueGate.v1',
            status: 'clear',
            branchRef,
            branchName,
            lockPath: null,
            actorId: null,
            summary: 'No active branch commit queue lock blocks this close.',
            requiredCommand: null
        };
    }
    try {
        const record = JSON.parse(readFileSync(recordPath, 'utf8'));
        const queueActorId = typeof record.actorId === 'string' ? record.actorId : null;
        if (queueActorId && queueActorId === input.actorId) {
            return {
                schemaId: 'atm.taskflowBranchCommitQueueGate.v1',
                status: 'clear',
                branchRef,
                branchName,
                lockPath: relativePathFrom(input.cwd, lockPath),
                actorId: queueActorId,
                summary: 'Branch commit queue lock is already owned by this actor.',
                requiredCommand: null
            };
        }
        return {
            schemaId: 'atm.taskflowBranchCommitQueueGate.v1',
            status: 'busy',
            branchRef,
            branchName,
            lockPath: relativePathFrom(input.cwd, lockPath),
            actorId: queueActorId,
            summary: queueActorId
                ? `Another governed writer (${queueActorId}) is finalizing branch ${branchName}. Wait for the branch commit queue to clear before taskflow close --write.`
                : `Another governed writer is finalizing branch ${branchName}. Wait for the branch commit queue to clear before taskflow close --write.`,
            requiredCommand: `node atm.mjs taskflow close --task ${input.taskId} --actor ${quoteCliValue(input.actorId)} --write --json`
        };
    }
    catch {
        return {
            schemaId: 'atm.taskflowBranchCommitQueueGate.v1',
            status: 'busy',
            branchRef,
            branchName,
            lockPath: relativePathFrom(input.cwd, lockPath),
            actorId: null,
            summary: `Branch commit queue lock for ${branchName} exists but could not be parsed. Clear or wait for the active governed writer before taskflow close --write.`,
            requiredCommand: `node atm.mjs taskflow close --task ${input.taskId} --actor ${quoteCliValue(input.actorId)} --write --json`
        };
    }
}
