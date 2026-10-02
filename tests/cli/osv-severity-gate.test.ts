import assert from 'node:assert/strict';
import { assessOsvSeverity } from '../../scripts/osv-severity-gate.ts';
function report(vulnerability: object, score?: string) {
  return { results: [{ packages: [{ package: { name: 'fixture' }, vulnerabilities: [{ id: 'FIXTURE', ...vulnerability }],
    groups: score === undefined ? [] : [{ ids: ['FIXTURE'], max_severity: score }] }] }] };
}
const vector = { severity: [{ type: 'CVSS_V3', score: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H' }] };
assert.equal(assessOsvSeverity(report({ database_specific: { severity: 'CRITICAL' } })).exitCode, 1);
assert.equal(assessOsvSeverity(report(vector, '9.8')).exitCode, 1);
assert.equal(assessOsvSeverity(report(vector, '7.0')).exitCode, 1);
assert.equal(assessOsvSeverity(report(vector, '6.9')).exitCode, 0);
assert.equal(assessOsvSeverity(report(vector)).exitCode, 2);
assert.equal(assessOsvSeverity(report({}, 'unknown')).exitCode, 2);
assert.equal(assessOsvSeverity(report({}, '11')).exitCode, 2);
assert.equal(assessOsvSeverity(report({ severityText: 'LOW' })).exitCode, 0);
assert.equal(assessOsvSeverity({ results: [] }).exitCode, 0);
assert.throws(() => assessOsvSeverity({}), /results array/);
console.log('[osv-severity-gate] textual/numeric/vector/inconclusive/boundary cases passed');
