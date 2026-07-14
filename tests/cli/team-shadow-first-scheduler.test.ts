import assert from 'node:assert/strict';
import {
  createShadowContribution,
  createTeamShadowSchedule
} from '../../packages/cli/src/commands/team/scheduler.ts';

const schedule = createTeamShadowSchedule({
  taskId: 'ATM-GOV-0135',
  baseCommit: 'abc123base',
  scopeEpoch: 7,
  catalogVersion: '2026-07-14.standard',
  fanOutCap: 2,
  spendingCeiling: 0.25,
  quotaProbeDigest: `sha256:${'1'.repeat(64)}`,
  acceptanceCriteria: ['shadow workspace only', 'clean reviewer barrier'],
  cleanContextReviewer: true,
  workGroups: [
    { groupId: 'impl', role: 'implementer', independent: true, allowedFiles: ['src/a.ts'], capability: 'code' },
    { groupId: 'notes', role: 'note-taker', independent: false, allowedFiles: ['docs/a.md'], capability: 'light' },
    { groupId: 'triage', role: 'triager', independent: false, allowedFiles: ['docs/b.md'], capability: 'light', dependencies: ['impl'] }
  ],
  modelOptions: [
    { providerId: 'openai', modelId: 'gpt-5.4-mini', plan: 'standard', capability: 'code', costPerUnit: 1.5 },
    { providerId: 'gemini-direct', modelId: 'gemini-3.5-flash', plan: 'paid', capability: 'light', costPerUnit: 0.25 }
  ]
});

assert.equal(schedule.shadowOnly, true);
assert.equal(schedule.reservations.length, 2);
assert.equal(schedule.reservations.some((reservation) => reservation.collapsedExecutor), true);
assert.equal(schedule.reservations[0].sealedInputs.baseCommit, 'abc123base');
assert.equal(schedule.reservations[0].sealedInputs.scopeEpoch, 7);
assert.equal(schedule.reservations[0].reversible, true);
assert.equal(schedule.dagStreamingReadyGroups.includes('impl'), true);
assert.equal(schedule.dagStreamingReadyGroups.includes('notes+triage'), false);
assert.equal(schedule.reviewerLane?.cleanContext, true);
assert.equal(schedule.reviewerLane?.barrierRequired, true);
assert.equal(schedule.rosterFingerprint.pricingCatalogVersion, '2026-07-14.standard');
assert.equal(schedule.rosterFingerprint.fanOutCap, 2);
assert.equal(schedule.rosterFingerprint.providerModelPlan.includes('gemini-direct:gemini-3.5-flash:paid'), true);

const contribution = createShadowContribution({
  taskId: 'ATM-GOV-0135',
  reservation: schedule.reservations[0],
  overlay: { patch: 'diff --git a/src/a.ts b/src/a.ts' },
  changedFiles: ['src/a.ts'],
  reviewerLane: schedule.reviewerLane
});

assert.equal(contribution.baseCommit, 'abc123base');
assert.match(contribution.overlayDigest, /^sha256:[a-f0-9]{64}$/);
assert.equal(contribution.reviewerReceipt?.cleanContext, true);
assert.deepEqual(contribution.reviewerReceipt?.readSet, ['base', 'contribution-manifest', 'diff', 'required-dependencies', 'acceptance-criteria', 'reviewer-context-manifest']);

console.log('[team-shadow-first-scheduler] ok');
