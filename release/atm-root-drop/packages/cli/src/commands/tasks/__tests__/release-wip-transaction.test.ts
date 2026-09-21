import assert from 'node:assert/strict';
import { isConfirmedWipCommitResult } from '../release-wip-transaction.ts';

assert.equal(isConfirmedWipCommitResult({ ok: true, evidence: { commitSha: 'abc123', workAdmission: { decision: { ok: true } } } }), true);
assert.equal(isConfirmedWipCommitResult({ ok: true, evidence: { commitSha: null, workAdmission: { decision: { ok: false } } } }), false);
assert.equal(isConfirmedWipCommitResult({ ok: true, evidence: { commitSha: 'abc123', workAdmission: { decision: { ok: false } } } }), false);
assert.equal(isConfirmedWipCommitResult({ ok: false, evidence: { commitSha: 'abc123' } }), false);

console.log('release-wip-transaction: ok');
