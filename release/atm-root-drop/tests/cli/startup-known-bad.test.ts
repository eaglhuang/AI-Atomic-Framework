import assert from 'node:assert/strict';
import {
  isSemverVersion,
  isSupportedKnownBadRange,
  matchesKnownBadRange
} from '../../packages/cli/src/startup-known-bad.ts';

assert.equal(isSemverVersion('0.1.0-beta.1'), true);
assert.equal(isSemverVersion('0.1.0+build.8'), true);
assert.equal(isSupportedKnownBadRange('>0.1.0-beta.0 <0.1.0-beta.2'), true);

// An exact prerelease denial must not lock the stable source runner. This
// regression blocked the governed commit that introduced the beta.1 entry.
assert.equal(matchesKnownBadRange('0.1.0', '>0.1.0-beta.0 <0.1.0-beta.2'), false);
assert.equal(matchesKnownBadRange('0.1.0-beta.1', '>0.1.0-beta.0 <0.1.0-beta.2'), true);
assert.equal(matchesKnownBadRange('0.1.0-beta.2', '>0.1.0-beta.0 <0.1.0-beta.2'), false);
assert.equal(matchesKnownBadRange('0.1.0-beta.1+build.8', '>0.1.0-beta.0 <0.1.0-beta.2'), true);
assert.equal(matchesKnownBadRange('0.1.0-beta.10', '>=0.1.0-beta.2'), true);
assert.equal(matchesKnownBadRange('0.1.0-beta.1', '>=0.1.0-beta.2'), false);

console.log('startup-known-bad tests passed');
