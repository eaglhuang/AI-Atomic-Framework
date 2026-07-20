import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BrokerTransactionAuthorityError,
  BrokerRegistryStoreError,
  createBrokerRegistryStore,
  createBrokerTransactionAuthority,
  type WriteIntent
} from '../../packages/core/src/index.ts';

function intent(taskId: string, actorId: string): WriteIntent {
  return {
    schemaId: 'atm.writeIntent.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'broker transaction authority fixture' },
    taskId,
    actorId,
    baseCommit: 'base-commit',
    targetFiles: ['packages/core/src/broker/registry.ts'],
    atomRefs: [],
    sharedSurfaces: {
      generators: [],
      projections: [],
      registries: ['write-broker.registry.json'],
      validators: [],
      artifacts: []
    },
    requestedLane: 'serial'
  };
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-broker-authority-'));
try {
  const registryPath = path.join(tempRoot, 'write-broker.registry.json');
  const authority = createBrokerTransactionAuthority(registryPath);

  const first = authority.register({
    intent: intent('ATM-GOV-0207', 'captain-a'),
    lane: 'serial',
    idempotencyKey: 'register-once'
  });
  assert.equal(first.status, 'committed');
  assert.equal(first.operation, 'register');
  assert.equal(first.nextGeneration > first.baseGeneration, true);

  const replay = authority.register({
    intent: intent('ATM-GOV-0207', 'captain-a'),
    lane: 'serial',
    idempotencyKey: 'register-once'
  });
  assert.equal(replay.status, 'idempotent-replay');
  assert.equal(replay.transactionId, first.transactionId);
  assert.equal(replay.nextDigest, first.nextDigest);

  const persisted = JSON.parse(readFileSync(registryPath, 'utf8'));
  assert.equal(persisted.lastTransactionId, first.transactionId);
  assert.equal(persisted.activeIntents.length, 1);

  assert.throws(
    () => authority.register({
      intent: intent('ATM-GOV-0207', 'captain-b'),
      lane: 'serial',
      idempotencyKey: 'register-other-lane'
    }),
    (error) => error instanceof BrokerTransactionAuthorityError && error.code === 'ATM_BROKER_SAME_TASK_LANE_FENCE'
  );

  const store = createBrokerRegistryStore(registryPath);
  const staleBase = store.read();
  authority.heartbeat({
    taskId: 'ATM-GOV-0207',
    actorId: 'captain-a',
    idempotencyKey: 'heartbeat-once'
  });
  assert.throws(
    () => store.write({
      base: staleBase,
      next: staleBase.document,
      transactionId: 'stale-write'
    }),
    (error) => error instanceof BrokerRegistryStoreError && error.code === 'ATM_BROKER_REGISTRY_CAS_CONFLICT'
  );

  authority.release({
    taskId: 'ATM-GOV-0207',
    actorId: 'captain-a',
    idempotencyKey: 'release-once'
  });
  assert.equal(authority.read().document.activeIntents.length, 0);

  writeFileSync(registryPath, '{ broken json', 'utf8');
  assert.throws(
    () => authority.read(),
    (error) => error instanceof BrokerRegistryStoreError && error.code === 'ATM_BROKER_REGISTRY_INVALID_JSON'
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('broker transaction authority canary ok');
