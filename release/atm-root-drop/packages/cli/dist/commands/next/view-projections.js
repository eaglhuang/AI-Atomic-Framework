import { createHash } from 'node:crypto';
export function uniqueSorted(values) {
    return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}
export function uniqueInOrder(values) {
    const seen = new Set();
    const output = [];
    for (const value of values.map((entry) => String(entry).trim()).filter(Boolean)) {
        if (seen.has(value))
            continue;
        seen.add(value);
        output.push(value);
    }
    return output;
}
export function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}
export function toTaskCandidateView(task) {
    return {
        workItemId: task.workItemId,
        title: task.title,
        status: task.status,
        closedAt: task.closedAt,
        closedByActor: task.closedByActor,
        closurePacket: task.closurePacket,
        lastTransitionId: task.lastTransitionId,
        lastTransitionAt: task.lastTransitionAt,
        taskPath: task.taskPath,
        format: task.format,
        sourcePlanPath: task.sourcePlanPath,
        nearbyPlanPaths: task.nearbyPlanPaths,
        scopePaths: task.scopePaths,
        planningContext: {
            readOnlyPaths: task.planningReadOnlyPaths
        },
        targetWork: {
            allowedFiles: task.targetAllowedFiles,
            allowPlanningMirror: task.allowPlanningMirror
        },
        targetRepo: task.targetRepo,
        matchScore: task.matchScore ?? 0,
        matchReasons: task.matchReasons ?? []
    };
}
export function dedupeStrings(values) {
    return Array.from(new Set(values));
}
export function quoteCliValue(value) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
