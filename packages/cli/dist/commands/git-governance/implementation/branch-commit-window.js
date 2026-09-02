import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, } from "node:fs";
import path from "node:path";
import { CliError, relativePathFrom, } from "../../shared.js";
import { readHeadBranchRef, readHeadCommitSha } from './push-command.js';
export const branchCommitQueueLockTimeoutMs = 15_000;
export const branchCommitQueueLockRetryMs = 200;
export const branchCommitQueueStaleSelfHealMs = 5 * 60 * 1000;
export function resolveBranchCommitQueueLockTimeoutMs(timeoutMs) {
    if (typeof timeoutMs === "number" &&
        Number.isFinite(timeoutMs) &&
        timeoutMs > 0) {
        return Math.min(branchCommitQueueLockTimeoutMs, timeoutMs);
    }
    return branchCommitQueueLockTimeoutMs;
}
export function branchCommitQueueLockPath(cwd, branchRef) {
    const rawName = branchRef && branchRef.trim().length > 0 ? branchRef : "detached-head";
    const safeName = rawName.replace(/[^A-Za-z0-9._-]+/g, "-");
    return path.join(cwd, ".atm", "runtime", "locks", `git-commit-queue-${safeName}.lock`);
}
export function inspectCurrentBranchCommitQueueStatus(cwd) {
    const branchRef = readHeadBranchRef(cwd) ?? "detached-head";
    const branchName = branchRef.replace(/^refs\/heads\//, "") || "detached-head";
    const lockPath = branchCommitQueueLockPath(cwd, branchRef);
    const lockPathRelative = relativePathFrom(cwd, lockPath);
    const currentHeadSha = readHeadCommitSha(cwd);
    if (!existsSync(lockPath)) {
        return {
            schemaId: "atm.gitCommitBranchQueueStatus.v1",
            status: "free",
            branchRef,
            branchName,
            lockPath: lockPathRelative,
            lockRecord: null,
            ownerAlive: null,
            ageMs: null,
            currentHeadSha,
            headMovedSinceAcquire: null,
            recommendedAction: "No branch commit queue lock is present; it is safe to start a new governed commit if the worktree is otherwise ready.",
        };
    }
    const record = readBranchCommitQueueLockRecord(lockPath);
    const createdMs = record?.createdAt ? Date.parse(record.createdAt) : NaN;
    const ageMs = Number.isFinite(createdMs)
        ? Math.max(0, Date.now() - createdMs)
        : null;
    const ownerAlive = record
        ? isBranchCommitQueueOwnerAlive(record.ownerPid)
        : null;
    const headMovedSinceAcquire = Boolean(record?.headShaAtAcquire &&
        currentHeadSha &&
        record.headShaAtAcquire !== currentHeadSha);
    const status = ownerAlive === true ? "busy" : "stale-or-dead";
    return {
        schemaId: "atm.gitCommitBranchQueueStatus.v1",
        status,
        branchRef,
        branchName,
        lockPath: lockPathRelative,
        lockRecord: record,
        ownerAlive,
        ageMs,
        currentHeadSha,
        headMovedSinceAcquire,
        recommendedAction: status === "busy"
            ? `A governed commit is still active on ${branchName}; wait for owner PID ${record?.ownerPid ?? "unknown"} to finish, then rerun git commit-status before retrying.`
            : `A branch commit queue lock exists for ${branchName}, but its owner is not known to be alive. Do not blindly retry; inspect ${lockPathRelative}, current HEAD, and recent git commit-status output before cleaning the stale lock.`,
    };
}
export function isBranchCommitQueueOwnerAlive(ownerPid) {
    if (typeof ownerPid !== "number" ||
        !Number.isInteger(ownerPid) ||
        ownerPid <= 0) {
        return null;
    }
    try {
        process.kill(ownerPid, 0);
        return true;
    }
    catch (error) {
        const code = error && typeof error === "object" && "code" in error
            ? String(error.code ?? "")
            : "";
        if (code === "ESRCH") {
            return false;
        }
        return true;
    }
}
export function readBranchCommitQueueLockRecord(lockPath) {
    try {
        const raw = JSON.parse(readFileSync(path.join(lockPath, "record.json"), "utf8"));
        if (raw.schemaId !== "atm.branchCommitQueueLock.v1") {
            return null;
        }
        return {
            schemaId: "atm.branchCommitQueueLock.v1",
            specVersion: raw.specVersion === "0.1.0" ? "0.1.0" : "0.1.0",
            actorId: typeof raw.actorId === "string" ? raw.actorId : "",
            taskId: typeof raw.taskId === "string" ? raw.taskId : null,
            sessionId: typeof raw.sessionId === "string" ? raw.sessionId : null,
            branchRef: typeof raw.branchRef === "string" ? raw.branchRef : "detached-head",
            branchName: typeof raw.branchName === "string" ? raw.branchName : "detached-head",
            headShaAtAcquire: typeof raw.headShaAtAcquire === "string" ? raw.headShaAtAcquire : null,
            ownerPid: typeof raw.ownerPid === "number" ? raw.ownerPid : undefined,
            createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
        };
    }
    catch {
        return null;
    }
}
export function recordBranchCommitQueueStaleCleanup(input) {
    const auditPath = path.join(input.cwd, ".atm", "runtime", "locks", "branch-commit-queue-stale-cleanup.jsonl");
    mkdirSync(path.dirname(auditPath), { recursive: true });
    appendFileSync(auditPath, `${JSON.stringify({ schemaId: "atm.branchCommitQueueStaleCleanup.v1", cleanedAt: new Date().toISOString(), actorId: input.actorId, lockPath: relativePathFrom(input.cwd, input.lockPath), lockRecord: input.record, currentHeadSha: input.currentHeadSha, ownerAlive: input.ownerAlive, ageMs: input.ageMs, reason: input.reason })}\n`, "utf8");
}
export function maybeCleanupStaleBranchCommitQueueLock(input) {
    const record = readBranchCommitQueueLockRecord(input.lockPath);
    if (!record) {
        return false;
    }
    const createdMs = Date.parse(record.createdAt);
    const ageMs = Number.isFinite(createdMs)
        ? Date.now() - createdMs
        : Number.POSITIVE_INFINITY;
    const ownerAlive = isBranchCommitQueueOwnerAlive(record.ownerPid);
    const staleEnough = ageMs >= branchCommitQueueStaleSelfHealMs;
    const ownerGoneOrLegacy = ownerAlive === false || ownerAlive === null;
    if (!staleEnough || !ownerGoneOrLegacy) {
        return false;
    }
    recordBranchCommitQueueStaleCleanup({
        cwd: input.cwd,
        lockPath: input.lockPath,
        record,
        actorId: input.actorId,
        currentHeadSha: input.currentHeadSha,
        ownerAlive,
        ageMs,
        reason: "ATM_BRANCH_COMMIT_QUEUE_STALE_SELF_HEALED",
    });
    rmSync(input.lockPath, { recursive: true, force: true });
    return true;
}
export function withBranchCommitQueueLock(input, operation) {
    const lockPath = branchCommitQueueLockPath(input.cwd, input.branchRef);
    mkdirSync(path.dirname(lockPath), { recursive: true });
    const startedAt = Date.now();
    const timeoutMs = resolveBranchCommitQueueLockTimeoutMs(input.timeoutMs);
    while (true) {
        try {
            mkdirSync(lockPath, { recursive: false });
            const record = {
                schemaId: "atm.branchCommitQueueLock.v1",
                specVersion: "0.1.0",
                actorId: input.actorId,
                taskId: input.taskId,
                sessionId: input.sessionId ?? null,
                branchRef: input.branchRef ?? "detached-head",
                branchName: input.branchName,
                headShaAtAcquire: input.headShaAtAcquire,
                ownerPid: process.pid,
                createdAt: new Date().toISOString(),
            };
            writeFileSync(path.join(lockPath, "record.json"), `${JSON.stringify(record, null, 2)}\n`, "utf8");
            break;
        }
        catch (error) {
            const code = error && typeof error === "object" && "code" in error
                ? String(error.code ?? "")
                : "";
            if (code !== "EEXIST" && code !== "EACCES") {
                throw error;
            }
            const headShaCurrent = readHeadCommitSha(input.cwd);
            if (maybeCleanupStaleBranchCommitQueueLock({
                cwd: input.cwd,
                lockPath,
                actorId: input.actorId,
                currentHeadSha: headShaCurrent,
            })) {
                continue;
            }
            const elapsedMs = Date.now() - startedAt;
            if (elapsedMs >= timeoutMs) {
                throw new CliError("ATM_GIT_COMMIT_BRANCH_QUEUE_BUSY", `Another ATM commit is already finalizing ${input.branchName}; retry after the active writer finishes.`, {
                    exitCode: 1,
                    details: {
                        actorId: input.actorId,
                        taskId: input.taskId,
                        branchRef: input.branchRef,
                        branchName: input.branchName,
                        headShaAtAcquire: input.headShaAtAcquire,
                        headShaCurrent,
                        lockPath: relativePathFrom(input.cwd, lockPath),
                        queueLockTimeoutMs: timeoutMs,
                        retryable: true,
                        requiredCommand: "Retry the same node atm.mjs git commit command after the active writer releases the branch queue lock.",
                    },
                });
            }
            sleepMs(Math.min(branchCommitQueueLockRetryMs, timeoutMs - elapsedMs));
        }
    }
    try {
        return operation();
    }
    finally {
        rmSync(lockPath, { recursive: true, force: true });
    }
}
export function sleepMs(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
