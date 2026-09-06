import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { CliError, makeResult, message, relativePathFrom, } from "../../shared.js";
import { readJsonRecord, taskPathFor, collectTaskFileValues, } from "../task-file-io-helpers.js";
import { normalizeOptionalString, normalizeTaskId, parseYamlList, } from "../task-import-validators.js";
import { readTaskLedgerPolicy } from "../../task-ledger.js";
import { buildBrokerAdmissionExplanation as delegatedBuildBrokerAdmissionExplanation, explainBrokerAdapterForPath as delegatedExplainBrokerAdapterForPath, hasUnexplainedSharedProjection as delegatedHasUnexplainedSharedProjection, } from "../close-helpers/broker-admission-explanation.js";
import { normalizeTaskDocumentId as delegatedNormalizeTaskDocumentId } from "../normalize-task-document-id-helper.js";
function runTasksParallel(argv) {
    const parsed = parseTasksParallelArgs(argv);
    if (parsed.mode === "pair") {
        const left = readParallelAdvisorTask(parsed.cwd, parsed.taskId);
        const right = readParallelAdvisorTask(parsed.cwd, parsed.withTaskId);
        const finding = analyzeParallelPair(left, right);
        return makeResult({
            ok: true,
            command: "tasks",
            cwd: parsed.cwd,
            messages: [
                message("info", "ATM_TASKS_PARALLEL_ANALYZED", `Parallel advisor analyzed ${left.taskId} with ${right.taskId}.`, {
                    verdict: finding.verdict,
                    taskId: left.taskId,
                    withTaskId: right.taskId,
                }),
            ],
            evidence: {
                action: "parallel pair",
                task: left,
                withTask: right,
                finding,
            },
        });
    }
    if (parsed.mode === "queue-for-task") {
        const anchor = readParallelAdvisorTask(parsed.cwd, parsed.taskId);
        const candidates = listParallelAdvisorTasks(parsed.cwd).filter((task) => task.taskId !== anchor.taskId);
        const analyses = candidates.map((candidate) => ({
            taskId: candidate.taskId,
            title: candidate.title,
            status: candidate.status,
            activeClaimActorId: candidate.activeClaimActorId,
            activeClaimIntent: candidate.activeClaimIntent,
            finding: analyzeParallelPair(anchor, candidate),
        }));
        return makeResult({
            ok: true,
            command: "tasks",
            cwd: parsed.cwd,
            messages: [
                message("info", "ATM_TASKS_PARALLEL_QUEUE_ANALYZED", `Parallel advisor compared ${anchor.taskId} against ${analyses.length} queue candidate(s).`, { taskId: anchor.taskId, candidateCount: analyses.length }),
            ],
            evidence: {
                action: "parallel queue",
                task: anchor,
                candidates: analyses,
            },
        });
    }
    const tasks = listParallelAdvisorTasks(parsed.cwd);
    const hotspot = buildParallelHotspotReport(tasks);
    return makeResult({
        ok: true,
        command: "tasks",
        cwd: parsed.cwd,
        messages: [
            message("info", "ATM_TASKS_PARALLEL_REPORT_READY", `Parallel advisor generated a queue hotspot report for ${tasks.length} task(s).`, { taskCount: tasks.length }),
        ],
        evidence: {
            action: "parallel queue report",
            taskCount: tasks.length,
            hotspot,
        },
    });
}
function parseTasksParallelArgs(argv) {
    let cwd = process.cwd();
    let taskId = null;
    let withTaskId = null;
    let queueFlag = false;
    let reportFlag = false;
    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];
        if (arg === "--cwd") {
            cwd = requireValue(argv, index, "--cwd");
            index += 1;
            continue;
        }
        if (arg === "--task") {
            taskId = requireValue(argv, index, "--task");
            index += 1;
            continue;
        }
        if (arg === "--with") {
            withTaskId = requireValue(argv, index, "--with");
            index += 1;
            continue;
        }
        if (arg === "--queue") {
            queueFlag = true;
            continue;
        }
        if (arg === "--report") {
            reportFlag = true;
            continue;
        }
        if (arg === "--json" || arg === "--pretty" || arg === "--summary") {
            continue;
        }
        if (arg === "--fields" || arg === "--output-json") {
            index += 1;
            continue;
        }
        throw new CliError("ATM_CLI_USAGE", `tasks parallel does not support option ${arg}.`, { exitCode: 2 });
    }
    if (taskId && withTaskId) {
        return {
            cwd,
            mode: "pair",
            taskId: normalizeTaskId(taskId),
            withTaskId: normalizeTaskId(withTaskId),
        };
    }
    if (taskId && queueFlag) {
        return { cwd, mode: "queue-for-task", taskId: normalizeTaskId(taskId) };
    }
    if (queueFlag && reportFlag) {
        return { cwd, mode: "queue-report" };
    }
    throw new CliError("ATM_CLI_USAGE", "tasks parallel requires either --task <id> --with <id>, --task <id> --queue, or --queue --report.", {
        exitCode: 2,
        details: {
            invalidFlags: [],
            missingRequired: [],
            allowedFlags: [
                "--cwd",
                "--task",
                "--with",
                "--queue",
                "--report",
                "--json",
                "--pretty",
                "--output-json",
                "--summary",
                "--fields",
            ],
        },
    });
}
function listParallelAdvisorTasks(cwd) {
    const taskLedger = readTaskLedgerPolicy(cwd);
    const taskRoot = path.join(cwd, taskLedger.taskRoot);
    const entries = readdirSync(taskRoot, { withFileTypes: true });
    const tasks = [];
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".json"))
            continue;
        const fullPath = path.join(taskRoot, entry.name);
        const doc = readJsonRecord(fullPath);
        const status = normalizeTaskStatus(doc.status);
        if (![
            "open",
            "running",
            "ready",
            "in_progress",
            "review",
            "blocked",
            "reserved",
        ].includes(status))
            continue;
        tasks.push(taskDocumentToParallelAdvisorTask(cwd, doc));
    }
    return tasks;
}
function readParallelAdvisorTask(cwd, taskId) {
    const taskPath = taskPathFor(cwd, taskId);
    if (!existsSync(taskPath)) {
        throw new CliError("ATM_TASK_NOT_FOUND", `Task file not found for ${taskId}.`, {
            exitCode: 2,
            details: { taskId, taskPath: relativePathFrom(cwd, taskPath) },
        });
    }
    return taskDocumentToParallelAdvisorTask(cwd, readJsonRecord(taskPath));
}
function taskDocumentToParallelAdvisorTask(cwd, taskDocument) {
    const taskId = normalizeTaskDocumentId(taskDocument, "TASK-UNKNOWN-0000");
    const title = normalizeOptionalString(taskDocument.title) ?? taskId;
    const status = normalizeTaskStatus(taskDocument.status);
    const collectedFiles = collectParallelAdvisorTaskFiles(taskDocument);
    const allowedFiles = uniqueStrings(Array.from(collectedFiles)
        .map((value) => normalizeParallelAdvisorPath(cwd, value))
        .filter((value) => Boolean(value)));
    const validators = uniqueStrings(parseYamlList(taskDocument.validators)
        .map((entry) => entry.trim())
        .filter(Boolean));
    const atomIds = uniqueStrings(allowedFiles.flatMap((entry) => findAtomIdsForPath(cwd, entry)));
    const claimRecord = taskDocument.claim &&
        typeof taskDocument.claim === "object" &&
        !Array.isArray(taskDocument.claim)
        ? taskDocument.claim
        : null;
    const claimState = normalizeOptionalString(claimRecord?.state);
    const activeClaimActorId = claimState === "active"
        ? normalizeOptionalString(claimRecord?.actorId)
        : null;
    const activeClaimIntent = claimState === "active"
        ? (normalizeOptionalString(claimRecord?.intent) ?? "write")
        : null;
    return {
        taskId,
        title,
        status,
        allowedFiles,
        validators,
        atomIds,
        activeClaimActorId,
        activeClaimIntent,
    };
}
function collectParallelAdvisorTaskFiles(taskDocument) {
    const files = new Set();
    const taskDirectionLock = taskDocument.taskDirectionLock;
    const claim = taskDocument.claim;
    const legacyImportAliases = taskDocument.legacyImportAliases;
    const targetWork = taskDocument.targetWork;
    collectTaskFileValues(taskDocument.scopePaths, files);
    collectTaskFileValues(taskDocument.deliverables, files);
    collectTaskFileValues(taskDocument.targetAllowedFiles, files);
    collectTaskFileValues(taskDocument.planningMirrorPaths, files);
    if (claim && typeof claim === "object" && !Array.isArray(claim)) {
        collectTaskFileValues(claim.files, files);
    }
    if (taskDirectionLock &&
        typeof taskDirectionLock === "object" &&
        !Array.isArray(taskDirectionLock)) {
        collectTaskFileValues(taskDirectionLock.allowedFiles, files);
    }
    if (legacyImportAliases &&
        typeof legacyImportAliases === "object" &&
        !Array.isArray(legacyImportAliases)) {
        collectTaskFileValues(legacyImportAliases.allowed_files, files);
    }
    if (targetWork &&
        typeof targetWork === "object" &&
        !Array.isArray(targetWork)) {
        collectTaskFileValues(targetWork.allowedFiles, files);
    }
    return files;
}
function normalizeParallelAdvisorPath(cwd, value) {
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    const normalized = trimmed.replace(/\\/g, "/");
    if (/^[A-Za-z]:\//.test(normalized)) {
        return relativePathFrom(cwd, normalized).replace(/\\/g, "/");
    }
    return normalized.replace(/^\.\/+/, "");
}
function loadPathToAtomMappings(cwd) {
    const mapPath = path.join(cwd, "atomic_workbench", "atomization-coverage", "path-to-atom-map.json");
    const payload = readJsonRecord(mapPath);
    return (payload.mappings ?? []).flatMap((entry) => {
        const pathPattern = normalizeOptionalString(entry.path_pattern);
        const atomId = normalizeOptionalString(entry.atom_id);
        const capability = normalizeOptionalString(entry.capability) ?? "";
        if (!pathPattern || !atomId)
            return [];
        return [{ pathPattern, atomId, capability }];
    });
}
function findAtomIdsForPath(cwd, relativePath) {
    const normalized = relativePath.replace(/\\/g, "/");
    return loadPathToAtomMappings(cwd)
        .filter((mapping) => globLikeMatch(normalized, mapping.pathPattern))
        .map((mapping) => mapping.atomId);
}
function analyzeParallelPair(left, right) {
    const overlappingFiles = intersect(left.allowedFiles, right.allowedFiles);
    const overlappingAtomIds = intersect(left.atomIds, right.atomIds);
    const sharedValidators = intersect(left.validators, right.validators);
    const sharedGenerators = overlappingFiles.filter((entry) => /generator|build|manifest/i.test(entry));
    const sharedProjections = overlappingFiles.filter((entry) => /projection|map|registry|index/i.test(entry));
    const sharedArtifacts = overlappingFiles.filter((entry) => /artifact|report|jsonl/i.test(entry));
    const activeLeaseConflicts = overlappingFiles.filter((entry) => /\.atm\/history\//i.test(entry));
    const brokerAdmission = buildBrokerAdmissionExplanation({
        overlappingFiles,
        overlappingAtomIds,
        sharedProjections,
    });
    let verdict = "parallel-safe";
    if (brokerAdmission.confirmedConflict) {
        verdict = "blocked-cid-conflict";
    }
    else if (activeLeaseConflicts.length > 0) {
        verdict = "blocked-active-lease";
    }
    else if (sharedGenerators.length > 0 ||
        sharedArtifacts.length > 0 ||
        hasUnexplainedSharedProjection(sharedProjections, brokerAdmission)) {
        verdict = "blocked-shared-surface";
    }
    else if (overlappingAtomIds.length > 0 ||
        brokerAdmission.mutationIntentStatus === "missing") {
        verdict = "insufficient-mutation-intent";
    }
    else if (overlappingFiles.length > 0) {
        verdict = "needs-physical-split";
    }
    else if (left.allowedFiles.length === 0 ||
        right.allowedFiles.length === 0) {
        verdict = "insufficient-atom-map";
    }
    return {
        verdict,
        overlappingFiles,
        overlappingAtomIds,
        sharedValidators,
        sharedGenerators,
        sharedProjections,
        sharedArtifacts,
        activeLeaseConflicts,
        brokerAdmission,
    };
}
const buildBrokerAdmissionExplanation = delegatedBuildBrokerAdmissionExplanation;
const explainBrokerAdapterForPath = delegatedExplainBrokerAdapterForPath;
const hasUnexplainedSharedProjection = delegatedHasUnexplainedSharedProjection;
function buildParallelHotspotReport(tasks) {
    const fileCounts = new Map();
    const atomCounts = new Map();
    const validatorCounts = new Map();
    for (let leftIndex = 0; leftIndex < tasks.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < tasks.length; rightIndex += 1) {
            const finding = analyzeParallelPair(tasks[leftIndex], tasks[rightIndex]);
            for (const file of finding.overlappingFiles)
                incrementMap(fileCounts, file);
            for (const atomId of finding.overlappingAtomIds)
                incrementMap(atomCounts, atomId);
            for (const validator of finding.sharedValidators)
                incrementMap(validatorCounts, validator);
        }
    }
    return {
        topOverlappingFiles: sortMapEntries(fileCounts),
        topOverlappingAtomIds: sortMapEntries(atomCounts),
        topSharedValidators: sortMapEntries(validatorCounts),
    };
}
function intersect(left, right) {
    const rightSet = new Set(right);
    return left.filter((value) => rightSet.has(value));
}
function incrementMap(target, key) {
    target.set(key, (target.get(key) ?? 0) + 1);
}
function sortMapEntries(target) {
    return Array.from(target.entries())
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([value, count]) => ({ value, count }));
}
function globLikeMatch(value, pattern) {
    const normalizedPattern = pattern.replace(/\\/g, "/");
    const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    const regexSource = `^${escaped
        .replace(/\*\*/g, "::DOUBLE_STAR::")
        .replace(/\*/g, "[^/]*")
        .replace(/::DOUBLE_STAR::/g, ".*")}$`;
    return new RegExp(regexSource).test(value);
}
function normalizeTaskDocumentId(document, fallback) {
    return delegatedNormalizeTaskDocumentId(document, fallback);
}
function normalizeTaskStatus(value) {
    return String(value ?? "")
        .trim()
        .toLowerCase()
        .replace(/-/g, "_");
}
function uniqueStrings(values) {
    return Array.from(new Set(values));
}
function requireValue(argv, index, flag) {
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
        throw new CliError("ATM_CLI_USAGE", `tasks requires a value for ${flag}`, {
            exitCode: 2,
        });
    }
    return value;
}
export { runTasksParallel };
