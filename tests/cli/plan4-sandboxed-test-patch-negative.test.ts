import assert from 'node:assert/strict';
import { compileSandboxedTestPatch } from '../../packages/core/src/evidence/sandboxed-test-patch.ts';
const authority = { authorityId: 'a', baseDigest: 'sha256:source', sealed: true as const };
const stale = compileSandboxedTestPatch({ authority, patchId: 'p', sourceDigest: 'sha256:other', operations: [{ operationId: 'o', path: 'test.ts', start: 0, end: 1, replacement: 'x' }], requiredTestIds: ['t1'], passingTestIds: [] });
assert.equal(stale.status, 'stale');
assert.match(stale.repairCommand ?? '', /restore/);
const contradictory = compileSandboxedTestPatch({ authority, patchId: 'p', sourceDigest: 'sha256:source', operations: [{ operationId: 'o', path: 'test.ts', start: 2, end: 1, replacement: 'x' }, { operationId: 'o', path: 'test.ts', start: 0, end: 1, replacement: 'x' }], requiredTestIds: ['t1'], passingTestIds: [] });
assert.equal(contradictory.status, 'contradictory');
console.log('plan4 sandboxed test patch negative: ok');
