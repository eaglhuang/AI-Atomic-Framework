import assert from 'node:assert/strict';
import {
  releaseVersionBase,
  releaseVersionSourcesAreCompatible,
  versionsMatchReleaseTrain
} from '../../scripts/lib/release-version-compatibility.ts';

assert.equal(releaseVersionBase('v0.1.0-beta.0'), '0.1.0');
assert.equal(releaseVersionBase('0.1.0+build.4'), '0.1.0');
assert.equal(releaseVersionBase('01.1.0'), null, 'invalid SemVer must fail closed');
assert.equal(releaseVersionBase('0.1'), null, 'partial versions must fail closed');

assert.equal(
  versionsMatchReleaseTrain('0.1.0', '0.1.0', { allowPrereleaseBase: false }),
  true,
  'ordinary validation must accept an exact stable version'
);
assert.equal(
  versionsMatchReleaseTrain('0.1.0', '0.1.0-beta.0', { allowPrereleaseBase: false }),
  false,
  'ordinary validation must not silently accept a prerelease'
);
assert.equal(
  versionsMatchReleaseTrain('v0.1.0-beta.0', '0.1.0-beta.0', { allowPrereleaseBase: true }),
  true,
  'release validation must accept the npm-versioned prerelease on the same train'
);
assert.equal(
  versionsMatchReleaseTrain('0.1.0', '0.1.1-beta.0', { allowPrereleaseBase: true }),
  false,
  'release validation must reject a different stable train'
);
assert.equal(
  releaseVersionSourcesAreCompatible({
    releaseTag: 'v0.1.0-beta.0',
    rootPackageVersion: '0.1.0-beta.0',
    releaseTrainVersion: '0.1.0',
    runtimeFrameworkVersion: '0.1.0'
  }),
  true,
  'a prerelease publish may compare npm-versioned manifests and frozen runtime metadata by stable train'
);
assert.equal(
  releaseVersionSourcesAreCompatible({
    releaseTag: 'v0.1.0-beta.0',
    rootPackageVersion: '0.1.0-beta.0',
    releaseTrainVersion: '0.1.0',
    runtimeFrameworkVersion: '0.1.1'
  }),
  false,
  'a frozen runtime from another release train must still block publication'
);

console.log('[release-version-compatibility:test] ok');
