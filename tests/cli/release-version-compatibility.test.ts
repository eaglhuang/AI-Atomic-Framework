import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const validatorSource = readFileSync(path.join(repositoryRoot, 'scripts', 'validate-version-compatibility.ts'), 'utf8');
const releaseWorkflow = readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'release-npm.yml'), 'utf8');
assert.match(validatorSource, /process\.env\.ATM_RELEASE_TAG/, 'release compatibility must consume the workflow-provided tag when run through the full validator profile');
assert.match(releaseWorkflow, /ATM_RELEASE_TAG="\$release_version" npm run validate:full/, 'post-publish full validation must pass its resolved release tag into the validator process');

console.log('[release-version-compatibility:test] ok');
