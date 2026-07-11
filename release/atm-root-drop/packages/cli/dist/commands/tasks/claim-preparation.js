import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CliError, relativePathFrom } from '../shared.js';
import { toStoredPlanningPath } from '../planning-repo-root.js';
import { evaluateTaskPromotionAdmission } from './lifecycle-state.js';
import { writeTaskDocumentWithTransition } from './close-helpers/task-transition-writer.js';
import { taskPathFor } from './task-file-io-helpers.js';
function normalizeTaskStatus(value) {
    return String(value ?? '').trim().toLowerCase().replace(/-/g, '_');
}
export function prepareTaskForClaim(input) {
    const taskPath = taskPathFor(input.cwd, input.taskId);
    const originalStatus = normalizeTaskStatus(input.status);
    const transitionCommand = input.transitionCommand?.trim() || `node atm.mjs next --claim --task ${input.taskId} --actor ${input.actorId} --auto-intent --json`;
    const steps = [];
    let importEvidencePath = null;
    const importedAt = new Date().toISOString();
    if (!existsSync(taskPath)) {
        const imported = importPlanningTaskForReservation({
            cwd: input.cwd,
            taskId: input.taskId,
            importedAt,
            parseSingleCard: input.parseSingleCard,
            writeTaskFiles: input.writeTaskFiles,
            writeImportEvidence: input.writeImportEvidence
        });
        importEvidencePath = imported.evidencePath;
    }
    const taskDocument = JSON.parse(readFileSync(taskPath, 'utf8'));
    const currentStatus = normalizeTaskStatus(taskDocument.status);
    if (currentStatus === 'planned' || currentStatus === 'open') {
        const reserveAt = new Date().toISOString();
        const previousStatus = String(taskDocument.status ?? '');
        taskDocument.status = 'reserved';
        taskDocument.owner = input.actorId;
        taskDocument.reservedAt = reserveAt;
        if (!taskDocument.title || String(taskDocument.title).trim().length === 0) {
            taskDocument.title = input.title ?? input.taskId;
        }
        const transitionPath = writeTaskDocumentWithTransition({
            cwd: input.cwd,
            taskPath,
            taskId: input.taskId,
            taskDocument,
            action: 'reserve',
            actorId: input.actorId,
            previousStatus,
            command: transitionCommand
        });
        steps.push({
            action: 'reserve',
            status: 'reserved',
            transitionPath,
            importEvidencePath
        });
    }
    const owner = typeof taskDocument.owner === 'string' ? taskDocument.owner : null;
    if ((currentStatus === 'planned' || currentStatus === 'open' || currentStatus === 'reserved')
        && owner
        && owner !== input.actorId) {
        throw new CliError('ATM_TASKS_PROMOTE_OWNER_MISMATCH', `Task ${input.taskId} is reserved by ${owner}, not ${input.actorId}.`, {
            exitCode: 1,
            details: { taskId: input.taskId, owner, actorId: input.actorId }
        });
    }
    if (currentStatus === 'planned' || currentStatus === 'open' || currentStatus === 'reserved') {
        const promotionAdmission = evaluateTaskPromotionAdmission({
            taskId: input.taskId,
            status: taskDocument.status
        });
        if (!promotionAdmission.ok) {
            throw new CliError(promotionAdmission.code, promotionAdmission.message, {
                exitCode: 1,
                details: promotionAdmission.details
            });
        }
        taskDocument.status = 'ready';
        taskDocument.owner = input.actorId;
        taskDocument.promotedAt = new Date().toISOString();
        const transitionPath = writeTaskDocumentWithTransition({
            cwd: input.cwd,
            taskPath,
            taskId: input.taskId,
            taskDocument,
            action: 'promote',
            actorId: input.actorId,
            previousStatus: 'reserved',
            command: transitionCommand
        });
        steps.push({
            action: 'promote',
            status: 'ready',
            transitionPath
        });
    }
    return {
        taskId: input.taskId,
        originalStatus,
        finalStatus: normalizeTaskStatus(taskDocument.status),
        steps
    };
}
function importPlanningTaskForReservation(input) {
    const planCandidates = findPlanningTaskCardCandidates(input.cwd, input.taskId);
    if (planCandidates.length === 0) {
        throw new CliError('ATM_TASK_RESERVE_PLANNING_CARD_REQUIRED', `tasks reserve requires a human-authored planning card for ${input.taskId}; no matching task card was found in sibling planning repositories.`, {
            exitCode: 1,
            details: {
                taskId: input.taskId,
                searchedFrom: path.dirname(input.cwd)
            }
        });
    }
    if (planCandidates.length > 1) {
        throw new CliError('ATM_TASK_RESERVE_PLANNING_CARD_AMBIGUOUS', `tasks reserve found multiple planning cards for ${input.taskId}; import the intended card first or remove the ambiguity.`, {
            exitCode: 1,
            details: {
                taskId: input.taskId,
                candidates: planCandidates.map((candidate) => relativePathFrom(input.cwd, candidate))
            }
        });
    }
    const planAbsolute = planCandidates[0];
    const planText = readFileSync(planAbsolute, 'utf8');
    const task = input.parseSingleCard({
        planText,
        planRelativePath: toStoredPlanningPath(input.cwd, planAbsolute),
        importedAt: input.importedAt
    });
    if (!task || task.workItemId !== input.taskId) {
        throw new CliError('ATM_TASK_RESERVE_PLANNING_CARD_INVALID', `tasks reserve found a planning card for ${input.taskId}, but ATM could not import a valid single-card contract from it.`, {
            exitCode: 1,
            details: {
                taskId: input.taskId,
                planPath: toStoredPlanningPath(input.cwd, planAbsolute)
            }
        });
    }
    const writeResult = input.writeTaskFiles({
        cwd: input.cwd,
        tasks: [task],
        force: false,
        forceOverwriteClaims: false,
        resetOpen: false,
        reopen: false
    });
    const blockingDiagnostics = writeResult.diagnostics.filter((entry) => entry.level === 'error');
    if (blockingDiagnostics.length > 0) {
        throw new CliError('ATM_TASK_RESERVE_IMPORT_FAILED', `tasks reserve could not auto-import ${input.taskId} before reservation.`, {
            exitCode: 1,
            details: {
                taskId: input.taskId,
                planPath: toStoredPlanningPath(input.cwd, planAbsolute),
                diagnostics: blockingDiagnostics
            }
        });
    }
    const evidencePath = input.writeImportEvidence({
        cwd: input.cwd,
        tasks: [task],
        planPath: toStoredPlanningPath(input.cwd, planAbsolute),
        generatedAt: input.importedAt,
        writtenPaths: writeResult.writtenPaths
    });
    return {
        evidencePath,
        taskPath: taskPathFor(input.cwd, input.taskId)
    };
}
function findPlanningTaskCardCandidates(cwd, taskId) {
    const parentDirectory = path.dirname(cwd);
    if (!existsSync(parentDirectory))
        return [];
    let siblingEntries;
    try {
        siblingEntries = readdirSync(parentDirectory, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const normalizedCwd = path.resolve(cwd);
    const matches = [];
    for (const entry of siblingEntries) {
        if (!entry.isDirectory())
            continue;
        const siblingRoot = path.resolve(parentDirectory, entry.name);
        if (siblingRoot === normalizedCwd)
            continue;
        collectPlanningTaskCardsForReservation({
            root: siblingRoot,
            current: siblingRoot,
            taskId,
            depth: 0,
            matches
        });
    }
    return matches.sort((left, right) => {
        const leftPriority = left.includes(`${path.sep}docs${path.sep}ai_atomic_framework${path.sep}`) ? 0 : 1;
        const rightPriority = right.includes(`${path.sep}docs${path.sep}ai_atomic_framework${path.sep}`) ? 0 : 1;
        return leftPriority - rightPriority || left.localeCompare(right);
    });
}
function collectPlanningTaskCardsForReservation(input) {
    if (input.depth > 6 || input.matches.length > 12)
        return;
    let entries;
    try {
        entries = readdirSync(input.current, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        const absolutePath = path.join(input.current, entry.name);
        if (entry.isDirectory()) {
            if (entry.name.startsWith('.git') || entry.name === 'node_modules' || entry.name === '.atm')
                continue;
            collectPlanningTaskCardsForReservation({
                ...input,
                current: absolutePath,
                depth: input.depth + 1
            });
            continue;
        }
        if (!entry.isFile() || !entry.name.endsWith('.task.md'))
            continue;
        if (entry.name === `${input.taskId}.task.md` || entry.name.startsWith(`${input.taskId}-`)) {
            input.matches.push(absolutePath);
        }
    }
}
