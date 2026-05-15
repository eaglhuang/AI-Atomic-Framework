import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runEvolutionDemo } from '../src/evolution-target.atom.ts';

const dir = dirname(fileURLToPath(import.meta.url));
const exampleRoot = join(dir, '..');

const fixtures = [
  {
    path: join(exampleRoot, 'governance/demo-atom-spec-proposal.json'),
    expectedTargetSurface: 'atom-spec',
    expectedStatus: 'pending'
  },
  {
    path: join(exampleRoot, 'governance/demo-atom-map-proposal.json'),
    expectedTargetSurface: 'atom-map',
    expectedStatus: 'pending'
  },
  {
    path: join(exampleRoot, 'governance/demo-rejected-proposal.json'),
    expectedStatus: 'blocked',
    expectedBlockedGate: 'qualityComparison'
  },
  {
    path: join(exampleRoot, 'governance/demo-stale-proposal.json'),
    expectedStatus: 'blocked',
    expectedBlockedGate: 'staleProposal'
  }
];

for (const fixture of fixtures) {
  assert(existsSync(fixture.path), `Missing governance fixture: ${fixture.path}`);
  const doc = JSON.parse(readFileSync(fixture.path, 'utf8'));

  if (fixture.expectedTargetSurface) {
    assert.equal(
      doc.targetSurface,
      fixture.expectedTargetSurface,
      `${fixture.path}: expected targetSurface=${fixture.expectedTargetSurface}, got ${doc.targetSurface}`
    );
  }
  if (fixture.expectedStatus) {
    assert.equal(
      doc.status,
      fixture.expectedStatus,
      `${fixture.path}: expected status=${fixture.expectedStatus}, got ${doc.status}`
    );
  }
  if (fixture.expectedBlockedGate) {
    const gates: string[] = doc.automatedGates?.blockedGateNames ?? [];
    assert(
      gates.includes(fixture.expectedBlockedGate),
      `${fixture.path}: expected blockedGateNames to include ${fixture.expectedBlockedGate}, got [${gates.join(', ')}]`
    );
  }
}

const result = runEvolutionDemo();
assert.equal(result.ok, true, 'evolution demo must succeed');
assert.equal(result.cases, 4, 'evolution demo must exercise 4 governance cases');
assert.equal(result.atomId, 'ATM-EXAMPLE-0003', 'evolution demo must report the correct atom ID');

console.log('[example:evolution-loop] ok (evidence → proposal → review → decision)');
