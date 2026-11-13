import assert from 'node:assert/strict';
import { releaseTagMatchesSourceVersion } from '../../scripts/release-prepare.ts';

assert.equal(releaseTagMatchesSourceVersion('v0.1.28', '0.1.28'), true);
assert.equal(releaseTagMatchesSourceVersion('0.1.28', '0.1.28'), true);
assert.equal(releaseTagMatchesSourceVersion('v0.1.28-beta.1', '0.1.28'), true, 'prerelease tags publish the next stable train');
assert.equal(releaseTagMatchesSourceVersion('v0.1.28', '0.1.27'), false, 'source left behind the tag');
assert.equal(releaseTagMatchesSourceVersion('v0.1.27', '0.1.2'), false, 'prefix match is not a match');
assert.equal(releaseTagMatchesSourceVersion('v0.1.28', '0.1.28-beta.1'), false, 'source must hold a stable version');
assert.equal(releaseTagMatchesSourceVersion('not-a-tag', '0.1.28'), false);
console.log('release-prepare tag gate: ok');
