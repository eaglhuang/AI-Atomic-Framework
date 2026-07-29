import { existsSync, } from "node:fs";
import path from "node:path";
import { gitHeadEvidencePaths, } from "../../git-head-evidence.js";
import { normalizeRelativePath, uniqueSorted, } from "../commit-scope-policy.js";
import { CliError, } from "../../shared.js";
import { readStagedFiles, readStagedJsonFile } from './git-index-transaction.js';
import { isCommitAttributionSideEffectPath } from './git-process-port.js';
import { taskImportReportReferencesTask } from './task-scope-staging.js';
export function isRecordCommitAllowedPath(filePath) {
    const normalized = normalizeRelativePath(filePath).toLowerCase();
    if (!normalized)
        return false;
    if (normalized === gitHeadEvidencePaths.legacyJson ||
        normalized === gitHeadEvidencePaths.jsonl)
        return true;
    if (isCommitAttributionSideEffectPath(normalized))
        return true;
    if (normalized.includes("/protected-override") ||
        normalized.startsWith(".atm/history/protected-override-audit/"))
        return false;
    if (normalized.endsWith(".closure-packet.json"))
        return false;
    if (normalized.includes("/repair") || normalized.includes(".repair-"))
        return false;
    if (normalized.startsWith(".atm/history/tasks/") &&
        normalized.endsWith(".json"))
        return true;
    if (normalized.startsWith(".atm/history/task-events/") &&
        normalized.endsWith(".json"))
        return true;
    if (normalized.startsWith(".atm/history/reports/task-import/") &&
        normalized.endsWith(".json"))
        return true;
    if (normalized.startsWith(".atm/history/evidence/historical-batches/") &&
        normalized.endsWith(".json"))
        return true;
    if (/^\.atm\/history\/evidence\/[^/]+(?:\.bundle-manifest)?\.json$/.test(normalized))
        return true;
    return false;
}
export function extractRecordCommitTaskOwner(filePath) {
    const normalized = normalizeRelativePath(filePath);
    const match = normalized.match(/^\.atm\/history\/(?:tasks|task-events|evidence)\/([^/.]+)/i);
    return match ? match[1].toUpperCase() : null;
}
export function assertRecordCommitSingleTaskOwner(cwd, stagedFiles) {
    const taskOwnerFiles = new Map();
    for (const filePath of stagedFiles) {
        const ownerTaskId = extractRecordCommitTaskOwner(filePath);
        if (!ownerTaskId)
            continue;
        if (!existsSync(path.join(cwd, ".atm", "history", "tasks", `${ownerTaskId}.json`)))
            continue;
        taskOwnerFiles.set(ownerTaskId, [
            ...(taskOwnerFiles.get(ownerTaskId) ?? []),
            filePath,
        ]);
    }
    if (taskOwnerFiles.size <= 1)
        return null;
    const conflicts = Array.from(taskOwnerFiles.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([conflictTaskId, conflictFiles]) => ({
        conflictTaskId,
        conflictFiles: uniqueSorted(conflictFiles),
        owner: conflictTaskId,
        surface: "task-history",
    }));
    const conflictFiles = uniqueSorted(conflicts.flatMap((conflict) => conflict.conflictFiles));
    throw new CliError("ATM_CROSS_TASK_MUTATION_BLOCKED", `git record-commit cannot combine low-risk record files owned by multiple tasks. File(s): ${conflictFiles.join(", ")}.`, {
        exitCode: 1,
        details: {
            taskId: null,
            conflictTaskId: conflicts[0]?.conflictTaskId ?? null,
            conflictFiles,
            conflicts,
            recoveryLane: "Split record maintenance by task owner, or use the governed closeback/reconcile lane that owns the full cross-task packet.",
        },
    });
}
export function inspectMirrorSyncOnlyStagedArtifacts(cwd, taskId) {
    const stagedFiles = readStagedFiles(cwd);
    if (stagedFiles.length === 0) {
        return { ok: false, taskId, stagedFiles, reason: "no-staged-files" };
    }
    const expectedTaskPath = `.atm/history/tasks/${taskId}.json`.toLowerCase();
    let hasTaskLedger = false;
    let hasImportEvent = false;
    for (const file of stagedFiles) {
        const normalized = normalizeRelativePath(file);
        const lower = normalized.toLowerCase();
        if (lower === expectedTaskPath) {
            hasTaskLedger = true;
            continue;
        }
        if (lower.startsWith(`.atm/history/task-events/${taskId.toLowerCase()}/`) &&
            lower.includes("import") &&
            lower.endsWith(".json")) {
            hasImportEvent = true;
            continue;
        }
        if (lower.startsWith(".atm/history/reports/task-import/") &&
            lower.endsWith(".json") &&
            taskImportReportReferencesTask(cwd, normalized, taskId)) {
            continue;
        }
        return {
            ok: false,
            taskId,
            stagedFiles,
            reason: `unexpected-staged-file:${normalized}`,
        };
    }
    if (!hasTaskLedger)
        return { ok: false, taskId, stagedFiles, reason: "missing-task-ledger" };
    if (!hasImportEvent)
        return { ok: false, taskId, stagedFiles, reason: "missing-import-event" };
    return { ok: true, taskId, stagedFiles, reason: null };
}
export function inspectHistoricalLedgerRestoreStagedArtifacts(cwd, taskId) {
    const stagedFiles = readStagedFiles(cwd);
    if (stagedFiles.length === 0) {
        return { ok: false, taskId, stagedFiles, reason: "no-staged-files" };
    }
    const normalizedTaskId = taskId.toLowerCase();
    const expectedTaskPath = `.atm/history/tasks/${taskId}.json`.toLowerCase();
    const expectedEvidencePath = `.atm/history/evidence/${taskId}.json`.toLowerCase();
    const expectedClosurePacketPath = `.atm/history/evidence/${taskId}.closure-packet.json`.toLowerCase();
    const expectedGitHeadEvidencePath = ".atm/history/evidence/git-head.jsonl";
    let hasTaskLedger = false;
    let hasEvidenceBundle = false;
    let hasClosurePacket = false;
    let hasTaskEvent = false;
    let hasGitHeadEvidence = false;
    for (const file of stagedFiles) {
        const normalized = normalizeRelativePath(file);
        const lower = normalized.toLowerCase();
        if (lower === expectedTaskPath) {
            hasTaskLedger = true;
            continue;
        }
        if (lower === expectedEvidencePath) {
            hasEvidenceBundle = true;
            continue;
        }
        if (lower === expectedClosurePacketPath) {
            hasClosurePacket = true;
            continue;
        }
        if (lower === expectedGitHeadEvidencePath) {
            hasGitHeadEvidence = true;
            continue;
        }
        if (lower.startsWith(`.atm/history/task-events/${normalizedTaskId}/`) &&
            lower.endsWith(".json")) {
            hasTaskEvent = true;
            continue;
        }
        return {
            ok: false,
            taskId,
            stagedFiles,
            reason: `unexpected-staged-file:${normalized}`,
        };
    }
    if (!hasTaskLedger)
        return { ok: false, taskId, stagedFiles, reason: "missing-task-ledger" };
    if (!hasClosurePacket)
        return { ok: false, taskId, stagedFiles, reason: "missing-closure-packet" };
    if (!hasTaskEvent)
        return { ok: false, taskId, stagedFiles, reason: "missing-task-event" };
    const taskDocument = readStagedJsonFile(cwd, `.atm/history/tasks/${taskId}.json`);
    if (!taskDocument)
        return { ok: false, taskId, stagedFiles, reason: "task-ledger-invalid" };
    if (taskDocument.status !== "done")
        return { ok: false, taskId, stagedFiles, reason: "task-not-done" };
    if (typeof taskDocument.workItemId === "string" &&
        taskDocument.workItemId !== taskId) {
        return { ok: false, taskId, stagedFiles, reason: "task-id-mismatch" };
    }
    const closurePacket = readStagedJsonFile(cwd, `.atm/history/evidence/${taskId}.closure-packet.json`);
    if (!closurePacket || closurePacket.taskId !== taskId) {
        return {
            ok: false,
            taskId,
            stagedFiles,
            reason: "closure-packet-task-id-mismatch",
        };
    }
    const evidence = readStagedJsonFile(cwd, `.atm/history/evidence/${taskId}.json`);
    for (const eventPath of stagedFiles.filter((file) => normalizeRelativePath(file)
        .toLowerCase()
        .startsWith(`.atm/history/task-events/${normalizedTaskId}/`))) {
        const event = readStagedJsonFile(cwd, eventPath);
        const command = typeof event?.command === "string" ? event.command.trim() : "";
        if (!event ||
            event.schemaId !== "atm.taskTransition.v1" ||
            event.taskId !== taskId ||
            typeof event.transitionId !== "string" ||
            !command.startsWith("node atm.mjs ")) {
            return {
                ok: false,
                taskId,
                stagedFiles,
                reason: `task-event-invalid:${normalizeRelativePath(eventPath)}`,
            };
        }
    }
    if (!hasEvidenceBundle) {
        if (!hasGitHeadEvidence) {
            return {
                ok: false,
                taskId,
                stagedFiles,
                reason: "missing-evidence-bundle",
            };
        }
        const repairEventPaths = stagedFiles.filter((file) => normalizeRelativePath(file)
            .toLowerCase()
            .startsWith(`.atm/history/task-events/${normalizedTaskId}/`));
        const repairOnly = repairEventPaths.length > 0 &&
            repairEventPaths.every((eventPath) => {
                const event = readStagedJsonFile(cwd, eventPath);
                return event?.action === "repair-closure";
            });
        if (!repairOnly) {
            return {
                ok: false,
                taskId,
                stagedFiles,
                reason: "missing-evidence-bundle",
            };
        }
    }
    else if (!evidence || evidence.taskId !== taskId) {
        return {
            ok: false,
            taskId,
            stagedFiles,
            reason: "evidence-task-id-mismatch",
        };
    }
    return { ok: true, taskId, stagedFiles, reason: null };
}
