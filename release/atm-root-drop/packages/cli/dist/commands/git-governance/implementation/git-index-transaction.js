import { createSanitizedGitEnv, resolveGitExecutable, runGitCommand, runGitCommandWithEnv, } from './git-process-port.js';
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, } from "node:fs";
import path from "node:path";
import { findCloseCommitWindowCoveringPaths, readActiveCloseCommitWindows, } from "../../framework-development.js";
import { extractGovernanceTaskIdFromPath, isProtectedStagedGovernanceOwnershipPath, normalizeRelativePath, pathMatchesTaskScope, uniqueSorted, } from "../commit-scope-policy.js";
import { isFileAllowedInTaskBundle as isTaskBundleAllowedByPolicy, } from "../commit-bundle-filter.js";
import { isDeferrableForeignGovernanceResidue, } from "../governance-residue-policy.js";
import { quoteCliValue, } from "../../shared.js";
import { ensureGovernedGitHeadEvidenceStagedForTaskScopedCommit } from './git-head-evidence-transaction.js';
import { parseTaskClaim, readTaskDocument } from './identity-check-command.js';
import { isIgnorableCommitStagingSideEffect, isTaskOwnedProtectedOverrideAuditPath } from './task-scope-staging.js';
import { runWithSealedTaskScopedCommitIndex } from './sealed-commit-attribution.js';
import { recordLiveIndexReconciliation } from './live-index-reconciliation.js';
export function inspectCloseCommitWindowStagedArtifacts(cwd, taskId) {
    const stagedFiles = readStagedFiles(cwd);
    if (stagedFiles.length === 0) {
        return { ok: false, taskId, stagedFiles, reason: "no-staged-files" };
    }
    const activeTaskWindow = readActiveCloseCommitWindows(cwd).find((entry) => entry.taskId === taskId) ?? null;
    if (activeTaskWindow &&
        stagedFiles.every((filePath) => isAllowedGovernanceArtifactPath(cwd, filePath, taskId))) {
        return {
            ok: true,
            taskId,
            stagedFiles,
            reason: "active-close-commit-window-governance-bundle",
        };
    }
    const windowRecord = findCloseCommitWindowCoveringPaths(cwd, stagedFiles);
    if (!windowRecord) {
        return { ok: false, taskId, stagedFiles, reason: "no-covering-window" };
    }
    if (windowRecord.taskId !== taskId) {
        return {
            ok: false,
            taskId,
            stagedFiles,
            reason: `window-task-mismatch:${windowRecord.taskId}`,
        };
    }
    return { ok: true, taskId, stagedFiles, reason: null };
}
export function readStagedJsonFile(cwd, relativeFile) {
    try {
        const content = execFileSync("git", ["show", `:${normalizeRelativePath(relativeFile)}`], {
            cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            env: createSanitizedGitEnv(),
        });
        const parsed = JSON.parse(content);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : null;
    }
    catch {
        return null;
    }
}
export function readStagedFiles(cwd) {
    try {
        return runGitCommand(cwd, [
            "diff",
            "--cached",
            "--name-only",
            "--diff-filter=ACMRT",
        ])
            .split(/\r?\n/)
            .map(normalizeRelativePath)
            .filter(Boolean)
            .sort((left, right) => left.localeCompare(right));
    }
    catch {
        return [];
    }
}
/**
 * Read tracked worktree changes independently of staged state. A path may be
 * both staged and unstaged (`MM`); callers that implement auto-stage must keep
 * that path in the worktree overlay instead of treating the staged entry as
 * authoritative.
 */
