import assert from 'node:assert/strict';
import { compileSecurityQualityReceipts, validateSecurityQualityReceipts } from '../../packages/core/src/evidence/security-quality-receipts.ts';

const authority = { authorityId: 'sec-1', digest: 'sha256:a', sealed: true as const };
const stale = compileSecurityQualityReceipts({ runId: 'r', generatedAt: '2026-08-09', authority, observedAuthorityDigest: 'sha256:stale', requiredSurfaces: ['api', 'db'], findings: [{ findingId: 'f', surface: 'api', severity: 'critical', status: 'fail', digest: 'sha256:f' }] });
assert.equal(stale.status, 'stale');
assert.ok(stale.diagnostics.includes('unaccepted-security-finding'));
assert.ok(stale.diagnostics.some(code => code.startsWith('missing-surface')));
assert.match(stale.repairCommand ?? '', /repair the sealed security authority/);
assert.equal(validateSecurityQualityReceipts(stale).ok, false);
const invalidAcceptance = compileSecurityQualityReceipts({ runId: 'r', generatedAt: '2026-08-09', authority, observedAuthorityDigest: authority.digest, findings: [{ findingId: 'pass', surface: 'api', severity: 'low', status: 'pass', digest: 'sha256:f' }], riskAcceptances: [{ findingId: 'pass', rationale: '', authorityDigest: authority.digest, approved: true }] });
assert.equal(invalidAcceptance.status, 'contradictory');
assert.deepEqual(invalidAcceptance.diagnostics, ['incomplete-risk-acceptance:pass', 'invalid-risk-acceptance:pass']);
console.log('plan4 security quality receipts negative: ok');
