import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { replayState, sealReplayObservation, validateStateReplay, type ReplayObservation } from '../../packages/core/src/evidence/state-replay.ts';

const digest = (seed: string) => `sha256:${createHash('sha256').update(seed).digest('hex')}`;
function observation(overrides: Partial<Omit<ReplayObservation, 'sealDigest'>> = {}): ReplayObservation {
  const base = {
    incidentId: 'shared-index-observation', family: 'shared-index-commit-attribution', historical: true, supported: true,
    expected: { sourceCommit: digest('c'), runnerDigest: digest('r'), treeDigest: digest('t'), provenanceDigest: digest('p'), fixtureDigest: digest('f'), repairDigest: digest('repair') },
    observed: { sourceCommit: digest('c'), runnerDigest: digest('r'), treeDigest: digest('t'), provenanceDigest: digest('p'), fixtureDigest: digest('f'), repairDigest: digest('repair') },
    dogfoodWitness: { signal: 'cross-lane-shared-index' as const, laneIds: ['lane-a', 'lane-b'], eventDigest: digest('event') },
    ...overrides,
  };
  return { ...base, sealDigest: sealReplayObservation(base) };
}

const green = replayState({ authorityDigest: digest('authority'), observations: [observation()], requiredFamilies: ['shared-index-commit-attribution'] });
assert.equal(green.status, 'proven'); assert.equal(green.verdicts[0].verdict, 'repaired'); assert.equal(validateStateReplay(green).ok, true);

const stale = observation({ observed: { ...observation().observed, sourceCommit: digest('other') } });
assert.equal(replayState({ authorityDigest: digest('authority'), observations: [stale] }).verdicts[0].verdict, 'stale');
const regressed = observation({ observed: { ...observation().observed, repairDigest: digest('regressed') } });
assert.equal(replayState({ authorityDigest: digest('authority'), observations: [regressed] }).verdicts[0].verdict, 'regressed');
const fixtureOnly = observation({ fixtureOnly: true, dogfoodWitness: undefined });
assert.equal(replayState({ authorityDigest: digest('authority'), observations: [fixtureOnly] }).verdicts[0].verdict, 'unsupported');
const forged = { ...observation(), sealDigest: digest('forged') };
assert.equal(replayState({ authorityDigest: digest('authority'), observations: [forged] }).verdicts[0].verdict, 'forged');
const tamperedResult = { ...green, diagnostics: ['tampered'] };
assert.equal(validateStateReplay(tamperedResult).ok, false, 'result digest binds replay output');
console.log('plan4 state replay: ok');
