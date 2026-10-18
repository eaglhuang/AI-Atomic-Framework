import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildTaskflowCloseWriteReadinessHint } from '../../packages/cli/src/commands/taskflow/write-readiness.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-non-delivery-readiness-'));
const planningRepo = mkdtempSync(path.join(os.tmpdir(), 'atm-planning-delivery-readiness-'));
const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const planningGit = (...args: string[]) => execFileSync('git', ['-C', planningRepo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const taskId = 'TASK-DELIVERY';
const file = 'src/delivery.ts';
function readiness(refs: string[] = [], dirty: string[] = [], planningAuthority: string | null = null) {
  return buildTaskflowCloseWriteReadinessHint({
    cwd: repo, taskId, actorId: 'validator', taskDocument: { status: 'done' },
    declaredFiles: [file],
    closebackPlan: {
      writerBoundary: { planningMirrorPath: null }, closebackPathResolution: null,
      historicalDeliveryGate: { required: true }
    } as unknown as Parameters<typeof buildTaskflowCloseWriteReadinessHint>[0]['closebackPlan'],
    previewCommitBundle: { targetDeliveryFiles: dirty }, historicalDeliveryRefs: refs,
    waiverOutOfScopeDelivery: true, waiverReason: 'Scope waiver must not qualify WIP',
    planningAuthorityDeliveryGate: { required: Boolean(planningAuthority), ok: true, repoRoot: planningAuthority, matchedFiles: [], reason: null }
  });
}
function commit(message: string) {
  git('add', '--', file);
  git('-c', 'user.name=ATM Validator', '-c', 'user.email=validator@example.invalid', 'commit', '-m', message);
  return git('rev-parse', 'HEAD');
}
try {
  git('init');
  let hint = readiness();
  let missing = hint.blockers.find((item) => item.code === 'ATM_TASKFLOW_CLOSE_HISTORICAL_DELIVERY_REQUIRED');
  assert.ok(missing);
  assert.ok(!missing.summary.includes('already landed'), 'a clean worktree does not prove delivery');
  assert.ok(!missing.requiredCommand?.includes('--historical-delivery'), 'do not recommend an unverified commit placeholder');
  assert.ok(missing.requiredCommand?.includes('node atm.mjs next'), 'offer the governed resume route');

  mkdirSync(path.join(repo, 'src'));
  writeFileSync(path.join(repo, file), 'export const result = 1;\n');
  const wip = commit('preserve WIP\n\nATM-WIP: true\nATM-Delivery: false\nATM-Closeout-Eligible: false');
  hint = readiness();
  missing = hint.blockers.find((item) => item.code === 'ATM_TASKFLOW_CLOSE_HISTORICAL_DELIVERY_REQUIRED');
  assert.ok(missing && !missing.summary.includes('already landed'));
  assert.match(missing.summary, /WIP.*cannot/i, 'explain why the preserved snapshot cannot close');
  hint = readiness([wip]);
  assert.equal(hint.status, 'blocked');
  assert.ok(hint.blockers.some((item) => item.code === 'ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED' && /non-delivery/i.test(item.summary)), 'explicit WIP ref needs an actionable eligibility blocker');
  assert.ok(hint.blockers.every((item) => !item.requiredCommand?.includes(`--historical-delivery ${wip}`)), 'scope waiver must not suggest closing against WIP');

  assert.ok(readiness([], [file]).blockers.every((item) => item.code !== 'ATM_TASKFLOW_CLOSE_HISTORICAL_DELIVERY_REQUIRED'), 'real uncommitted work retains the normal delivery route');
  writeFileSync(path.join(repo, file), 'export const result = 2;\n');
  const formal = commit('finish the delivery');
  hint = readiness();
  missing = hint.blockers.find((item) => item.code === 'ATM_TASKFLOW_CLOSE_HISTORICAL_DELIVERY_REQUIRED');
  assert.ok(missing?.summary.includes(formal));
  assert.ok(missing?.requiredCommand?.includes(`--historical-delivery ${formal}`));
  assert.ok(readiness([formal]).blockers.every((item) => item.code !== 'ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED'));
  assert.ok(readiness([formal, wip]).blockers.some((item) => item.code === 'ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED'), 'every explicit ref must be checked, not only the first');

  // Planning-authority tasks have a distinct delivery repository. Readiness
  // must resolve refs where the close backend resolves them, never in target.
  planningGit('init');
  mkdirSync(path.join(planningRepo, 'src'));
  writeFileSync(path.join(planningRepo, file), 'export const planningDelivery = true;\n');
  planningGit('add', '--', file);
  planningGit('-c', 'user.name=ATM Validator', '-c', 'user.email=validator@example.invalid', 'commit', '-m', 'planning-authority delivery');
  const planningFormal = planningGit('rev-parse', 'HEAD');
  assert.ok(readiness([planningFormal], [], planningRepo).blockers.every((item) => item.code !== 'ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED'), 'a valid external planning delivery must not fail commit-not-found in the target repo');
  assert.ok(readiness([formal], [], planningRepo).blockers.some((item) => item.code === 'ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED'), 'a target-only commit must not substitute for planning authority');
  writeFileSync(path.join(planningRepo, file), 'export const planningDelivery = false;\n');
  planningGit('add', '--', file);
  planningGit('-c', 'user.name=ATM Validator', '-c', 'user.email=validator@example.invalid', 'commit', '-m', 'preserve planning WIP\n\nATM-Closeout-Eligible: false');
  const planningWip = planningGit('rev-parse', 'HEAD');
  assert.ok(readiness([planningWip], [], planningRepo).blockers.some((item) => item.code === 'ATM_TASK_CLOSE_DELIVERABLE_DIFF_REQUIRED' && /non-delivery/i.test(item.summary)), 'planning authority does not exempt WIP from the eligibility gate');
} finally {
  rmSync(repo, { recursive: true, force: true });
  rmSync(planningRepo, { recursive: true, force: true });
}
console.log('[taskflow-non-delivery-readiness:test] ok');
