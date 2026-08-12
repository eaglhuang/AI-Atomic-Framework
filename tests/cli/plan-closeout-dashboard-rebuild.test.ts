import assert from 'node:assert/strict';
import { buildPlanCloseoutDashboard, expectedFourPlanDenominators, type FourPlanObjectiveRow } from '../../packages/core/src/evidence/plan-closeout-dashboard.ts';

function rowsFor(planId: FourPlanObjectiveRow['planId'], count: number): FourPlanObjectiveRow[] {
  return Array.from({ length: count }, (_, index) => ({
    planId,
    objectiveId: `OBJ-${String(index + 1).padStart(2, '0')}`,
    status: 'verified',
    evidenceRefs: [`raw/${planId}/${index + 1}.json`],
    summary: 'fixture objective'
  }));
}

const denominators = expectedFourPlanDenominators();
const rows = [
  ...rowsFor('Plan 3.0', denominators['Plan 3.0']),
  ...rowsFor('Plan 3.1', denominators['Plan 3.1']),
  ...rowsFor('Plan 3.2', denominators['Plan 3.2']),
  ...rowsFor('Plan 4.0', denominators['Plan 4.0'])
];

const input = {
  generatedAt: '2026-01-01T00:00:00.000Z',
  producer: 'fixture',
  authorityDigest: 'sha256:authority',
  timeWindow: {
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:10:00.000Z',
    watermark: 'git-head:fixture'
  },
  rawArtifacts: [
    { path: 'b.json', digest: 'sha256:b', producedBy: 'validator-b' },
    { path: 'a.json', digest: 'sha256:a', producedBy: 'validator-a' }
  ],
  objectiveRows: rows,
  validatorLifecycleDigest: 'sha256:validator',
  closureDigest: 'sha256:closure',
  backlogDigest: 'sha256:backlog',
  governanceDigest: 'sha256:governance',
  claimDigest: 'sha256:claim'
};

const first = buildPlanCloseoutDashboard(input);
const second = buildPlanCloseoutDashboard({ ...input, rawArtifacts: [...input.rawArtifacts].reverse(), objectiveRows: [...rows].reverse() });

assert.equal(first.schemaId, 'atm.planCloseoutDashboard.v1');
assert.equal(first.readOnly, true);
assert.equal(first.readiness, 'ready');
assert.equal(first.staleCounterReuse, false);
assert.equal(first.digest, second.digest, 'dashboard rebuild must be byte-stable after input normalization');
assert.deepEqual(first.objectiveVerdict.observedDenominators, denominators);
assert.equal(first.blockers.length, 0);

const unavailable = buildPlanCloseoutDashboard({
  ...input,
  validatorLifecycleDigest: null,
  closureDigest: null,
  objectiveRows: rows.slice(1)
});
assert.equal(unavailable.readiness, 'not-ready');
assert.ok(unavailable.blockers.some((entry) => entry.includes('Plan 3.0 denominator')));
assert.ok(unavailable.blockers.some((entry) => entry.includes('performance')));
assert.ok(unavailable.blockers.some((entry) => entry.includes('closure')));

console.log('plan-closeout-dashboard-rebuild.test.ts: ok');
