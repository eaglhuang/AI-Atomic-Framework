import assert from 'node:assert/strict';
import { compareResourceKeys, evaluateConflictMatrix } from '../../packages/core/src/broker/conflict-matrix.ts';
import { calculateBrokerDecision } from '../../packages/core/src/broker/decision.ts';
import type { ActiveWriteIntent, WriteBrokerRegistryDocument, WriteIntent } from '../../packages/core/src/broker/types.ts';

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

// ATM-GOV-0215 sample 0001 / probe A: the previously-broken evaluatePhysicalOverlap
// call site. Reproduces the exact scenario from
// docs/ai_atomic_framework/governance-optimization/findings/broker-correctness-sample-0001-glob-false-negative.md
// through calculateBrokerDecision, which is the path node atm.mjs broker decision exercises.
const holderIntent: ActiveWriteIntent = active({ files: ['packages/cli/src/commands/telemetry.ts'] });
const registry: WriteBrokerRegistryDocument = {
  schemaId: 'atm.writeBrokerRegistry.v1',
  specVersion: '0.1.0',
  repoId: 'test-repo',
  workspaceId: 'test-workspace',
  activeIntents: [holderIntent]
};

const probeA_glob: WriteIntent = {
  ...baseIntent,
  taskId: 'PROBE-A-GLOB',
  targetFiles: ['packages/cli/src/commands/**'],
  atomRefs: []
};
const probeAResult = calculateBrokerDecision(probeA_glob, registry);
assert.equal(probeAResult.verdict, 'needs-physical-split', 'probe A (glob) must produce a physical-split verdict, not parallel-safe');
assert.ok(
  probeAResult.conflicts.some((c) => c.kind === 'file-range'),
  'probe A must emit a file-range conflict against the holder intent'
);

const probeB_literal: WriteIntent = {
  ...baseIntent,
  taskId: 'PROBE-B-LITERAL',
  targetFiles: ['packages/cli/src/commands/telemetry.ts'],
  atomRefs: []
};
const probeBResult = calculateBrokerDecision(probeB_literal, registry);
assert.equal(probeBResult.verdict, 'needs-physical-split', 'probe B (literal) verdict unchanged');

const disjointProbe: WriteIntent = {
  ...baseIntent,
  taskId: 'PROBE-DISJOINT',
  targetFiles: ['templates/skills/**'],
  atomRefs: []
};
const disjointResult = calculateBrokerDecision(disjointProbe, registry);
assert.equal(disjointResult.verdict, 'parallel-safe', 'disjoint glob must remain parallel-safe — convergence must not collapse into serializing everything');

// Direction symmetry: active holds literal / new holds pattern was probe A;
// now active holds pattern / new holds literal.
const inverseRegistry: WriteBrokerRegistryDocument = {
  ...registry,
  activeIntents: [active({ files: ['packages/cli/src/commands/**'] })]
};
const inverseProbe: WriteIntent = {
  ...baseIntent,
  taskId: 'PROBE-INVERSE',
  targetFiles: ['packages/cli/src/commands/telemetry.ts'],
  atomRefs: []
};
const inverseResult = calculateBrokerDecision(inverseProbe, inverseRegistry);
assert.equal(inverseResult.verdict, 'needs-physical-split', 'active-holds-pattern / new-holds-literal must also be detected');

// Pattern-vs-pattern intersection.
const patternPatternRegistry: WriteBrokerRegistryDocument = {
  ...registry,
  activeIntents: [active({ files: ['packages/cli/src/commands/**'] })]
};
const patternPatternProbe: WriteIntent = {
  ...baseIntent,
  taskId: 'PROBE-PATTERN-PATTERN',
  targetFiles: ['packages/cli/src/commands/taskflow/**'],
  atomRefs: []
};
const patternPatternResult = calculateBrokerDecision(patternPatternProbe, patternPatternRegistry);
assert.equal(patternPatternResult.verdict, 'needs-physical-split', 'pattern-vs-pattern intersection must be detected');

console.log('broker resource overlap fixtures passed');
