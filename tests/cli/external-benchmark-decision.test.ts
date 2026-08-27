import assert from 'node:assert/strict';
import { executeExternalBenchmark } from '../../scripts/lib/external-benchmark/runner.ts';

const unavailable = executeExternalBenchmark({ arms: { atm: { packageAvailability: 'unavailable', packageVersion: null, packageTarballSha256: null, workspaceLink: false } }, runEligibility: { eligible: false, blockingReasons: ['published package is not sealed'] } }, [], []);
assert.equal(unavailable.verdict, 'inconclusive');
assert.throws(() => executeExternalBenchmark({ arms: { atm: { packageAvailability: 'sealed', packageVersion: '1.0.0', packageTarballSha256: `sha256:${'a'.repeat(64)}`, workspaceLink: false } }, runEligibility: { eligible: true, blockingReasons: [] } }, [], []), /no raw runs for baseline/);
console.log('external-benchmark-decision ok');
