import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { replayState, sealReplayObservation, replayDogfoodSignals, type ReplayDogfoodSignal } from '../../packages/core/src/evidence/state-replay.ts';

const fixtureRoot = join(process.cwd(), 'tests', 'fixtures', 'governance-incidents');
const fixtures = readdirSync(fixtureRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => {
  const value = JSON.parse(readFileSync(join(fixtureRoot, entry.name, 'incident.json'), 'utf8')) as { semanticFamily: string };
  return value.semanticFamily;
}).sort();
const expectedFamilies = ['active-batch-router', 'close-deferral-derived-manifest', 'import-frontmatter-fidelity', 'runner-sync-protected-state', 'sealed-deletion-tombstone', 'shared-index-commit-attribution', 'stale-mixed-batch'];
assert.deepEqual(fixtures, expectedFamilies, 'every sealed incident fixture is present and catalogued by semantic family');
const digest = (seed: string) => `sha256:${createHash('sha256').update(seed).digest('hex')}`;
const signalFor = (family: string): ReplayDogfoodSignal | undefined => family === 'shared-index-commit-attribution' ? 'cross-lane-shared-index' : family === 'close-deferral-derived-manifest' ? 'close-deferral' : family === 'active-batch-router' ? 'active-batch-routing' : undefined;
const observations = fixtures.map((family, index) => {
  const binding = { sourceCommit: digest(`source-${index}`), runnerDigest: digest(`runner-${index}`), treeDigest: digest(`tree-${index}`), provenanceDigest: digest(`provenance-${index}`), fixtureDigest: digest(`fixture-${index}`), repairDigest: digest(`repair-${index}`) };
  const signal = signalFor(family);
  const input = { incidentId: `incident-${index}`, family, historical: true, supported: true, expected: binding, observed: binding, dogfoodWitness: signal ? { signal, laneIds: ['lane-left', 'lane-right'], eventDigest: digest(`event-${index}`) } : undefined };
  return { ...input, sealDigest: sealReplayObservation(input) };
});
const result = replayState({ authorityDigest: digest('authority'), observations, requiredFamilies: expectedFamilies, requiredDogfoodSignals: replayDogfoodSignals });
assert.equal(result.status, 'proven'); assert.deepEqual(result.observedDogfoodSignals, [...replayDogfoodSignals].sort());
const fixtureOnly = replayState({ authorityDigest: digest('authority'), observations: observations.map((item) => ({ ...item, dogfoodWitness: undefined, sealDigest: sealReplayObservation({ ...item, dogfoodWitness: undefined }) })), requiredFamilies: expectedFamilies, requiredDogfoodSignals: replayDogfoodSignals });
assert.equal(fixtureOnly.status, 'blocked'); assert.ok(fixtureOnly.diagnostics.some((entry) => entry.startsWith('required-dogfood-signal-missing:')));
const missing = replayState({ authorityDigest: digest('authority'), observations: observations.slice(0, -1), requiredFamilies: expectedFamilies });
assert.equal(missing.status, 'blocked'); assert.ok(missing.verdicts.some((entry) => entry.diagnostics.includes('required-family-missing')));
console.log('plan4 incident corpus: ok');
