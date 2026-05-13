import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { allocateMapId, MapIdAllocationError, parseMapId } from '../../packages/core/src/manager/map-id-allocator.ts';

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-map-id-allocator-'));
try {
  assert.deepEqual(parseMapId('ATM-MAP-0001'), {
    mapId: 'ATM-MAP-0001',
    bucket: 'MAP',
    sequence: 1
  });
  assert.equal(parseMapId('map.fixture.minimal'), null);
  assert.equal(allocateMapId({ repositoryRoot: tempRoot }).mapId, 'ATM-MAP-0001');

  writeRegistry(tempRoot, [
    { atomId: 'ATM-CORE-0001' },
    { mapId: 'ATM-MAP-0003' },
    { mapId: 'ATM-MAP-0007' }
  ]);
  assert.equal(allocateMapId({ repositoryRoot: tempRoot }).mapId, 'ATM-MAP-0008');

  writeFileSync(path.join(tempRoot, 'atomic-registry.json'), '{bad json', 'utf8');
  assert.throws(() => allocateMapId({ repositoryRoot: tempRoot }), (error) => error instanceof MapIdAllocationError && error.code === 'ATM_REGISTRY_INVALID');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[map-id-allocator:test] ok (4 acceptance checks)');

function writeRegistry(repositoryRoot: any, entries: any) {
  writeFileSync(path.join(repositoryRoot, 'atomic-registry.json'), `${JSON.stringify({ entries }, null, 2)}\n`, 'utf8');
}