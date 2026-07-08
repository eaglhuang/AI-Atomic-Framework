import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTaskflowCloseWriteReadinessHint } from '../write-readiness.js';
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
const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-write-readiness-'));
initGitRepo(repo);
writeJson(path.join(repo, '.atm/runtime/write-broker.registry.json'), {
    schemaId: 'atm.writeBrokerRegistry.v1',
    specVersion: '0.1.0',
    repoId: 'fixture',
    workspaceId: 'main',
    currentEpoch: 2,
    activeIntents: [
        {
            intentId: 'intent-self',
            taskId: 'TASK-WRITE-0001',
            actorId: 'validator',
            baseCommit: 'base',
            resourceKeys: {
                files: ['src/app.ts'],
                atomIds: ['ATOM-SELF'],
                atomCids: ['CID-SELF'],
                generators: [],
                projections: [],
                registries: [],
                validators: [],
                artifacts: []
            },
            leaseEpoch: 2,
            leaseSeconds: 1800,
            leaseMaxSeconds: 1800,
            heartbeatAt: '2026-06-20T00:00:00.000Z',
            lane: 'direct-brokered',
            expiresAt: '2099-01-01T00:00:00.000Z'
        },
        {
            intentId: 'intent-foreign',
            taskId: 'TASK-WRITE-FOREIGN',
            actorId: 'other',
            baseCommit: 'base',
            resourceKeys: {
                files: ['src/app.ts'],
                atomIds: ['ATOM-FOREIGN'],
                atomCids: ['CID-FOREIGN'],
                generators: [],
                projections: [],
                registries: [],
                validators: [],
                artifacts: []
            },
            leaseEpoch: 1,
            leaseSeconds: 1800,
            leaseMaxSeconds: 1800,
            heartbeatAt: '2026-06-20T00:00:00.000Z',
            lane: 'direct-brokered',
            expiresAt: '2099-01-01T00:00:00.000Z'
        }
    ]
});
const hint = buildTaskflowCloseWriteReadinessHint({
    cwd: repo,
    taskId: 'TASK-WRITE-0001',
    actorId: 'validator',
    taskDocument: {
        status: 'done',
        claim: {
            state: 'released',
            actorId: 'validator',
            leaseId: 'lease-1'
        }
    },
    declaredFiles: ['src/app.ts'],
    closebackPlan: {
        writerBoundary: { planningMirrorPath: null },
        closebackPathResolution: null,
        historicalDeliveryGate: { required: false }
    },
    previewCommitBundle: {
        targetDeliveryFiles: []
    },
    historicalDeliveryRefs: [],
    planningAuthorityDeliveryGate: {
        required: false,
        ok: false,
        repoRoot: null,
        matchedFiles: [],
        reason: null
    }
});
assert.equal(hint.brokerConflictGate.verdict, 'takeoverRequired');
assert.ok(hint.blockers.some((entry) => entry.code === 'ATM_TASKFLOW_CLOSE_BROKER_TAKEOVER_REQUIRED'));
// ATM-BUG-2026-07-07-050: a stale/unresolvable closeback planning path (route
// 'missing' or 'ambiguous') used to only fail at `--write` time via
// assertClosebackPlanningPathReady(), while dry-run's write-readiness hint had
// no matching blocker and reported `ready`. Confirm the hint now surfaces the
// same failure dry-run sees, so `--write` cannot fail in a way dry-run did not
// already disclose.
const staleClosebackHint = buildTaskflowCloseWriteReadinessHint({
    cwd: repo,
    taskId: 'TASK-WRITE-0002',
    actorId: 'validator',
    taskDocument: {
        status: 'done',
        claim: {
            state: 'released',
            actorId: 'validator',
            leaseId: 'lease-2'
        }
    },
    declaredFiles: ['src/app.ts'],
    closebackPlan: {
        writerBoundary: { planningMirrorPath: null },
        closebackPathResolution: {
            route: 'missing',
            planningMirrorPath: null,
            profileRepoRoot: null,
            planningStatus: null,
            diagnostics: {
                codes: ['ATM_TASKFLOW_CLOSE_PLANNING_PATH_MISSING'],
                messages: ['Planning card path from source.planPath does not exist: docs/tasks/TASK-WRITE-0002.task.md.']
            }
        },
        historicalDeliveryGate: { required: false }
    },
    previewCommitBundle: {
        targetDeliveryFiles: []
    },
    historicalDeliveryRefs: [],
    planningAuthorityDeliveryGate: {
        required: false,
        ok: false,
        repoRoot: null,
        matchedFiles: [],
        reason: null
    }
});
assert.equal(staleClosebackHint.status, 'blocked', 'dry-run must report blocked when the closeback path route is missing, matching what --write would throw');
assert.ok(staleClosebackHint.blockers.some((entry) => entry.code === 'ATM_TASKFLOW_CLOSE_PLANNING_PATH_MISSING'), 'dry-run blockers must include the same code assertClosebackPlanningPathReady() would throw at --write time');
console.log('ok: write readiness spec passed');
