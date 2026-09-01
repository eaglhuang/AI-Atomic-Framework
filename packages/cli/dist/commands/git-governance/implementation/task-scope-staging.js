import { isAllowedGovernanceArtifactPath, isExplicitTerminalHistoryCleanupArtifact, isFileAllowedInTaskBundle, listTaskOwnedProtectedOverrideAuditFiles, readProtectedOverrideAuditTaskId, readStagedFiles, readStagedJsonFile, } from './git-index-transaction.js';
import { isCommitAttributionSideEffectPath, isIgnorableTaskScopedDirtySideEffect, listCommitAttributionSideEffectPaths, resolveGitExecutable, runGitCommand, } from './git-process-port.js';
import { forEachPathspecBatch } from './pathspec-argv-batching.js';
import { resolveTaskHistoryOwnerTaskId } from '../../../_vendor/core/dist/broker/cross-task-mutation-guard.js';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, } from "node:fs";
import path from "node:path";
import { gitHeadEvidencePaths, } from "../../git-head-evidence.js";
import { getCanonicalAllowedFilesForTask, sanitizeTaskDirectionAllowedFiles, } from "../../task-direction.js";
import { extractTaskDeclaredFiles } from "../../tasks/task-import-validators.js";
import { extractGovernanceTaskIdFromPath, normalizeRelativePath, pathMatchesTaskScope, uniqueSorted, } from "../commit-scope-policy.js";
import { quoteCliValue, } from "../../shared.js";
import { parseTaskClaim } from './identity-check-command.js';
export function inspectTaskScopedStagedGovernanceBundle(cwd, taskId, taskDocument) {
    const stagedFiles = readStagedFiles(cwd);
    const claim = parseTaskClaim(taskDocument.claim);
    const declaredScope = resolveTaskDeclaredScope(cwd, taskId, taskDocument);
    const warnings = [];
    const mismatchedTaskIds = [];
    if (claim?.state === "active") {
        for (const filePath of stagedFiles) {
            if (isIgnorableCommitStagingSideEffect(cwd, filePath, taskId))
                continue;
            if (isExplicitTerminalHistoryCleanupArtifact(cwd, filePath, taskId, declaredScope, taskDocument))
                continue;
            if (!isAllowedGovernanceArtifactPath(cwd, filePath, taskId))
                continue;
            const stagedTaskId = extractGovernanceTaskIdFromPath(filePath);
            if (stagedTaskId && stagedTaskId !== taskId.toUpperCase()) {
                mismatchedTaskIds.push(filePath);
            }
            const json = readStagedJsonFile(cwd, filePath);
            if (json && typeof json.taskId === "string" && json.taskId !== taskId) {
                mismatchedTaskIds.push(filePath);
            }
            if (json &&
                typeof json.workItemId === "string" &&
                json.workItemId !== taskId) {
                mismatchedTaskIds.push(filePath);
            }
        }
        const outOfScopeStaged = stagedFiles.filter((filePath) => !isIgnorableCommitStagingSideEffect(cwd, filePath, taskId) &&
            !isFileAllowedInTaskBundle(cwd, filePath, taskId, declaredScope));
        if (outOfScopeStaged.length > 0) {
            warnings.push(`Pre-commit warning: staged files outside allowedFiles for ${taskId}: ${outOfScopeStaged.join(", ")}`);
        }
        if (mismatchedTaskIds.length > 0) {
            return {
                ok: false,
                code: "ATM_GIT_COMMIT_GOVERNANCE_BUNDLE_TASK_MISMATCH",
                summary: `git commit for ${taskId} found staged governance artifacts whose task ids do not match the active claim.`,
                warnings,
                details: { mismatchedTaskIds: uniqueSorted(mismatchedTaskIds) },
            };
        }
    }
    return {
        ok: true,
        code: "ATM_GIT_COMMIT_GOVERNANCE_BUNDLE_OK",
        summary: `Staged governance bundle for ${taskId} passed task-id consistency checks.`,
        warnings,
        details: {},
    };
}
export function inspectTaskScopedUnstagedCommit(cwd, taskId, taskDocument) {
    const stagedFiles = readStagedFiles(cwd);
    const declaredScope = resolveTaskDeclaredScope(cwd, taskId, taskDocument);
    const dirtyFiles = listTaskScopedWorktreeDirtyFiles(cwd).filter((filePath) => !isIgnorableTaskScopedDirtySideEffect(filePath));
    if (dirtyFiles.length === 0 && stagedFiles.length === 0) {
        return null;
    }
    const deliverableDirtyFiles = dirtyFiles.filter((filePath) => declaredScope.some((scope) => pathMatchesTaskScope(filePath, scope)));
    const skippedExternalDirtyFiles = dirtyFiles.filter((filePath) => !declaredScope.some((scope) => pathMatchesTaskScope(filePath, scope)) &&
        !isIgnorableCommitStagingSideEffect(cwd, filePath, taskId));
    const outOfScopeStagedFiles = stagedFiles.filter((filePath) => !isIgnorableCommitStagingSideEffect(cwd, filePath, taskId) &&
        !isFileAllowedInTaskBundle(cwd, filePath, taskId, declaredScope));
    const unstagedInScopeDirty = deliverableDirtyFiles.filter((filePath) => !stagedFiles.includes(filePath));
    const unstagedDeliverableDirty = unstagedInScopeDirty.filter((filePath) => !isAllowedGovernanceArtifactPath(cwd, filePath, taskId) &&
        !isCommitAttributionSideEffectPath(filePath));
    if (outOfScopeStagedFiles.length > 0 && unstagedDeliverableDirty.length > 0) {
        return {
            kind: "mixed-scope",
            inScopeDirtyFiles: uniqueSorted(unstagedDeliverableDirty),
            outOfScopeStagedFiles: uniqueSorted(outOfScopeStagedFiles),
        };
    }
    if (stagedFiles.length > 0) {
        return null;
    }
    if (deliverableDirtyFiles.length === 0) {
        return null;
    }
    return {
        kind: "staging-required",
        inScopeDirtyFiles: uniqueSorted(deliverableDirtyFiles),
        skippedExternalDirtyFiles: uniqueSorted(skippedExternalDirtyFiles),
        requiredCommand: buildTaskScopedStagingRequiredCommand(cwd, deliverableDirtyFiles),
    };
}
export function isIgnorableCommitStagingSideEffect(cwd, filePath, taskId) {
    const normalized = normalizeRelativePath(filePath).toLowerCase();
    const normalizedTaskId = taskId.toLowerCase();
    if (normalized.startsWith(".atm/runtime/")) {
        return true;
    }
    if (normalized === gitHeadEvidencePaths.legacyJson ||
        normalized === gitHeadEvidencePaths.jsonl) {
        return true;
    }
    if (normalized === `.atm/history/tasks/${normalizedTaskId}.json`) {
        return true;
    }
    if (normalized.startsWith(`.atm/history/task-events/${normalizedTaskId}/`)) {
        return true;
    }
    if (isTaskOwnedProtectedOverrideAuditPath(cwd, normalized, normalizedTaskId)) {
        return true;
    }
    return false;
}
export function isTaskOwnedProtectedOverrideAuditPath(cwd, filePath, normalizedTaskId) {
    const normalized = normalizeRelativePath(filePath).toLowerCase();
    if (!normalized.startsWith(".atm/history/protected-override-audit/") ||
        !normalized.endsWith(".json")) {
        return false;
    }
    return (readProtectedOverrideAuditTaskId(cwd, normalized)?.toLowerCase() ===
        normalizedTaskId);
}
export function cleanupAutoGeneratedResidue(cwd, findings) {
    const cleaned = [];
    for (const finding of findings) {
        if (finding.cleanupAction === "restore") {
            try {
                runGitCommand(cwd, [
                    "restore",
                    "--staged",
                    "--worktree",
                    "--source=HEAD",
                    "--",
                    finding.path,
                ], ["ignore", "pipe", "pipe"]);
            }
            catch {
                try {
                    runGitCommand(cwd, [
                        "rm",
                        "--cached",
                        "--quiet",
                        "--ignore-unmatch",
                        "--",
                        finding.path,
                    ], ["ignore", "pipe", "pipe"]);
                }
                catch { }
                try {
                    rmSync(path.join(cwd, finding.path), { force: true });
                }
                catch { }
            }
            cleaned.push(finding);
            continue;
        }
        if (finding.cleanupAction === "remove") {
            try {
                const absolutePath = path.join(cwd, finding.path);
                const stats = statSync(absolutePath);
                if (stats.isDirectory()) {
                    rmSync(absolutePath, { recursive: true, force: true });
                }
                else {
                    rmSync(absolutePath, { force: true });
                }
            }
            catch { }
            cleaned.push(finding);
        }
    }
    return cleaned;
}
export function resolveTaskDeclaredScope(cwd, taskId, taskDocument) {
    const taskDirectionLock = taskDocument.taskDirectionLock &&
        typeof taskDocument.taskDirectionLock === "object" &&
        !Array.isArray(taskDocument.taskDirectionLock)
        ? taskDocument.taskDirectionLock
        : {};
    const claim = taskDocument.claim &&
        typeof taskDocument.claim === "object" &&
        !Array.isArray(taskDocument.claim)
        ? taskDocument.claim
        : {};
    const lockAllowedFiles = getCanonicalAllowedFilesForTask(cwd, taskId) ?? [];
    return sanitizeTaskDirectionAllowedFiles(uniqueSorted([
        ...lockAllowedFiles,
        ...extractStringList(taskDirectionLock.allowedFiles),
        ...extractStringList(claim.files),
        ...extractStringList(taskDocument.targetAllowedFiles),
        ...extractTaskDeclaredFiles(taskDocument),
        ...listCommitAttributionSideEffectPaths(cwd),
        ...listTaskOwnedProtectedOverrideAuditFiles(cwd, taskId),
    ]));
}
export function frameworkTempTaskId(actorId) {
    const normalized = actorId
        .trim()
        .replace(/[^A-Za-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
    return `ATM-FRAMEWORK-TEMP-${normalized || "actor"}`;
}
export function readActiveFrameworkClaimFiles(cwd, actorId) {
    const lockRoot = path.join(cwd, ".atm", "runtime", "locks");
    const taskPrefix = frameworkTempTaskId(actorId);
    if (!existsSync(lockRoot))
        return [];
    const claimedFiles = [];
    for (const entry of readdirSync(lockRoot)) {
        if (!entry.startsWith(`${taskPrefix}.`) && !entry.startsWith(`${taskPrefix}-lane-`))
            continue;
        if (!entry.endsWith('.lock.json'))
            continue;
        try {
            const parsed = JSON.parse(readFileSync(path.join(lockRoot, entry), "utf8"));
            const lockActorId = typeof parsed.actorId === 'string' ? parsed.actorId.trim() : typeof parsed.lockedBy === 'string' ? parsed.lockedBy.trim() : '';
            const expectedTaskId = entry.slice(0, -'.lock.json'.length);
            const released = parsed.released === true || String(parsed.status ?? '').trim().toLowerCase() === 'released';
            if (lockActorId !== actorId || parsed.workItemId !== expectedTaskId || released)
                continue;
            claimedFiles.push(...extractStringList(parsed.files).map(normalizeRelativePath));
        }
        catch { }
    }
    return uniqueSorted(claimedFiles);
}
export function readReleaseGeneratedArtifactPaths(cwd) {
    const generated = new Set();
    for (const manifestPath of [
        path.join(cwd, "release", "atm-root-drop", "release-manifest.json"),
        path.join(cwd, "release", "atm-onefile", "release-manifest.json"),
    ]) {
        if (!existsSync(manifestPath))
            continue;
        try {
            const parsed = JSON.parse(readFileSync(manifestPath, "utf8"));
            for (const entry of extractStringList(parsed.generatedFiles)) {
                generated.add(normalizeRelativePath(entry));
            }
        }
        catch { }
    }
    return generated;
}
export function isFrameworkGeneratedArtifactAllowed(filePath, claimedFiles, releaseGeneratedArtifacts, ownerScope = null) {
    const normalized = normalizeRelativePath(filePath);
    const claimedScopes = [...claimedFiles];
    // A directory scope grants reach inside the claim; it never transfers authority
    // over another task's governance history. Naming the path exactly stays a
    // deliberate act and is still honoured. Ownership comes from the shared
    // cross-task seam so staging and admission cannot drift apart.
    if (ownerScope &&
        !claimedScopes.some((scope) => normalizeRelativePath(scope) === normalized)) {
        const ownerTaskId = resolveTaskHistoryOwnerTaskId(ownerScope.cwd, normalized);
        if (ownerTaskId && ownerTaskId !== String(ownerScope.currentTaskId ?? '').trim().toUpperCase()) {
            return false;
        }
    }
    if (claimedScopes.some((scope) => pathMatchesTaskScope(normalized, scope))) {
        return true;
    }
    for (const claimedFile of claimedScopes) {
        if (pathMatchesTaskScope(normalized, `release/atm-root-drop/${claimedFile}`)) {
            return true;
        }
        if (pathMatchesTaskScope(normalized, `release/atm-onefile/${claimedFile}`)) {
            return true;
        }
    }
    void releaseGeneratedArtifacts;
    return false;
}
export function isIgnorableFrameworkCommitStagingSideEffect(filePath) {
    const normalized = normalizeRelativePath(filePath).toLowerCase();
    if (normalized === gitHeadEvidencePaths.legacyJson ||
        normalized === gitHeadEvidencePaths.jsonl) {
        return true;
    }
    return isIgnorableTaskScopedDirtySideEffect(filePath);
}
export function autoStageFrameworkClaimFiles(cwd, actorId, apply = true, claimedFilesOverride = null) {
    const claimedFiles = new Set(claimedFilesOverride ?? readActiveFrameworkClaimFiles(cwd, actorId));
    if (claimedFiles.size === 0) {
        return [];
    }
    const stagedFiles = new Set(readStagedFiles(cwd));
    const releaseGeneratedArtifacts = readReleaseGeneratedArtifactPaths(cwd);
    const ownerScope = { cwd, currentTaskId: frameworkTempTaskId(actorId) };
    const candidates = uniqueSorted(listTaskScopedWorktreeDirtyFiles(cwd).filter((filePath) => {
        const normalized = normalizeRelativePath(filePath);
        const exactClaim = [...claimedFiles].some((scope) => normalizeRelativePath(scope) === normalized);
        return !stagedFiles.has(filePath)
            && (exactClaim || !isIgnorableFrameworkCommitStagingSideEffect(filePath))
            && isFrameworkGeneratedArtifactAllowed(filePath, claimedFiles, releaseGeneratedArtifacts, ownerScope);
    }));
    if (apply && candidates.length > 0) {
        stageFrameworkClaimPathspecBatches(cwd, candidates);
    }
    return candidates;
}
/**
 * Stage a framework delivery slice without exceeding the platform argv budget.
 *
 * Runner publications intentionally contain hundreds of generated files.  The
 * governed auto-stage route must preserve the same all-or-nothing candidate
 * set while issuing several bounded Git invocations, rather than constructing
 * one Windows-unspawnable `git add` command.
 */
export function stageFrameworkClaimPathspecBatches(cwd, candidates, invoke = (args) => runGitCommand(cwd, args, ["ignore", "pipe", "pipe"])) {
    return forEachPathspecBatch({ paths: candidates, fixedArgs: ["add", "-A", "-f", "--"] }, (batch) => invoke(["add", "-A", "-f", "--", ...batch]));
}
export function inspectFrameworkScopedUnstagedCommit(cwd, actorId, claimedFilesOverride = null) {
    const claimedFiles = new Set(claimedFilesOverride ?? readActiveFrameworkClaimFiles(cwd, actorId));
    if (claimedFiles.size === 0) {
        return null;
    }
    const releaseGeneratedArtifacts = readReleaseGeneratedArtifactPaths(cwd);
    const stagedFiles = readStagedFiles(cwd);
    const dirtyFiles = listTaskScopedWorktreeDirtyFiles(cwd).filter((filePath) => !isIgnorableTaskScopedDirtySideEffect(filePath));
    if (dirtyFiles.length === 0 && stagedFiles.length === 0) {
        return null;
    }
    const ownerScope = { cwd, currentTaskId: frameworkTempTaskId(actorId) };
    const inScopeDirtyFiles = uniqueSorted(dirtyFiles.filter((filePath) => isFrameworkGeneratedArtifactAllowed(filePath, claimedFiles, releaseGeneratedArtifacts, ownerScope)));
    const unstagedInScopeDirtyFiles = inScopeDirtyFiles.filter((filePath) => !stagedFiles.includes(filePath));
    const outOfScopeStagedFiles = stagedFiles.filter((filePath) => !isIgnorableFrameworkCommitStagingSideEffect(filePath) &&
        !isFrameworkGeneratedArtifactAllowed(filePath, claimedFiles, releaseGeneratedArtifacts, ownerScope));
    if (unstagedInScopeDirtyFiles.length === 0) {
        if (outOfScopeStagedFiles.length > 0) {
            return {
                kind: "mixed-scope",
                inScopeDirtyFiles: [],
                outOfScopeStagedFiles: uniqueSorted(outOfScopeStagedFiles),
            };
        }
        return null;
    }
    if (outOfScopeStagedFiles.length > 0) {
        return {
            kind: "mixed-scope",
            inScopeDirtyFiles: uniqueSorted(unstagedInScopeDirtyFiles),
            outOfScopeStagedFiles: uniqueSorted(outOfScopeStagedFiles),
        };
    }
    const skippedExternalDirtyFiles = uniqueSorted(dirtyFiles.filter((filePath) => !isFrameworkGeneratedArtifactAllowed(filePath, claimedFiles, releaseGeneratedArtifacts, ownerScope)));
    return {
        kind: "staging-required",
        inScopeDirtyFiles: uniqueSorted(inScopeDirtyFiles),
        skippedExternalDirtyFiles,
        requiredCommand: buildTaskScopedStagingRequiredCommand(cwd, inScopeDirtyFiles),
    };
}
export function listTaskScopedWorktreeDirtyFiles(cwd) {
    const files = new Set();
    for (const filePath of readGitNameOnly(cwd, ["diff", "--name-only"])) {
        files.add(filePath);
    }
    for (const filePath of readGitNameOnly(cwd, [
        "ls-files",
        "-o",
        "--exclude-standard",
    ])) {
        files.add(filePath);
    }
    return uniqueSorted([...files]);
}
export function buildTaskScopedStagingRequiredCommand(cwd, files) {
    const normalizedFiles = uniqueSorted(files.map(normalizeRelativePath).filter(Boolean));
    const cwdFlag = path.resolve(cwd) === path.resolve(process.cwd())
        ? ""
        : ` -C ${quoteCliValue(cwd)}`;
    return `${quoteCliValue(resolveGitExecutable())}${cwdFlag} add -- ${normalizedFiles.map(quoteCliValue).join(" ")}`;
}
export function readGitNameOnly(cwd, args) {
    try {
        return runGitCommand(cwd, args)
            .split(/\r?\n/)
            .map(normalizeRelativePath)
            .filter(Boolean);
    }
    catch {
        return [];
    }
}
export function extractStringList(value) {
    return Array.isArray(value)
        ? value
            .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
            .filter(Boolean)
        : [];
}
export function splitCsvPaths(value) {
    return [
        ...uniqueSorted(value
            .split(",")
            .map((entry) => entry.trim().replace(/^"|"$/g, "").replace(/^'|'$/g, ""))
            .filter(Boolean)),
    ];
}
export function taskImportReportReferencesTask(cwd, file, taskId) {
    try {
        const content = readFileSync(path.join(cwd, file), "utf8");
        const parsed = JSON.parse(content);
        return JSON.stringify(parsed).includes(`"${taskId}"`);
    }
    catch {
        return false;
    }
}