export function readUnstagedFiles(cwd) {
    try {
        return runGitCommand(cwd, ["diff", "--name-only", "--diff-filter=ACMRTD"])
            .split(/\r?\n/)
            .map(normalizeRelativePath)
            .filter(Boolean)
            .sort((left, right) => left.localeCompare(right));
    }
    catch {
        return [];
    }
}
export function rollbackNewlyStagedLiveIndexResidue(cwd, stagedBeforeAttempt) {
    const beforeSet = new Set(stagedBeforeAttempt);
    const stagedAfterAttempt = readStagedFiles(cwd);
    const newlyStaged = stagedAfterAttempt.filter((file) => !beforeSet.has(file));
    if (newlyStaged.length === 0) {
        return [];
    }
    try {
        runGitCommand(cwd, ["restore", "--staged", "--", ...newlyStaged], ["ignore", "pipe", "pipe"]);
    }
    catch { }
    return newlyStaged;
}
export function readStagedDiffNames(cwd, diffFilter) {
    try {
        return runGitCommand(cwd, [
            "diff",
            "--cached",
            "--name-only",
            `--diff-filter=${diffFilter}`,
        ])
            .split(/\r?\n/)
            .map(normalizeRelativePath)
            .filter(Boolean);
    }
    catch {
        return [];
    }
}
export function isAllowedGovernanceArtifactPath(cwd, filePath, taskId) {
    const normalized = normalizeRelativePath(filePath);
    const normalizedTaskId = taskId.toLowerCase();
    const lower = normalized.toLowerCase();
    if (lower === `.atm/history/tasks/${normalizedTaskId}.json`)
        return true;
    if (lower === `.atm/history/evidence/${normalizedTaskId}.json`)
        return true;
    if (lower === `.atm/history/evidence/${normalizedTaskId}.bundle-manifest.json`)
        return true;
    if (lower === `.atm/history/evidence/${normalizedTaskId}.closure-packet.json`)
        return true;
    if (lower.startsWith(`.atm/history/task-events/${normalizedTaskId}/`) &&
        lower.endsWith(".json"))
        return true;
    if (isTaskOwnedProtectedOverrideAuditPath(cwd, normalized, normalizedTaskId))
        return true;
    return isIgnorableCommitStagingSideEffect(cwd, normalized, taskId);
}
export function isFileAllowedInTaskBundle(cwd, filePath, taskId, declaredScope) {
    return isTaskBundleAllowedByPolicy({
        filePath,
        declaredScope,
        allowedGovernanceArtifact: isAllowedGovernanceArtifactPath(cwd, filePath, taskId),
    });
}
export function buildHostGitCompatibilityGuidance(input) {
    const lines = [
        `ATM shells out to host git (${input.gitExecutable}) with author/committer env vars and ATM_COMMIT_* attribution; do not rely on IDE-injected git flags.`,
        'Prefer `node atm.mjs git commit --actor <id> --task <task> --message "<summary>" --json` so trailers and claim binding stay governed.',
        `If the wrapper cannot complete, inspect copyableCommitCommand only when hooks can still pass: ${input.copyableCommitCommand}`,
    ];
    const combined = `${input.stderr}\n${input.stdout}`.toLowerCase();
    if (combined.includes("trailer") &&
        (combined.includes("unknown option") || combined.includes("unrecognized"))) {
        lines.push("Host git rejected trailer flags injected by the editor shell; rerun through node atm.mjs git commit instead of a wrapped git commit command.");
    }
    if (combined.includes("cannot lock ref") && combined.includes("head")) {
        lines.push("Another writer advanced HEAD; retry the same node atm.mjs git commit command after the branch queue clears.");
    }
    return lines.join(" ");
}
export function buildCopyableGitCommitCommand(input) {
    const cwdFlag = path.resolve(input.cwd) === path.resolve(process.cwd())
        ? ""
        : ` -C ${quoteCliValue(input.cwd)}`;
    const gitExecutable = quoteCliValue(resolveGitExecutable());
    const body = [input.message, ...input.trailers].join("\n\n");
    return `${gitExecutable}${cwdFlag} commit${input.noVerify ? " --no-verify" : ""} -m ${quoteCliValue(input.message)} -m ${quoteCliValue(body)}`;
}
export function buildUnexpectedStagedTasksForGitCommit(cwd, taskId, declaredScope, stagedFiles) {
    const grouped = new Map();
    for (const filePath of stagedFiles) {
        if (isFileAllowedInTaskBundle(cwd, filePath, taskId, declaredScope))
            continue;
        const foreignTaskId = extractGovernanceTaskIdFromPath(filePath) ??
            inferActiveTaskOwnerForPath(cwd, filePath);
        if (!foreignTaskId || foreignTaskId === taskId.toUpperCase())
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
            deferCommand: `node atm.mjs git lease stage-override --task ${quoteCliValue(taskId)} --actor <actor-id> --paths ${uniqueFiles.map(quoteCliValue).join(",")} --reason "<human-approved reason>" --json`,
        };
    });
}
export function inferActiveTaskOwnerForPath(cwd, filePath) {
    const protectedOverrideAuditTaskId = readProtectedOverrideAuditTaskId(cwd, filePath);
    if (protectedOverrideAuditTaskId)
        return protectedOverrideAuditTaskId;
    const taskDirectory = path.join(cwd, ".atm", "history", "tasks");
    if (!existsSync(taskDirectory))
        return null;
    const normalizedFile = normalizeRelativePath(filePath);
    if (!normalizedFile)
        return null;
    const owners = readdirSync(taskDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .flatMap((entry) => {
        try {
            const task = JSON.parse(readFileSync(path.join(taskDirectory, entry.name), "utf8"));
            const taskId = String(task.workItemId ?? task.taskId ?? "")
                .trim()
                .toUpperCase();
            const status = String(task.status ?? "")
                .trim()
                .toLowerCase();
            const scopes = Array.isArray(task.scopePaths)
                ? task.scopePaths.map((value) => String(value).trim()).filter(Boolean)
                : [];
            const claim = task.claim &&
                typeof task.claim === "object" &&
                !Array.isArray(task.claim)
                ? task.claim
                : null;
            const claimFiles = Array.isArray(claim?.files)
                ? claim.files.map((value) => String(value).trim()).filter(Boolean)
                : [];
            const ownsPath = [...scopes, ...claimFiles].some((scope) => pathMatchesTaskScope(normalizedFile, scope));
            return taskId &&
                (status === "running" || status === "active") &&
                ownsPath
                ? [taskId]
                : [];
        }
        catch {
            return [];
        }
    });
    return owners.length === 1 ? owners[0] : null;
}
export function readProtectedOverrideAuditTaskId(cwd, filePath) {
    const normalized = normalizeRelativePath(filePath);
    const lower = normalized.toLowerCase();
    if (!lower.startsWith(".atm/history/protected-override-audit/") ||
        !lower.endsWith(".json")) {
        return null;
    }
    try {
        const parsed = JSON.parse(readFileSync(path.join(cwd, normalized), "utf8"));
        const taskId = typeof parsed.taskId === "string"
            ? parsed.taskId.trim().toUpperCase()
            : "";
        return taskId || null;
    }
    catch {
        return null;
    }
}
export function listExistingGovernanceFilesRecursively(root, relativeDirectory) {
    const directory = path.join(root, relativeDirectory);
    if (!existsSync(directory))
        return [];
    const files = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const relativePath = path.posix.join(relativeDirectory.replace(/\\/g, "/"), entry.name);
        if (entry.isDirectory()) {
            files.push(...listExistingGovernanceFilesRecursively(root, relativePath));
        }
        else if (entry.isFile()) {
            files.push(normalizeRelativePath(relativePath));
        }
    }
    return files;
}
export function listTaskOwnedProtectedOverrideAuditFiles(cwd, taskId) {
    return listExistingGovernanceFilesRecursively(cwd, ".atm/history/protected-override-audit").filter((relativePath) => readProtectedOverrideAuditTaskId(cwd, relativePath)?.toLowerCase() ===
        taskId.toLowerCase());
}
export function buildProtectedForeignStagedOwnershipFiles(unexpectedStagedTasks) {
    return uniqueSorted(unexpectedStagedTasks.flatMap((entry) => entry.stagedFiles.filter((filePath) => isProtectedStagedGovernanceOwnershipPath(filePath))));
}
export function isActiveForeignGovernanceResidueOwner(cwd, taskId, finding) {
    const ownerTaskId = finding.ownerTaskId?.trim().toUpperCase() ?? null;
    if (!ownerTaskId || ownerTaskId === taskId.trim().toUpperCase())
        return false;
    if (!isDeferrableForeignGovernanceResidue(taskId, finding))
        return false;
    try {
        const taskDocument = readTaskDocument(cwd, ownerTaskId);
        const claim = parseTaskClaim(taskDocument?.claim);
        if (claim?.state === "active")
            return true;
        const taskDirectionLock = taskDocument?.taskDirectionLock &&
            typeof taskDocument.taskDirectionLock === "object" &&
            !Array.isArray(taskDocument.taskDirectionLock)
            ? taskDocument.taskDirectionLock
            : null;
        return (String(taskDirectionLock?.status ?? "")
            .trim()
            .toLowerCase() === "active");
    }
    catch {
        return false;
    }
}
export function deferForeignStagedFiles(cwd, taskId, unexpectedStagedTasks) {
    const files = uniqueSorted(unexpectedStagedTasks.flatMap((entry) => entry.stagedFiles));
    return deferStagedFilePaths(cwd, taskId, files);
}
export function deferStagedFilePaths(cwd, taskId, filesInput) {
    const files = uniqueSorted(filesInput.map(normalizeRelativePath).filter(Boolean));
    if (files.length === 0)
        return null;
    const entries = runGitCommand(cwd, ["ls-files", "-s", "--", ...files])
        .split(/\r?\n/)
        .map((line) => line.match(/^(\d+) ([0-9a-f]+) \d+\t(.+)$/i))
        .filter((match) => match !== null)
        .map(([, mode, blobId, filePath]) => ({
        path: normalizeRelativePath(filePath),
        mode,
        blobId,
    }));
    if (entries.length !== files.length) {
        throw new Error(`Cannot defer foreign staged files without a complete index snapshot: expected ${files.length} entries, captured ${entries.length}.`);
    }
    const snapshotPath = `.atm/runtime/snapshots/foreign-staged-${taskId}-${Date.now()}.json`;
    mkdirSync(path.dirname(path.join(cwd, snapshotPath)), { recursive: true });
    writeFileSync(path.join(cwd, snapshotPath), `${JSON.stringify({ schemaId: "atm.foreignStagedSnapshot.v1", taskId, createdAt: new Date().toISOString(), files, entries }, null, 2)}\n`, "utf8");
    runGitCommand(cwd, ["restore", "--staged", "--", ...files], ["ignore", "pipe", "pipe"]);
    return snapshotPath;
}
export function cleanupDeferredForeignStagedSnapshot(cwd, snapshotPath) {
    if (!snapshotPath)
        return [];
    const absolutePath = path.join(cwd, snapshotPath);
    if (!existsSync(absolutePath))
        return [];
    const snapshot = JSON.parse(readFileSync(absolutePath, "utf8"));
    const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
    for (const entry of entries) {
        const filePath = normalizeRelativePath(entry?.path);
        const mode = String(entry?.mode ?? "");
        const blobId = String(entry?.blobId ?? "");
        if (!filePath || !/^\d+$/.test(mode) || !/^[0-9a-f]+$/i.test(blobId)) {
            throw new Error(`Invalid deferred foreign staged snapshot entry in ${snapshotPath}.`);
        }
        runGitCommand(cwd, ["update-index", "--add", "--cacheinfo", `${mode},${blobId},${filePath}`], ["ignore", "pipe", "pipe"]);
        const restoredEntry = runGitCommand(cwd, ["ls-files", "-s", "--", filePath]);
        if (!restoredEntry.includes(`${mode} ${blobId} 0\t${filePath}`)) {
            throw new Error(`Deferred foreign staged entry was not restored: ${filePath}.`);
        }
    }
    rmSync(absolutePath, { force: true });
    return entries.map((entry) => normalizeRelativePath(entry.path));
}
export function recordGitIndexRestoreFailure(cwd, input) {
    const relativePath = `.atm/history/evidence/${input.taskId}.index-restore-failure.json`;
    const absolutePath = path.join(cwd, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, `${JSON.stringify({
        schemaId: "atm.gitIndexRestoreFailure.v1",
        taskId: input.taskId,
        leaseId: input.leaseId,
        entries: input.entries,
        commitError: input.commitError instanceof Error ? input.commitError.message : String(input.commitError),
        restoreError: input.restoreError instanceof Error ? input.restoreError.message : String(input.restoreError),
        createdAt: new Date().toISOString(),
    }, null, 2)}\n`, "utf8");
    return relativePath;
}
/**
 * The candidate index is assembled from a sealed bundle and asserted against it
 * before `run` may create a commit. An empty bundle is not a licence to commit
 * the live shared index, and neither is an absent one: the caller passes the
 * seal source it decided on, and an unnamed source fails closed.
 *
 * The commit result is returned alongside the live-index reconciliation rather
 * than in place of it. Reconciliation is the postcondition that decides whether
 * the shared index is actually clean afterwards, so a caller that only ever
 * sees the commit result cannot tell a clean index from one holding retained
 * paths it does not own.
 */
