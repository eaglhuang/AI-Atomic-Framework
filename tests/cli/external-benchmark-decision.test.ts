import assert from 'node:assert/strict';
import { executeExternalBenchmark } from '../../scripts/lib/external-benchmark/runner.ts';

const prerequisites = {
  publicNpm: { sealed: true, evidenceDigest: `sha256:${'a'.repeat(64)}` },
  hiddenCorpusAcceptance: { sealed: true, evidenceDigest: `sha256:${'b'.repeat(64)}` },
  independentAdjudication: { sealed: true, evidenceDigest: `sha256:${'c'.repeat(64)}` },
  providerTelemetry: { sealed: true, evidenceDigest: `sha256:${'d'.repeat(64)}` }
};
const unavailable = executeExternalBenchmark({ arms: { atm: { packageAvailability: 'unavailable', packageVersion: null, packageTarballSha256: null, workspaceLink: false } }, executionPrerequisites: prerequisites, runEligibility: { eligible: false, blockingReasons: ['published package is not sealed'] } }, [], []);
assert.equal(unavailable.verdict, 'inconclusive');
const missingIndependentEvidence = executeExternalBenchmark({ arms: { atm: { packageAvailability: 'sealed', packageVersion: '1.0.0', packageTarballSha256: `sha256:${'a'.repeat(64)}`, workspaceLink: false } }, executionPrerequisites: { ...prerequisites, providerTelemetry: { sealed: false, evidenceDigest: null } }, runEligibility: { eligible: true, blockingReasons: [] } }, [], []);
assert.equal(missingIndependentEvidence.verdict, 'inconclusive');
const absentPrerequisites = executeExternalBenchmark({ arms: { atm: { packageAvailability: 'sealed', packageVersion: '1.0.0', packageTarballSha256: `sha256:${'a'.repeat(64)}`, workspaceLink: false } }, executionPrerequisites: {} as typeof prerequisites, runEligibility: { eligible: true, blockingReasons: [] } }, [], []);
assert.equal(absentPrerequisites.verdict, 'inconclusive');
assert.throws(() => executeExternalBenchmark({ arms: { atm: { packageAvailability: 'sealed', packageVersion: '1.0.0', packageTarballSha256: `sha256:${'a'.repeat(64)}`, workspaceLink: false } }, executionPrerequisites: prerequisites, runEligibility: { eligible: true, blockingReasons: [] } }, [], []), /no raw runs for baseline/);
console.log('external-benchmark-decision ok');
