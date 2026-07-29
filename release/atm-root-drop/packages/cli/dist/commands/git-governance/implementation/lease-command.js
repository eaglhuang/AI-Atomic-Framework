import { mkdirSync, writeFileSync, } from "node:fs";
import path from "node:path";
import { inspectGitIndexOwnership, } from "../../git-index-ownership.js";
import { uniqueSorted, } from "../commit-scope-policy.js";
import { CliError, makeResult, message, } from "../../shared.js";
import { shortHash } from './admission-command.js';
export function runGitLease(options) {
    if (!options.actorId?.trim()) {
        throw new CliError("ATM_ACTOR_ID_MISSING", "git lease requires --actor.", {
            exitCode: 2,
        });
    }
    if (!options.taskId?.trim()) {
        throw new CliError("ATM_TASK_ID_MISSING", "git lease requires --task.", {
            exitCode: 2,
        });
    }
    if (!options.leaseKind) {
        throw new CliError("ATM_CLI_USAGE", "git lease requires stage-override or destructive-override.", { exitCode: 2 });
    }
    if (options.paths.length === 0) {
        throw new CliError("ATM_CLI_USAGE", "git lease requires --paths.", {
            exitCode: 2,
        });
    }
    if (!options.overrideReason?.trim()) {
        throw new CliError("ATM_CLI_USAGE", "git lease requires --reason with the human-approved safety rationale.", { exitCode: 2 });
    }
    const phrase = options.leaseKind === "stage-override"
        ? "ATM-STAGE-OVERRIDE-I-UNDERSTAND-THIS-MAY-DISRUPT-ANOTHER-ACTIVE-AGENT"
        : "ATM-DESTRUCTIVE-GIT-OVERRIDE-I-UNDERSTAND-THIS-CAN-DESTROY-ANOTHER-ACTIVE-AGENT-WORK";
    const ttlSeconds = Math.max(1, Math.floor(options.ttlSeconds ?? 900));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    const leaseId = `git-${options.leaseKind}-${shortHash([options.actorId, options.taskId, options.paths.join("\n"), now.toISOString()].join("\n"))}`;
    const leasePath = `.atm/runtime/git-index-leases/${leaseId}.json`;
    const requestedPaths = uniqueSorted(options.paths);
    const ownership = inspectGitIndexOwnership({
        cwd: options.cwd,
        taskId: options.taskId,
    });
    const stagedEntries = ownership.foreignActiveStaged.map((entry) => ({
        path: entry.path,
        stagedBlobId: entry.stagedBlobId,
        stagedMode: entry.stagedMode,
    }));
    if (options.leaseKind === "stage-override" &&
        (stagedEntries.length === 0 ||
            stagedEntries.some((entry) => !entry.stagedBlobId || !entry.stagedMode) ||
            JSON.stringify(uniqueSorted(stagedEntries.map((entry) => entry.path))) !==
                JSON.stringify(requestedPaths))) {
        throw new CliError("ATM_GIT_INDEX_OVERRIDE_LEASE_INDEX_DRIFT", "Stage override lease paths must exactly match the current foreign-active staged index entries.", {
            exitCode: 1,
            details: {
                requestedPaths,
                foreignActiveStaged: ownership.foreignActiveStaged,
            },
        });
    }
    const lease = {
        schemaId: "atm.gitIndexOverrideLease.v1",
        leaseId,
        kind: options.leaseKind,
        permission: options.leaseKind === "stage-override"
            ? "git.index.stageOverride"
            : "git.index.destructiveOverride",
        actorId: options.actorId,
        taskId: options.taskId.toUpperCase(),
        paths: requestedPaths,
        stagedEntries: options.leaseKind === "stage-override"
            ? stagedEntries.map((entry) => ({
                path: entry.path,
                stagedBlobId: entry.stagedBlobId,
                stagedMode: entry.stagedMode,
            }))
            : [],
        phrase,
        chatTextAccepted: false,
        ttlSeconds,
        singleUse: true,
        used: false,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        reason: options.overrideReason,
        auditRequirement: options.leaseKind === "stage-override"
            ? "Write stage override audit before mutating any foreign-active staged entry."
            : "Write destructive override audit before worktree/index mutation; include before/after status, index hash, blob IDs, rollback result, and human reason.",
    };
    mkdirSync(path.dirname(path.join(options.cwd, leasePath)), {
        recursive: true,
    });
    writeFileSync(path.join(options.cwd, leasePath), `${JSON.stringify(lease, null, 2)}\n`, "utf8");
    return makeResult({
        ok: true,
        command: "git",
        cwd: options.cwd,
        messages: [
            message("info", "ATM_GIT_INDEX_OVERRIDE_LEASE_CREATED", `Created ${options.leaseKind} Git index override lease.`, {
                leaseId,
                leasePath,
                expiresAt: lease.expiresAt,
                chatTextAccepted: false,
            }),
        ],
        evidence: { action: "lease", lease, leasePath },
    });
}
