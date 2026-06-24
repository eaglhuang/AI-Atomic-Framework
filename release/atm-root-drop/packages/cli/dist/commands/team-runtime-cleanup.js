import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { readJsonFile, relativePathFrom } from './shared.js';
const terminalTaskStatuses = new Set(['done', 'abandoned', 'blocked']);
export function cleanupStaleTeamRunsForTerminalTasks(input) {
    const directory = path.join(input.cwd, '.atm', 'runtime', 'team-runs');
    if (!existsSync(directory)) {
        return [];
    }
    const cleaned = [];
    for (const entry of readdirSync(directory).filter((name) => name.endsWith('.json')).sort((left, right) => left.localeCompare(right))) {
        const absolutePath = path.join(directory, entry);
        const run = readJsonFile(absolutePath, 'ATM_TEAM_RUN_INVALID');
        const taskId = normalizeOptionalString(run.taskId);
        if (!taskId)
            continue;
        if (input.taskId && taskId !== input.taskId)
            continue;
        if (normalizeOptionalString(run.status) !== 'active')
            continue;
        const terminalTaskStatus = resolveTerminalTaskStatus(input.cwd, taskId, input);
        if (!terminalTaskStatus)
            continue;
        rmSync(absolutePath, { force: true });
        cleaned.push({
            teamRunId: normalizeOptionalString(run.teamRunId) ?? path.basename(entry, '.json'),
            taskId,
            path: relativePathFrom(input.cwd, absolutePath),
            reason: 'terminal-task',
            terminalTaskStatus
        });
    }
    return cleaned;
}
function resolveTerminalTaskStatus(cwd, taskId, input) {
    if (input.taskId === taskId) {
        return normalizeTerminalTaskStatus(input.terminalTaskStatus);
    }
    const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    if (!existsSync(taskPath))
        return null;
    const taskDocument = readJsonFile(taskPath, 'ATM_TEAM_TASK_INVALID');
    return normalizeTerminalTaskStatus(taskDocument.status);
}
function normalizeTerminalTaskStatus(value) {
    const normalized = normalizeOptionalString(value);
    if (!normalized)
        return null;
    return terminalTaskStatuses.has(normalized) ? normalized : null;
}
function normalizeOptionalString(value) {
    if (typeof value !== 'string')
        return null;
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
}
