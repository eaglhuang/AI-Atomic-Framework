import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-broker-intent-validation-'));

try {
  const malformedIntent = path.join(tempDir, 'malformed-intent.json');
  writeFileSync(malformedIntent, JSON.stringify({
    schemaId: 'atm.writeIntent.v1',
    taskId: 'TASK-PROBE-0001',
    actorId: 'probe',
    baseCommit: '0'.repeat(40),
    resourceKeys: { files: ['src/x.ts'] }
  }), 'utf8');

  const result = spawnSync(process.execPath, [
    '--strip-types',
    'packages/cli/src/atm.ts',
    'broker',
    'decision',
    '--intent-file',
    malformedIntent,
    '--json'
  ], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 2);
  const payload = JSON.parse(result.stdout || result.stderr);
  assert.equal(payload.ok, false);
  assert.equal(payload.diagnostics.errorCodes.includes('ATM_BROKER_INTENT_INVALID'), true);
  assert.deepEqual(payload.messages[0].data.missingFields, [
    'targetFiles',
    'atomRefs',
    'sharedSurfaces',
    'requestedLane'
  ]);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

console.log('broker-intent-validation.spec passed');
