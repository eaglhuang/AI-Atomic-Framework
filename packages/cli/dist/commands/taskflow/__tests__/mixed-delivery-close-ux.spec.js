import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildHistoricalClosePreflight } from '../historical-close-preflight.js';
import { buildSharedDeliveryWaiverCommand, buildTaskflowCloseWriteReadinessHint, prioritizeSharedHistoricalDeliveryBlockers } from '../write-readiness.js';
function writeJson(filePath, value) {
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function initGitRepo(repo) {
    mkdirSync(repo, { recursive: true });
    execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'validator@example.invalid'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'ATM Validator'], { cwd: repo, stdio: 'ignore' });
}
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-mixed-delivery-close-ux-'));
initGitRepo(repo);
const taskId = 'TASK-SHARED-0001';
const siblingFile = 'packages/cli/src/commands/sibling-task.ts';
writeJson(path.join(repo, '.atm/history/tasks', `${taskId}.json`), {
    workItemId: taskId,
    status: 'running',
    deliverables: ['packages/cli/src/commands/taskflow/write-readiness.ts'],
    scopePaths: ['packages/cli/src/commands/taskflow/**'],
    claim: {
        actorId: 'validator',
        leaseId: 'lease-shared',
        state: 'active'
    }
});
mkdirSync(path.join(repo, 'packages/cli/src/commands/taskflow'), { recursive: true });
mkdirSync(path.join(repo, 'packages/cli/src/commands'), { recursive: true });
writeFileSync(path.join(repo, siblingFile), 'export const sibling = true;\n', 'utf8');
writeFileSync(path.join(repo, 'packages/cli/src/commands/taskflow/write-readiness.ts'), 'export const ready = true;\n', 'utf8');
execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'shared delivery'], { cwd: repo, stdio: 'ignore' });
const historicalRef = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const taskDocument = {
    workItemId: taskId,
    status: 'running',
    deliverables: ['packages/cli/src/commands/taskflow/write-readiness.ts'],
    scopePaths: ['packages/cli/src/commands/taskflow/**'],
    claim: {
        actorId: 'validator',
        leaseId: 'lease-shared',
        state: 'active'
    }
};
const preflight = buildHistoricalClosePreflight({
    cwd: repo,
    taskId,
    actorId: 'validator',
    taskDocument,
    previewCommitBundle: {
        targetRepo: { repoRoot: repo, stageFiles: [] },
        planningRepo: { repoRoot: null, stageFiles: [] }
    },
    historicalDeliveryRefs: [historicalRef],
    waiverOutOfScopeDelivery: false,
    waiverReason: null
});
const mixedBlocker = preflight.blockers.find((entry) => entry.id === 'mixedDeliveryCommit');
assert.ok(mixedBlocker, 'preflight must surface mixed shared-delivery blocker');
assert.match(mixedBlocker.summary, /shared-delivery/i);
assert.match(mixedBlocker.summary, /not.*failed delivery|instead of treating/i);
assert.ok(mixedBlocker.multiTaskCloseRecipe?.includes('sibling'), 'preflight must include sibling hint');
assert.equal(mixedBlocker.requiredCommand, buildSharedDeliveryWaiverCommand({ taskId, actorId: 'validator', historicalRef }));
const writeHint = buildTaskflowCloseWriteReadinessHint({
    cwd: repo,
    taskId,
    actorId: 'validator',
    taskDocument,
    declaredFiles: ['packages/cli/src/commands/taskflow/write-readiness.ts'],
    closebackPlan: {
        writerBoundary: { planningMirrorPath: null },
        closebackPathResolution: null,
        historicalDeliveryGate: { required: false }
    },
    previewCommitBundle: { targetDeliveryFiles: [] },
    historicalDeliveryRefs: [historicalRef],
    planningAuthorityDeliveryGate: {
        required: false,
        ok: false,
        repoRoot: null,
        matchedFiles: [],
        reason: null
    }
});
const waiverBlocker = writeHint.blockers.find((entry) => entry.code === 'ATM_TASKFLOW_CLOSE_OUT_OF_SCOPE_WAIVER_REQUIRED');
assert.ok(waiverBlocker, 'write readiness must surface waiver blocker for shared delivery');
assert.match(waiverBlocker.summary, /shared-delivery/i);
assert.match(waiverBlocker.summary, /not a missing delivery/i);
const prioritized = prioritizeSharedHistoricalDeliveryBlockers([
    {
        code: 'ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED',
        summary: 'missing delivery',
        requiredCommand: 'node atm.mjs tasks close --task TASK-SHARED-0001 --json'
    },
    ...writeHint.blockers,
    ...preflight.blockers.map((entry) => ({
        code: entry.code,
        summary: entry.summary,
        requiredCommand: entry.requiredCommand,
        multiTaskCloseRecipe: entry.multiTaskCloseRecipe ?? null
    }))
], {
    taskId,
    actorId: 'validator',
    historicalDeliveryRef: historicalRef,
    outOfScopeFiles: mixedBlocker.files ?? []
});
assert.equal(prioritized[0]?.code, 'ATM_TASKFLOW_CLOSE_OUT_OF_SCOPE_WAIVER_REQUIRED');
assert.match(prioritized[0]?.summary ?? '', /shared-delivery/i);
assert.equal(prioritized[0]?.requiredCommand, buildSharedDeliveryWaiverCommand({ taskId, actorId: 'validator', historicalRef }));
assert.ok(!prioritized.some((entry) => entry.code === 'ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED'), 'deliverable diff must be demoted when historical shared delivery waiver is required');
console.log('[mixed-delivery-close-ux.spec] ok');
