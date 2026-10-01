import assert from 'node:assert/strict';
import fs, { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createBrokerTransactionAuthority, type WriteIntent } from '../../packages/core/src/index.ts';
import { createBrokerRegistryStore, BrokerRegistryStoreError } from '../../packages/core/src/broker/registry-store.ts';
import { registerIntent } from '../../packages/core/src/broker/registry.ts';
import { commitBrokerRegistryTransaction } from '../../packages/core/src/broker/transaction-authority.ts';

const run = promisify(execFile);
if (process.argv[2] === '--writer') {
  const [root, indexText] = process.argv.slice(3);
  const index = Number(indexText);
  const store = createBrokerRegistryStore(path.join(root, 'write-broker.registry.json'));
  const base = store.read();
  writeFileSync(path.join(root, `ready-${index}`), 'ready');
  const deadline = Date.now() + 15000;
  while (!existsSync(path.join(root, 'go'))) {
    if (Date.now() > deadline) throw new Error('Writer barrier timed out');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
  }
  try {
    store.write({ base, next: registerIntent(base.document, makeIntent(index), 'direct-brokered'), transactionId: `writer-${index}` });
    console.log(JSON.stringify({ index, accepted: true }));
  } catch (error) {
    if (!(error instanceof BrokerRegistryStoreError) || error.code !== 'ATM_BROKER_REGISTRY_CAS_CONFLICT') throw error;
    console.log(JSON.stringify({ index, accepted: false, code: error.code }));
  }
  process.exit(0);
}

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

  // An existing writer's exclusion must reject without replacing its state or lock.
  const store = createBrokerRegistryStore(registryPath);
  const base = store.read();
  const lockPath = `${registryPath}.write-lock`;
  writeFileSync(lockPath, 'another-writer');
  try {
    assert.throws(() => store.write({ base, next: base.document, transactionId: 'contender' }),
      (error: unknown) => error instanceof BrokerRegistryStoreError && error.code === 'ATM_BROKER_REGISTRY_CAS_CONFLICT');
    assert.equal(readFileSync(lockPath, 'utf8'), 'another-writer');
    assert.equal(store.read().digest, base.digest);
  } finally {
    rmSync(lockPath);
  }

  // Actual processes share one base and start writing at the same barrier.
  const writers = Array.from({ length: 8 }, (_, index) => run(process.execPath,
    ['--experimental-strip-types', fileURLToPath(import.meta.url), '--writer', tempRoot, String(index + count)],
    { timeout: 20000 }));
  const deadline = Date.now() + 15000;
  while (!Array.from({ length: 8 }, (_, index) => existsSync(path.join(tempRoot, `ready-${index + count}`))).every(Boolean)) {
    if (Date.now() > deadline) throw new Error('Parent barrier timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  writeFileSync(path.join(tempRoot, 'go'), 'go');
  const outcomes = (await Promise.all(writers)).map(({ stdout }) => JSON.parse(stdout.trim()));
  assert.ok(outcomes.some((outcome) => outcome.accepted), 'At least one competing writer must commit');
  const final = store.read();
  const finalIds = new Set(final.document.activeIntents.map((intent) => intent.taskId));
  for (let index = 0; index < count; index++) assert.ok(finalIds.has(makeIntent(index).taskId));
  for (const outcome of outcomes) {
    assert.equal(finalIds.has(makeIntent(outcome.index).taskId), outcome.accepted,
      `Acknowledged writer ${outcome.index} must persist; rejected writer must not mutate`);
  }
  assert.equal(existsSync(lockPath), false, 'Operation-owned lock must be released');
  let decisionDigest: string | null = null;
  const decisionReceipt = authority.register({
    intent: makeIntent(count + 8),
    lane: 'direct-brokered',
    idempotencyKey: 'snapshot-bound-decision',
    resolveRegistration: (doc) => {
      decisionDigest = createBrokerRegistryStore(registryPath).read().digest;
      assert.equal(doc.activeIntents.length, final.document.activeIntents.length);
      return { lane: 'blocked' };
    }
  });
  assert.equal(decisionReceipt.baseDigest, decisionDigest, 'Decision must use the transaction base');
  assert.equal(authority.read().document.activeIntents.find((intent) => intent.taskId === makeIntent(count + 8).taskId)?.lane, 'blocked');
  let attempts = 0;
  const retryIntent = makeIntent(count + 9);
  const competitorIntent = makeIntent(count + 10);
  const mutationBases: number[] = [];
  commitBrokerRegistryTransaction({
    store: {
      registryPath,
      read: () => store.read(),
      write: (input) => {
        if (attempts++ === 0) authority.register({ intent: competitorIntent, lane: 'direct-brokered' });
        return store.write(input);
      }
    },
    operation: 'register', taskId: retryIntent.taskId, actorId: retryIntent.actorId, idempotencyKey: 'retry-fresh-base',
    mutate: (doc) => {
      mutationBases.push(doc.activeIntents.length);
      return registerIntent(doc, retryIntent, 'direct-brokered');
    }
  });
  assert.equal(attempts, 2);
  assert.equal(mutationBases[1], mutationBases[0] + 1, 'Retry must re-read and recalculate against the competitor');
  const retriedIds = new Set(store.read().document.activeIntents.map((intent) => intent.taskId));
  assert.ok(retriedIds.has(retryIntent.taskId));
  assert.ok(retriedIds.has(competitorIntent.taskId));
  if (process.platform === 'win32') {
    const originalRename = fs.renameSync;
    let renameAttempts = 0;
    let failuresBeforeSuccess = 2;
    fs.renameSync = (from, to) => {
      assert.equal(existsSync(lockPath), true, 'Rename retries must retain writer exclusion');
      if (renameAttempts++ < failuresBeforeSuccess) throw Object.assign(new Error('fixture reader holds replacement'), { code: 'EPERM' });
      originalRename(from, to);
    };
    syncBuiltinESMExports();
    try {
      authority.register({ intent: makeIntent(count + 11), lane: 'direct-brokered', idempotencyKey: 'transient-reader' });
      assert.equal(renameAttempts, 3);
      assert.ok(store.read().document.activeIntents.some((intent) => intent.taskId === makeIntent(count + 11).taskId));
      assert.equal(existsSync(lockPath), false);
      const beforeFailure = store.read().digest;
      renameAttempts = 0;
      failuresBeforeSuccess = Infinity;
      assert.throws(() => authority.register({ intent: makeIntent(count + 12), lane: 'direct-brokered', idempotencyKey: 'permanent-rename-failure' }),
        (error: unknown) => (error as NodeJS.ErrnoException).code === 'EPERM');
      assert.equal(renameAttempts, 8, 'Permanent permission failures must stop at the retry bound');
      assert.equal(store.read().digest, beforeFailure, 'Failed replacement must preserve the exact registry');
      assert.equal(existsSync(lockPath), false);
      assert.equal(fs.readdirSync(tempRoot).some((name) => name.includes('.tmp-')), false);
    } finally {
      fs.renameSync = originalRename;
      syncBuiltinESMExports();
    }
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('broker registry concurrency canary ok');
