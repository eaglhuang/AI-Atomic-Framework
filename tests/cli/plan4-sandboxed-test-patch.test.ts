import assert from 'node:assert/strict';
import { compileSandboxedTestPatch, replaySandboxedTestPatch, validateSandboxedTestPatch } from '../../packages/core/src/evidence/sandboxed-test-patch.ts';
const authority = { authorityId: 'a', baseDigest: 'sha256:source', sealed: true as const };
const result = compileSandboxedTestPatch({ authority, patchId: 'p', sourceDigest: 'sha256:source', operations: [{ operationId: 'large', path: 'test.ts', start: 0, end: 20, replacement: 'x' }, { operationId: 'small', path: 'test.ts', start: 2, end: 3, replacement: 'y' }], requiredTestIds: ['t1'], passingTestIds: ['t1'], provenance: { actor: 'ignored' } });
assert.equal(result.status, 'proven');
assert.deepEqual(result.minimizedOperationIds, ['small', 'large']);
assert.deepEqual(replaySandboxedTestPatch(result), result);
assert.deepEqual(validateSandboxedTestPatch(result), { ok: true, diagnostics: [] });
console.log('plan4 sandboxed test patch: ok');
