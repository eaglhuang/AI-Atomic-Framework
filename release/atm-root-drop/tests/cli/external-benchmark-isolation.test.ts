import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { authorizeCleanup, createCleanupReceipt, validateEnvironment, type EnvironmentSpec } from '../../scripts/lib/external-benchmark/isolation.ts';

const fixture = JSON.parse(readFileSync(new URL('../../scripts/fixtures/atm-external-benchmark/environment.json', import.meta.url), 'utf8')) as EnvironmentSpec;
const good = validateEnvironment(fixture);
assert.equal(good.ok, true); assert.equal(good.strength, 'isolated-internal');
const worktreeOnly = validateEnvironment({ ...fixture, mounts: { ...fixture.mounts, denied: ['oracle'] } });
assert.equal(worktreeOnly.ok, false); assert.equal(worktreeOnly.strength, 'worktree-only'); assert.match(worktreeOnly.violations.join(','), /other-run/);
const baseline = validateEnvironment({ ...fixture, arm: 'baseline', packageTarballDigest: null }); assert.equal(baseline.ok, true);
const invalidBaseline = validateEnvironment({ ...fixture, arm: 'baseline' }); assert.equal(invalidBaseline.ok, false); assert.match(invalidBaseline.violations.join(','), /baseline/);
const receipt = createCleanupReceipt('op-1', 'owner-1', ['tmp/run'], { 'tmp/run': 'sha256:old' });
assert.equal(authorizeCleanup(receipt, { 'tmp/run': 'sha256:old' }, 'owner-1').status, 'cleaned');
assert.throws(() => authorizeCleanup(receipt, { 'tmp/run': 'sha256:new' }, 'owner-1'), /changed/);
assert.throws(() => authorizeCleanup(receipt, { 'tmp/run': 'sha256:old' }, 'other-owner'), /owner/);
console.log('external-benchmark-isolation ok');
