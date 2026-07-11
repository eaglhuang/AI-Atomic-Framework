import assert from 'node:assert/strict';
import { runEvidenceValidators } from '../verbs/validators.js';
const listed = runEvidenceValidators(['--list', '--task', 'TASK-RFT-0007', '--json']);
assert.equal(listed.ok, true);
assert.ok(Array.isArray(listed.evidence?.validators) || Array.isArray(listed.evidence?.catalog) || listed.evidence);
const again = runEvidenceValidators(['--list', '--task', 'TASK-RFT-0007', '--json']);
assert.equal(again.ok, true);
console.log('[validators.spec] ok');
