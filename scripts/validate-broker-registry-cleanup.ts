import { existsSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadRegistry, saveRegistry } from '../packages/core/src/broker/registry.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    console.error(`[broker-registry-cleanup] FAIL ${message}`);
    process.exit(1);
  }
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-broker-cleanup-'));
const registryPath = path.join(tempRoot, '.atm', 'runtime', 'write-broker.registry.json');
mkdirSync(path.dirname(registryPath), { recursive: true });

saveRegistry(registryPath, {
  schemaId: 'atm.writeBrokerRegistry.v1',
  specVersion: '0.1.0',
  repoId: 'cleanup-fixture',
  workspaceId: 'main',
  currentEpoch: 99,
  activeIntents: [
    {
      intentId: 'intent-stale',
      taskId: 'TASK-STALE',
      teamRunId: null,
      actorId: 'agent-a',
      baseCommit: 'abc123',
      resourceKeys: {
        files: ['src/stale.ts'],
        atomIds: [],
        atomCids: [],
        atomRanges: [],
        generators: [],
        projections: [],
        registries: [],
        validators: [],
        artifacts: []
      },
      leaseEpoch: 10,
      leaseSeconds: 60,
      leaseMaxSeconds: 60,
      heartbeatAt: '2026-01-01T00:00:00.000Z',
      lane: 'serial',
      expiresAt: '2026-01-01T00:01:00.000Z'
    },
    {
      intentId: 'intent-live',
      taskId: 'TASK-LIVE',
      teamRunId: null,
      actorId: 'agent-b',
      baseCommit: 'def456',
      resourceKeys: {
        files: ['src/live.ts'],
        atomIds: [],
        atomCids: [],
        atomRanges: [],
        generators: [],
        projections: [],
        registries: [],
        validators: [],
        artifacts: []
      },
      leaseEpoch: Date.now(),
      leaseSeconds: 1800,
      leaseMaxSeconds: 1800,
      heartbeatAt: new Date().toISOString(),
      lane: 'serial',
      expiresAt: new Date(Date.now() + 1_800_000).toISOString()
    }
  ]
});

const loaded = loadRegistry(registryPath);
assert(loaded.activeIntents.length === 1, `expected stale intent to be removed on load, got ${loaded.activeIntents.length}`);
assert(loaded.activeIntents[0]?.taskId === 'TASK-LIVE', `expected live intent to remain, got ${loaded.activeIntents[0]?.taskId ?? 'none'}`);
assert(existsSync(registryPath), 'registry file must remain present after cleanup');

const persisted = JSON.parse(readFileSync(registryPath, 'utf8')) as { activeIntents?: Array<{ taskId?: string }> };
assert(persisted.activeIntents?.length === 1, `expected cleaned registry to persist one active intent, got ${persisted.activeIntents?.length ?? 0}`);
assert(persisted.activeIntents?.[0]?.taskId === 'TASK-LIVE', `expected persisted registry to keep TASK-LIVE, got ${persisted.activeIntents?.[0]?.taskId ?? 'none'}`);

console.log('[broker-registry-cleanup] ok');
