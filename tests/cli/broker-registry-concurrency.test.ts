import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBrokerTransactionAuthority, type WriteIntent } from '../../packages/core/src/index.ts';

function makeIntent(index: number): WriteIntent {
  return {
    schemaId: 'atm.writeIntent.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'deterministic multi-writer fixture' },
    taskId: `TASK-${String(index).padStart(4, '0')}`,
    actorId: `actor-${index}`,
    baseCommit: 'base-commit',
    targetFiles: [`src/file-${index}.ts`],
    atomRefs: [],
    sharedSurfaces: {
      generators: [],
      projections: [],
      registries: ['write-broker.registry.json'],
      validators: [],
      artifacts: []
    },
    requestedLane: 'direct-brokered'
  };
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-broker-concurrency-'));
try {
  const registryPath = path.join(tempRoot, 'write-broker.registry.json');
  const authority = createBrokerTransactionAuthority(registryPath);
  const count = Number(process.env.ATM_BROKER_CONCURRENCY_FIXTURE_COUNT ?? 128);

  for (let index = 0; index < count; index += 1) {
    authority.register({
      intent: makeIntent(index),
      lane: 'direct-brokered',
      idempotencyKey: `register-${index}`
    });
  }

  const persisted = JSON.parse(readFileSync(registryPath, 'utf8'));
  assert.equal(persisted.activeIntents.length, count);
  assert.equal(new Set(persisted.activeIntents.map((entry: { taskId: string }) => entry.taskId)).size, count);
  assert.equal(typeof persisted.currentEpoch, 'number');
  assert.equal(typeof persisted.lastTransactionId, 'string');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('broker registry concurrency canary ok');
