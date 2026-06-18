import assert from 'node:assert/strict';
import { describeBuildReleaseHygienePolicy, shouldRetainReleaseArtifacts } from '../../scripts/build-release-hygiene.ts';

const previousRetain = process.env.ATM_RETAIN_RELEASE_ARTIFACTS;
try {
  delete process.env.ATM_RETAIN_RELEASE_ARTIFACTS;
  assert.equal(shouldRetainReleaseArtifacts(), false);

  process.env.ATM_RETAIN_RELEASE_ARTIFACTS = '1';
  assert.equal(shouldRetainReleaseArtifacts(), true);

  const policy = describeBuildReleaseHygienePolicy();
  assert.equal(policy.retainEnvVar, 'ATM_RETAIN_RELEASE_ARTIFACTS');
  assert.match(policy.validationSafeCommand, /build:packages/);
  assert.match(policy.runnerSyncCommand, /ATM_RETAIN_RELEASE_ARTIFACTS=1/);

  console.log('build-release-hygiene.test: ok');
} finally {
  if (previousRetain === undefined) {
    delete process.env.ATM_RETAIN_RELEASE_ARTIFACTS;
  } else {
    process.env.ATM_RETAIN_RELEASE_ARTIFACTS = previousRetain;
  }
}
