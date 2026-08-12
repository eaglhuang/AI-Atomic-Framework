import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync('docs/reports/plan-3x-4x-backlog-deferred-waiver-register.json', 'utf8'));

assert.equal(report.schemaId, 'atm.backlogDeferredWaiverRegister.v1');
assert.equal(report.status, 'waived-for-release-closeout');
assert.equal(report.totals.waivedUnownedDeferred, 133);
assert.equal(report.totals.releaseBlockingNow, 0);
assert.equal(report.waiverAuthority.followUpRequired, true);
assert.ok(report.waiverAuthority.mustNotClaim.includes('bugs-fixed'));

const output = JSON.parse(
  execFileSync('node', ['--strip-types', 'scripts/validate-backlog-deferred-waiver-register.ts', '--json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  })
);
assert.equal(output.ok, true);
assert.equal(output.waivedUnownedDeferred, 133);
assert.equal(output.waivedUnownedDeferredIdsDigest, report.waivedUnownedDeferredIdsDigest);

console.log('backlog-deferred-waiver-register.test.ts: ok');