export function withTaskScopedCommitIndex(cwd, files, actorId, taskId, run, sealSource) {
    const normalizedFiles = uniqueSorted(files.map(normalizeRelativePath).filter(Boolean));
    const outcome = runWithSealedTaskScopedCommitIndex({
        cwd,
        paths: normalizedFiles,
        provenance: "task-scope",
        actorId: actorId ?? null,
        surface: "git commit --task-scoped",
        sealSource,
        stageGovernanceEvidence: (env) => {
            if (!actorId)
                return [];
            const staged = ensureGovernedGitHeadEvidenceStagedForTaskScopedCommit(cwd, actorId, taskId, normalizedFiles, env);
            return staged?.evidencePath ? [staged.evidencePath] : [];
        },
        run,
    });
    const liveIndexReconciliation = outcome.liveIndexReconciliation;
    return {
        result: outcome.result,
        liveIndexReconciliation,
        liveIndexReconciliationRecordPath: recordLiveIndexReconciliation(cwd, taskId, liveIndexReconciliation),
    };
}
export function stageTaskScopedBundleFiles(cwd, files, env) {
    const normalizedFiles = uniqueSorted(files.map(normalizeRelativePath).filter(Boolean));
    if (normalizedFiles.length === 0) {
        return;
    }
    runGitCommandWithEnv(cwd, ["add", "-A", "-f", "--", ...normalizedFiles], env ?? process.env, ["ignore", "pipe", "pipe"]);
}
