import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBatch } from '../batch.js';
import { writeBatchRun } from '../work-channels.js';
import { createOrRefreshTaskQueue } from '../task-direction.js';
function writeJson(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function makeTask(taskId) {
    return {
        workItemId: taskId,
        title: taskId,
        dependencies: [],
        taskPath: `.atm/history/tasks/${taskId}.json`,
        sourcePlanPath: null,
        nearbyPlanPaths: [],
        scopePaths: ['packages/cli/src/commands/batch.ts'],
        targetRepo: null,
        allowPlanningMirror: false
    };
}
const repo = mkdtempSync(path.join(os.tmpdir(), 'batch-skip-resume-'));
try {
    execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'batch-test'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'batch-test@example.test'], { cwd: repo, stdio: 'ignore' });
    writeFileSync(path.join(repo, 'README.md'), 'batch fixture\n', 'utf8');
    execFileSync('git', ['add', 'README.md'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: repo, stdio: 'ignore' });
    const tasks = [makeTask('TASK-SKIP-A'), makeTask('TASK-SKIP-B')];
    for (const task of tasks) {
        writeJson(path.join(repo, task.taskPath), {
            schemaVersion: 'atm.workItem.v0.2',
            workItemId: task.workItemId,
            title: task.title,
            status: 'ready',
            scopePaths: task.scopePaths,
            deliverables: task.scopePaths,
            validators: ['npm run typecheck']
        });
    }
    const queue = createOrRefreshTaskQueue({
        cwd: repo,
        sourcePrompt: 'batch skip resume fixture',
        tasks,
        actorId: 'validator',
        taskIds: tasks.map((task) => task.workItemId)
    });
    const batchRun = writeBatchRun({
        cwd: repo,
        sourcePrompt: 'batch skip resume fixture',
        tasks,
        queue,
        actorId: 'validator'
    });
    createOrRefreshTaskQueue({
        cwd: repo,
        sourcePrompt: 'batch skip resume fixture',
        tasks,
        actorId: 'validator',
        taskIds: tasks.map((task) => task.workItemId),
        batchId: batchRun.batchId,
        scopeKey: batchRun.scopeKey
    });
    const skipResult = await runBatch([
        'skip',
        '--cwd',
        repo,
        '--actor',
        'validator',
        '--batch',
        batchRun.batchId,
        '--task',
        'TASK-SKIP-A',
        '--reason',
        'external dependency blocked',
        '--json'
    ]);
    assert.equal(skipResult.ok, true, 'batch skip must succeed');
    assert.equal(skipResult.evidence?.batchRun?.currentTaskId, 'TASK-SKIP-B');
    assert.equal(skipResult.evidence?.skippedTask?.taskId, 'TASK-SKIP-A');
    assert.match(String(skipResult.messages?.[0]?.code ?? ''), /ATM_BATCH_TASK_SKIPPED/);
    const resumeResult = await runBatch([
        'resume',
        '--cwd',
        repo,
        '--actor',
        'validator',
        '--batch',
        batchRun.batchId,
        '--task',
        'TASK-SKIP-A',
        '--json'
    ]);
    assert.equal(resumeResult.ok, true, 'batch resume must restore skipped task');
    assert.equal(resumeResult.evidence?.after?.currentTaskId, 'TASK-SKIP-A');
    assert.deepEqual(resumeResult.evidence?.after?.skippedTasks ?? [], []);
    const skipEventDir = path.join(repo, '.atm', 'history', 'task-events', 'TASK-SKIP-A');
    const skipEvent = readFileSync(path.join(skipEventDir, readdirName(skipEventDir, 'batch-skip')), 'utf8');
    assert.match(skipEvent, /"action": "batch-skip"/);
    const emptyRepo = mkdtempSync(path.join(os.tmpdir(), 'batch-historical-batch-usage-'));
    let historicalBatchCheckpointCode = null;
    try {
        await runBatch([
            'checkpoint',
            '--cwd',
            emptyRepo,
            '--actor',
            'validator',
            '--historical-batch',
            'hist-batch-missing',
            '--json'
        ]);
    }
    catch (error) {
        historicalBatchCheckpointCode = error?.code ?? null;
    }
    rmSync(emptyRepo, { recursive: true, force: true });
    assert.equal(historicalBatchCheckpointCode, 'ATM_BATCH_RUN_MISSING', 'batch checkpoint should parse --historical-batch before batch selection');
    console.log('[batch-skip-resume.spec] ok');
}
finally {
    rmSync(repo, { recursive: true, force: true });
}
function readdirName(dir, action) {
    return readdirSync(dir).find((entry) => entry.includes(action));
}
