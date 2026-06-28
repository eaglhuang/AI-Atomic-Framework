import { createOrRefreshTaskQueue } from '../task-direction.js';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
function fail(message) {
    console.error(`[task-direction-queue.test] ${message}`);
    process.exitCode = 1;
    throw new Error(message);
}
function assert(condition, message) {
    if (!condition)
        fail(message);
}
function task(overrides) {
    return {
        workItemId: overrides.workItemId,
        title: overrides.title,
        dependencies: overrides.dependencies ?? [],
        taskPath: overrides.taskPath ?? `.atm/history/tasks/${overrides.workItemId}.json`,
        sourcePlanPath: overrides.sourcePlanPath ?? null,
        nearbyPlanPaths: overrides.nearbyPlanPaths ?? [],
        scopePaths: overrides.scopePaths ?? ['docs/**'],
        targetRepo: overrides.targetRepo ?? 'AI-Atomic-Framework',
        allowPlanningMirror: overrides.allowPlanningMirror ?? false,
        outOfScope: overrides.outOfScope ?? []
    };
}
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-task-direction-queue-'));
const reordered = createOrRefreshTaskQueue({
    cwd: repo,
    sourcePrompt: 'SKL batch ordering regression',
    tasks: [
        task({ workItemId: 'TASK-SKL-0005', title: 'tool-first migration', dependencies: ['TASK-SKL-0007'] }),
        task({ workItemId: 'TASK-SKL-0007', title: 'shared growth contract' }),
        task({ workItemId: 'TASK-SKL-0008', title: 'team role contract', dependencies: ['TASK-SKL-0005', 'TASK-SKL-0007'] })
    ]
});
assert(JSON.stringify(reordered.taskIds) === JSON.stringify(['TASK-SKL-0007', 'TASK-SKL-0005', 'TASK-SKL-0008']), 'queue should place in-queue dependencies before dependents while preserving stable order');
assert(reordered.currentIndex === 0, 'new dependency-ordered queue must start at index 0');
const cyclic = createOrRefreshTaskQueue({
    cwd: mkdtempSync(path.join(os.tmpdir(), 'atm-task-direction-queue-cycle-')),
    sourcePrompt: 'SKL cyclic ordering regression',
    tasks: [
        task({ workItemId: 'TASK-A', title: 'A', dependencies: ['TASK-B'] }),
        task({ workItemId: 'TASK-B', title: 'B', dependencies: ['TASK-A'] })
    ]
});
assert(JSON.stringify(cyclic.taskIds) === JSON.stringify(['TASK-A', 'TASK-B']), 'cyclic dependencies should fall back to original order instead of corrupting the queue');
console.log('[task-direction-queue.test] ok');
