/**
 * TASK-RFT-0010 spec — tasks.status.triangulation.
 *
 * Covers truth-aligned / planning-live mismatch / residue routing.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildPlanningMirrorParityOverride, hasOnlyStatusDivergence, isOpenPlanningParityStatus, normalizeParityLifecycleValue, resolvePlanningCardPath } from '../status-triangulation.js';
function fail(message) {
    console.error(`[status-triangulation.spec] ${message}`);
    process.exitCode = 1;
    throw new Error(message);
}
function assert(condition, message) {
    if (!condition)
        fail(message);
}
// --- normalization ---
assert(normalizeParityLifecycleValue('In-Progress') === 'in_progress', 'normalization lowercases and replaces hyphens');
assert(normalizeParityLifecycleValue('  ') === null, 'whitespace-only normalizes to null');
assert(normalizeParityLifecycleValue(null) === null, 'null pass-through');
assert(isOpenPlanningParityStatus('in_progress'), 'in_progress is an open lifecycle');
assert(!isOpenPlanningParityStatus('done'), 'done is not an open lifecycle');
assert(!isOpenPlanningParityStatus(null), 'null is not an open lifecycle');
// --- divergence shape ---
assert(!hasOnlyStatusDivergence([]), 'empty divergence is not status-only');
const onlyStatus = [{ field: 'status', liveLedger: 'open' }];
assert(hasOnlyStatusDivergence(onlyStatus), 'single status entry is status-only');
const mixed = [
    { field: 'status', liveLedger: 'open' },
    { field: 'claimState', liveLedger: 'active' }
];
assert(!hasOnlyStatusDivergence(mixed), 'mixed divergence is not status-only');
// --- truth-aligned: no divergence → no override ---
const aligned = buildPlanningMirrorParityOverride({
    taskId: 'TASK-X',
    liveLedger: { status: 'in_progress', claimState: 'active', lastTransitionId: null, lastTransitionAt: null },
    planningFrontmatter: { status: 'in_progress', source: null },
    lastTransitionEvent: null,
    divergence: []
});
assert(aligned === null, 'truth-aligned state should not emit parity override');
// --- planning-live mismatch with active claim → no-residue advisory override ---
const activeClaimOverride = buildPlanningMirrorParityOverride({
    taskId: 'TASK-Y',
    liveLedger: { status: 'in_progress', claimState: 'active', lastTransitionId: null, lastTransitionAt: null },
    planningFrontmatter: { status: 'planned', source: 'docs/plan.md' },
    lastTransitionEvent: null,
    divergence: [{ field: 'status', liveLedger: 'in_progress', planningFrontmatter: 'planned' }]
});
assert(activeClaimOverride !== null, 'active-claim drift should emit override');
assert(activeClaimOverride.residueClassification.bucket === 'no-residue', 'override should route to no-residue bucket');
assert(activeClaimOverride.recommendation === null, 'override should suppress reconcile recommendation');
assert(activeClaimOverride.residueClassification.nextCommand.includes('TASK-Y'), 'next-command should embed the task id');
// --- planning-live mismatch with released predecessor → no-residue advisory override ---
const releasedOverride = buildPlanningMirrorParityOverride({
    taskId: 'TASK-Z',
    liveLedger: { status: 'open', claimState: 'released', lastTransitionId: null, lastTransitionAt: null },
    planningFrontmatter: { status: 'in_progress', source: 'docs/plan.md' },
    lastTransitionEvent: null,
    divergence: [{ field: 'status', liveLedger: 'open', planningFrontmatter: 'in_progress' }]
});
assert(releasedOverride !== null, 'released-predecessor drift should emit override');
assert(releasedOverride.residueClassification.truth.includes('release'), 'override should explain release lane');
// --- mismatch outside lifecycle scope → no override ---
const doneVsOpen = buildPlanningMirrorParityOverride({
    taskId: 'TASK-W',
    liveLedger: { status: 'done', claimState: 'released', lastTransitionId: null, lastTransitionAt: null },
    planningFrontmatter: { status: 'in_progress', source: 'docs/plan.md' },
    lastTransitionEvent: null,
    divergence: [{ field: 'status', liveLedger: 'done', planningFrontmatter: 'in_progress' }]
});
assert(doneVsOpen === null, 'closed live ledger should not be parity-overridden');
// --- mixed divergence falls through to standard residue routing ---
const mixedDivergenceOverride = buildPlanningMirrorParityOverride({
    taskId: 'TASK-Q',
    liveLedger: { status: 'in_progress', claimState: 'active', lastTransitionId: null, lastTransitionAt: null },
    planningFrontmatter: { status: 'planned', source: 'docs/plan.md' },
    lastTransitionEvent: null,
    divergence: [
        { field: 'status', liveLedger: 'in_progress', planningFrontmatter: 'planned' },
        { field: 'claimState', liveLedger: 'active' }
    ]
});
assert(mixedDivergenceOverride === null, 'mixed-field divergence should not be silently overridden');
// --- planning root-relative source.planPath resolves through ATM_PLANNING_REPO_ROOT ---
const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-status-triangulation-'));
try {
    const targetRepo = path.join(tempRoot, 'target');
    const planningRoot = path.join(tempRoot, 'planning', 'docs', 'ai_atomic_framework');
    const planningCard = path.join(planningRoot, 'rft-hardening', 'tasks', 'TASK-RFT-0004.task.md');
    mkdirSync(path.dirname(planningCard), { recursive: true });
    mkdirSync(targetRepo, { recursive: true });
    writeFileSync(planningCard, '---\nstatus: done\n---\n# TASK-RFT-0004\n', 'utf8');
    const previousPlanningRoot = process.env.ATM_PLANNING_REPO_ROOT;
    process.env.ATM_PLANNING_REPO_ROOT = planningRoot;
    try {
        const resolved = resolvePlanningCardPath(targetRepo, {
            source: {
                planPath: 'rft-hardening/tasks/TASK-RFT-0004.task.md'
            }
        });
        assert(resolved === planningCard, 'source.planPath must resolve relative to ATM_PLANNING_REPO_ROOT when repo-local path is absent');
    }
    finally {
        if (previousPlanningRoot === undefined) {
            delete process.env.ATM_PLANNING_REPO_ROOT;
        }
        else {
            process.env.ATM_PLANNING_REPO_ROOT = previousPlanningRoot;
        }
    }
}
finally {
    rmSync(tempRoot, { recursive: true, force: true });
}
console.log('[status-triangulation.spec] ok');
