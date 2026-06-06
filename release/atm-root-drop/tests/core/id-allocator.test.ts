import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { allocateAtomId, AtomIdAllocationError, normalizeAtomBucket, parseAtomId } from '../../packages/core/src/manager/id-allocator.ts';

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-id-allocator-'));
try {
  assert.deepEqual(parseAtomId('ATM-CORE-0001'), {
    atomId: 'ATM-CORE-0001',
    bucket: 'CORE',
    sequence: 1
  });
  assert.equal(parseAtomId('atom.core-seed'), null);
  assert.equal(normalizeAtomBucket('core'), 'CORE');
  assert.equal(allocateAtomId('core', { repositoryRoot: tempRoot }).atomId, 'ATM-CORE-0001');

  writeRegistry(tempRoot, [
    { atomId: 'ATM-CORE-0001' },
    { atomId: 'ATM-CORE-0003' },
    { atomId: 'ATM-FIXTURE-0007' }
  ]);
  assert.equal(allocateAtomId('CORE', { repositoryRoot: tempRoot }).atomId, 'ATM-CORE-0004');
  assert.equal(allocateAtomId('fixture', { repositoryRoot: tempRoot }).atomId, 'ATM-FIXTURE-0008');
  assert.equal(allocateAtomId('PLUGIN', { repositoryRoot: tempRoot }).atomId, 'ATM-PLUGIN-0001');

  assert.throws(() => allocateAtomId('', { repositoryRoot: tempRoot }), AtomIdAllocationError);
  assert.throws(() => allocateAtomId('BAD-BUCKET', { repositoryRoot: tempRoot }), (error) => (error as any).code === 'ATM_BUCKET_INVALID');

  writeFileSync(path.join(tempRoot, 'atomic-registry.json'), '{bad json', 'utf8');
  assert.throws(() => allocateAtomId('CORE', { repositoryRoot: tempRoot }), /Atomic registry JSON is invalid/);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[id-allocator:test] ok (6 acceptance checks)');

function writeRegistry(repositoryRoot: any, entries: any) {
  writeFileSync(path.join(repositoryRoot, 'atomic-registry.json'), `${JSON.stringify({ entries }, null, 2)}\n`, 'utf8');
}
