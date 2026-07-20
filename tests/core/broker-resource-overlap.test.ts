import assert from 'node:assert/strict';
import { compareResourceKeys, evaluateConflictMatrix } from '../../packages/core/src/broker/conflict-matrix.ts';
import type { ActiveWriteIntent, WriteIntent } from '../../packages/core/src/broker/types.ts';

const baseIntent: WriteIntent = {
  schemaId: 'atm.writeIntent.v1',
  specVersion: '0.1.0',
  migration: { strategy: 'none', fromVersion: null, notes: 'resource overlap fixture' },
  taskId: 'ATM-GOV-0206-new',
  actorId: 'tester',
  baseCommit: 'abc123',
  targetFiles: ['packages/cli/src/commands/telemetry.ts'],
  atomRefs: [{ atomId: 'atom-a', atomCid: 'cid-a', operation: 'modify' }],
  sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: [] },
  requestedLane: 'auto'
};

function active(overrides: Partial<ActiveWriteIntent['resourceKeys']>): ActiveWriteIntent {
  return {
    intentId: 'active-intent',
    taskId: 'ATM-GOV-0206-active',
    teamRunId: null,
    actorId: 'active',
    baseCommit: 'abc123',
    resourceKeys: {
      files: [],
      atomIds: [],
      atomCids: [],
      generators: [],
      projections: [],
      registries: [],
      validators: [],
      artifacts: [],
      ...overrides
    },
    leaseEpoch: 1,
    leaseSeconds: 1800,
    leaseMaxSeconds: 1800,
    heartbeatAt: '2026-07-20T00:00:00.000Z',
    lane: 'direct-brokered',
    expiresAt: '2999-01-01T00:00:00.000Z'
  };
}

function expiredActive(overrides: Partial<ActiveWriteIntent['resourceKeys']>): ActiveWriteIntent {
  return { ...active(overrides), expiresAt: '2000-01-01T00:00:00.000Z' };
}

assert.equal(compareResourceKeys('file', 'packages/cli/src/commands/**', 'packages/cli/src/commands/telemetry.ts').verdict, 'overlap');
assert.equal(compareResourceKeys('file', 'packages/cli/src/commands/telemetry.ts', 'packages/cli/src/commands/**').verdict, 'overlap');
assert.equal(compareResourceKeys('file', 'packages/cli/src/commands/**', 'packages/cli/src/commands/taskflow/**').verdict, 'overlap');
assert.equal(compareResourceKeys('file', 'templates/skills/**', 'packages/core/**').verdict, 'clear');
assert.equal(compareResourceKeys('file', 'packages/[bad].ts', 'packages/core/index.ts').verdict, 'unknown');

const patternActive = evaluateConflictMatrix(baseIntent, [active({ files: ['packages/cli/src/commands/**'] })]);
assert.equal(patternActive.arbitrationVerdict, 'freeze');
assert.ok(patternActive.conflicts.some((conflict) => conflict.kind === 'file-range' && conflict.blockingTask === 'ATM-GOV-0206-active'));

for (const [axis, resourceKeys, newIntent] of [
  ['atomIds', { atomIds: ['atom-*'] }, { ...baseIntent, atomRefs: [{ atomId: 'atom-a', atomCid: 'cid-x', operation: 'modify' as const }] }],
  ['atomCids', { atomCids: ['cid-*'] }, { ...baseIntent, atomRefs: [{ atomId: 'atom-x', atomCid: 'cid-a', operation: 'modify' as const }] }],
  ['generators', { generators: ['gen/**'] }, { ...baseIntent, sharedSurfaces: { ...baseIntent.sharedSurfaces, generators: ['gen/a'] } }],
  ['projections', { projections: ['proj/**'] }, { ...baseIntent, sharedSurfaces: { ...baseIntent.sharedSurfaces, projections: ['proj/a'] } }],
  ['registries', { registries: ['reg/**'] }, { ...baseIntent, sharedSurfaces: { ...baseIntent.sharedSurfaces, registries: ['reg/a'] } }],
  ['validators', { validators: ['validate:*'] }, { ...baseIntent, sharedSurfaces: { ...baseIntent.sharedSurfaces, validators: ['validate:cli'] } }],
  ['artifacts', { artifacts: ['artifacts/**'] }, { ...baseIntent, sharedSurfaces: { ...baseIntent.sharedSurfaces, artifacts: ['artifacts/report.json'] } }]
] as const) {
  const result = evaluateConflictMatrix(newIntent, [expiredActive(resourceKeys)]);
  assert.notEqual(result.arbitrationVerdict, 'allow', `${axis} should not be treated as disjoint`);
}

const disjoint = evaluateConflictMatrix({ ...baseIntent, targetFiles: ['templates/skills/example.md'] }, [active({ files: ['packages/core/**'] })]);
assert.equal(disjoint.arbitrationVerdict, 'allow');

console.log('broker resource overlap fixtures passed');
