import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDeclaredEvidenceCounters } from '../../scripts/run-validators/implementation.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const config = JSON.parse(readFileSync(path.join(root, 'scripts/validators.config.json'), 'utf8'));
const validator = config.validators.find((entry: any) => entry.name === 'validate-next-warm-run-latency');

assert.ok(validator, 'the warm-run latency validator must remain registered');
assert.equal(
  validator.executionMode,
  'exclusive',
  'a validator that builds package dist and release artifacts must not share a parallel batch',
);
assert.equal(validator.parallelSafe, false);
assert.deepEqual(
  validator.resourceLocks,
  ['release-mirrors', 'package-dist'],
  'the validator must declare every shared write surface used by its measurement build',
);
assert.equal(validator.resourceProfile, 'release-mirror');
assert.deepEqual(validator.evidenceContract, {
  kind: 'command-contract',
  caseCount: 1,
  assertionCount: 1,
});

assert.deepEqual(
  resolveDeclaredEvidenceCounters(validator, 0),
  { caseCount: 1, assertionCount: 1 },
  'a successful declared command contract must provide executable evidence counters',
);
assert.deepEqual(
  resolveDeclaredEvidenceCounters(validator, 1),
  { caseCount: 0, assertionCount: 0 },
  'a failed command must never manufacture evidence counters',
);
assert.deepEqual(
  resolveDeclaredEvidenceCounters({ evidenceContract: { kind: 'command-contract', caseCount: 0, assertionCount: 1 } }, 0),
  { caseCount: 0, assertionCount: 0 },
  'invalid declared counts remain fail-closed',
);

console.log('[validator-scheduler-resource-contract] ok');
