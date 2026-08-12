import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { evaluatePhaseSuitePromotion } from '../../packages/core/src/evidence/phase-suite.ts';
import { compileQualityAuthority, validateQualityAuthority } from '../../packages/core/src/evidence/quality-authority.ts';
import { replayState, replayDogfoodSignals, sealReplayObservation, type ReplayDogfoodSignal } from '../../packages/core/src/evidence/state-replay.ts';

const root = process.cwd();
const reportPath = join(root, 'docs', 'reports', 'plan-4-foundation-replay.json');
assert.equal(existsSync(reportPath), true, 'Plan 4 foundation replay artifact must exist');

const report = JSON.parse(readFileSync(reportPath, 'utf8'));
assert.equal(report.schemaId, 'atm.plan4FoundationReplay.v1');
assert.equal(report.taskId, 'ATM-GOV-0336');
assert.equal(report.plan4ObjectiveDenominator.expected, 17);
assert.equal(report.plan4ObjectiveDenominator.observed, 17);
assert.equal(report.objectiveAnchors.length, 17);
assert.equal(new Set(report.objectiveAnchors.map((row: any) => row.objectiveId)).size, 17);
assert.ok(report.objectiveAnchors.every((row: any) => row.status === 'not-complete'), 'foundation replay must remain fail-closed');
assert.ok(report.nonClaims.includes('foundation-replay-is-not-final-plan4-certification'));

const phaseReport = evaluatePhaseSuitePromotion({
  checkpoint: 'plan-verdict',
  requiredPhaseCaseIds: report.phaseSuite.requiredCaseIds,
  receipts: report.phaseSuite.satisfiedCaseIds.map((caseId: string) => ({
    caseId,
    status: 'passed',
    gitHead: 'foundation-head',
    observedAt: '2026-08-12T18:35:00.000Z',
    cacheDecision: 'cache-miss',
    durationMs: 1
  })),
  gitHead: 'foundation-head',
  now: '2026-08-12T18:35:01.000Z',
  catalogPhaseCaseCount: report.phaseSuite.catalogPhaseCaseCount
});
assert.equal(phaseReport.ok, true);
assert.equal(phaseReport.promotionAllowed, true);
assert.deepEqual(phaseReport.blockers, []);

const authority = compileQualityAuthority({
  authorityId: report.qualityAuthority.authorityId,
  policyEpoch: report.qualityAuthority.policyEpoch,
  expectedPolicyEpoch: report.qualityAuthority.policyEpoch,
  policyDigest: digest('policy'),
  oracleDigest: digest('oracle'),
  denominatorDigest: digest('denominator'),
  verdictDigest: digest('verdict'),
  protectedSurfaces: report.qualityAuthority.protectedSurfaces,
  observedProtectedSurfaces: report.qualityAuthority.protectedSurfaces,
  roleCapabilities: {
    writer: ['evidence'],
    policy: ['policy'],
    oracle: ['oracle'],
    denominator: ['denominator'],
    verdict: ['verdict']
  },
  writerRole: 'writer'
});
assert.equal(authority.status, 'proven');
assert.equal(validateQualityAuthority(authority).ok, true);

const fixtureRoot = join(root, 'tests', 'fixtures', 'governance-incidents');
const families = readdirSync(fixtureRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => JSON.parse(readFileSync(join(fixtureRoot, entry.name, 'incident.json'), 'utf8')).semanticFamily)
  .sort();
assert.deepEqual(families, [...report.incidentCorpus.requiredFamilies].sort());

const observations = families.map((family: string, index: number) => {
  const binding = {
    sourceCommit: digest(`source-${index}`),
    runnerDigest: digest(`runner-${index}`),
    treeDigest: digest(`tree-${index}`),
    provenanceDigest: digest(`provenance-${index}`),
    fixtureDigest: digest(`fixture-${index}`),
    repairDigest: digest(`repair-${index}`)
  };
  const signal = dogfoodSignalFor(family);
  const observation = {
    incidentId: `incident-${index}`,
    family,
    historical: true,
    supported: true,
    expected: binding,
    observed: binding,
    dogfoodWitness: signal ? { signal, laneIds: ['lane-a', 'lane-b'], eventDigest: digest(`event-${index}`) } : undefined
  };
  return { ...observation, sealDigest: sealReplayObservation(observation) };
});
const replay = replayState({
  authorityDigest: authority.authorityDigest,
  observations,
  requiredFamilies: report.incidentCorpus.requiredFamilies,
  requiredDogfoodSignals: replayDogfoodSignals
});
assert.equal(replay.status, 'proven');
assert.deepEqual(replay.observedDogfoodSignals, [...report.incidentCorpus.requiredDogfoodSignals].sort());
assert.ok(replay.nonClaims.includes('replay-does-not-authorize-plan4-close'));

const authorityShard = JSON.parse(readFileSync(join(root, 'tests', 'catalog', 'groups', 'test_group_plan4_authority_foundation.shard.json'), 'utf8'));
const incidentShard = JSON.parse(readFileSync(join(root, 'tests', 'catalog', 'groups', 'test_group_plan4_incident_replay.shard.json'), 'utf8'));
const topologyShard = JSON.parse(readFileSync(join(root, 'tests', 'catalog', 'groups', 'test_group_plan4_foundation_topology.shard.json'), 'utf8'));
const catalogCaseIds = [...authorityShard.cases, ...incidentShard.cases, ...topologyShard.cases].map((entry: any) => entry.caseId).sort();
assert.deepEqual(catalogCaseIds, [...report.phaseSuite.requiredCaseIds].sort(), 'foundation phase suite must match catalog shard case ids');

console.log('plan4 foundation topology: ok');

function dogfoodSignalFor(family: string): ReplayDogfoodSignal | undefined {
  if (family === 'shared-index-commit-attribution') return 'cross-lane-shared-index';
  if (family === 'close-deferral-derived-manifest') return 'close-deferral';
  if (family === 'active-batch-router') return 'active-batch-routing';
  return undefined;
}

function digest(seed: string): string {
  return `sha256:${createHash('sha256').update(seed).digest('hex')}`;
}
