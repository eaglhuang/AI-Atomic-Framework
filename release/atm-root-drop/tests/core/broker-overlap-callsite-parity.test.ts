import assert from 'node:assert/strict';
import { compareResourceKeys, evaluateConflictMatrix } from '../../packages/core/src/broker/conflict-matrix.ts';
import { calculateBrokerDecision } from '../../packages/core/src/broker/decision.ts';
import { evaluatePhysicalOverlap } from '../../packages/core/src/broker/decision/physical-overlap.ts';
import { evaluateProposalOverlap } from '../../packages/core/src/broker/decision/proposal-overlap.ts';
import { buildProposalAdmissionBase } from '../../packages/core/src/broker/decision/admission.ts';
import type { ActiveWriteIntent, WriteBrokerRegistryDocument, WriteIntent } from '../../packages/core/src/broker/types.ts';

// Call-site inventory: every Broker decision module that reasons about physical
// file resource overlap must route through resource-overlap.ts's canonical
// glob-aware matcher (compareResourceKeys / findResourceOverlapMatches /
// resourceListsOverlap). This suite proves the glob-intent -> literal-candidate
// and literal-intent -> glob-candidate cases produce the same conflict dimensions
// and resource keys at every call site, and that direct exact-match membership
// (e.g. Map.get(targetFile) keyed by a literal filePath) cannot silently reappear
// at any of them without this suite failing.

const baseIntent: WriteIntent = {
  schemaId: 'atm.writeIntent.v1',
  specVersion: '0.1.0',
  migration: { strategy: 'none', fromVersion: null, notes: 'call-site parity fixture' },
  taskId: 'PARITY-NEW',
  actorId: 'tester',
  baseCommit: 'abc123',
  targetFiles: [],
  atomRefs: [],
  sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: [] },
  requestedLane: 'auto'
};

function activeIntent(overrides: Partial<ActiveWriteIntent['resourceKeys']>): ActiveWriteIntent {
  return {
    intentId: 'active-intent',
    taskId: 'PARITY-ACTIVE',
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
    heartbeatAt: '2026-07-23T00:00:00.000Z',
    lane: 'direct-brokered',
    expiresAt: '2999-01-01T00:00:00.000Z'
  };
}

function registryOf(active: ActiveWriteIntent): WriteBrokerRegistryDocument {
  return {
    schemaId: 'atm.writeBrokerRegistry.v1',
    specVersion: '0.1.0',
    repoId: 'test-repo',
    workspaceId: 'test-workspace',
    activeIntents: [active]
  };
}

const literalFile = 'packages/core/src/broker/conflict-matrix.ts';
const globFile = 'packages/core/src/broker/**';

// --- Case 1: glob intent (new writer) -> literal candidate (active writer) ---
{
  const newIntent: WriteIntent = {
    ...baseIntent,
    targetFiles: [globFile],
    atomRefs: [{ atomId: 'atom-new', atomCid: 'cid-new', operation: 'modify', sourceRange: { filePath: literalFile, lineStart: 10, lineEnd: 20 } }]
  };
  const active = activeIntent({
    files: [literalFile],
    atomRanges: [{ filePath: literalFile, lineStart: 15, lineEnd: 25, atomCid: 'cid-active' }]
  });

  assert.equal(compareResourceKeys('file', globFile, literalFile).verdict, 'overlap', 'canonical matcher must treat glob-intent/literal-candidate as overlap');

  const matrix = evaluateConflictMatrix(newIntent, [active]);
  assert.ok(
    matrix.conflicts.some((c) => c.kind === 'file-range' && c.detail.includes(literalFile)),
    'evaluateConflictMatrix must surface a file-range conflict for glob-intent/literal-candidate'
  );
  assert.ok(
    matrix.conflicts.some((c) => c.kind === 'file-range' && c.detail.includes('cid-new') && c.detail.includes('cid-active')),
    'evaluateConflictMatrix must resolve the overlapping line ranges through the canonical matcher, not an exact-string Map lookup keyed by the glob target'
  );

  const physical = evaluatePhysicalOverlap(newIntent, [active]);
  assert.ok(physical !== null, 'evaluatePhysicalOverlap must not false-negative on glob-intent/literal-candidate');

  const decision = calculateBrokerDecision(newIntent, registryOf(active));
  assert.notEqual(decision.verdict, 'parallel-safe', 'calculateBrokerDecision must not false-negative on glob-intent/literal-candidate');
}

// --- Case 2: literal intent (new writer) -> glob candidate (active writer) ---
{
  const newIntent: WriteIntent = {
    ...baseIntent,
    targetFiles: [literalFile],
    atomRefs: [{ atomId: 'atom-new', atomCid: 'cid-new', operation: 'modify', sourceRange: { filePath: literalFile, lineStart: 10, lineEnd: 20 } }]
  };
  const active = activeIntent({
    files: [globFile],
    atomRanges: [{ filePath: literalFile, lineStart: 15, lineEnd: 25, atomCid: 'cid-active' }]
  });

  assert.equal(compareResourceKeys('file', literalFile, globFile).verdict, 'overlap', 'canonical matcher must treat literal-intent/glob-candidate as overlap');

  const matrix = evaluateConflictMatrix(newIntent, [active]);
  assert.ok(
    matrix.conflicts.some((c) => c.kind === 'file-range' && c.detail.includes(literalFile)),
    'evaluateConflictMatrix must surface a file-range conflict for literal-intent/glob-candidate'
  );
  assert.ok(
    matrix.conflicts.some((c) => c.kind === 'file-range' && c.detail.includes('cid-new') && c.detail.includes('cid-active')),
    'evaluateConflictMatrix must resolve the overlapping line ranges through the canonical matcher for the inverse direction too'
  );

  const physical = evaluatePhysicalOverlap(newIntent, [active]);
  assert.ok(physical !== null, 'evaluatePhysicalOverlap must not false-negative on literal-intent/glob-candidate');

  const decision = calculateBrokerDecision(newIntent, registryOf(active));
  assert.notEqual(decision.verdict, 'parallel-safe', 'calculateBrokerDecision must not false-negative on literal-intent/glob-candidate');
}

// --- Negative control: disjoint files must remain parallel-admissible everywhere ---
{
  const newIntent: WriteIntent = {
    ...baseIntent,
    targetFiles: ['templates/skills/example.md'],
    atomRefs: [{ atomId: 'atom-new', atomCid: 'cid-new', operation: 'modify', sourceRange: { filePath: 'templates/skills/example.md', lineStart: 1, lineEnd: 5 } }]
  };
  const active = activeIntent({
    files: [literalFile],
    atomRanges: [{ filePath: literalFile, lineStart: 1, lineEnd: 5, atomCid: 'cid-active' }]
  });

  const matrix = evaluateConflictMatrix(newIntent, [active]);
  assert.equal(matrix.conflicts.filter((c) => c.kind === 'file-range').length, 0, 'disjoint files must not produce file-range conflicts');

  const physical = evaluatePhysicalOverlap(newIntent, [active]);
  assert.equal(physical, null, 'disjoint files must remain parallel-admissible at the physical-overlap call site');

  const decision = calculateBrokerDecision(newIntent, registryOf(active));
  assert.equal(decision.verdict, 'parallel-safe', 'disjoint files must remain parallel-admissible at the decision call site');
}

// --- Negative control: disjoint atom ids/cids on a shared file must not fabricate a CID conflict ---
{
  const newIntent: WriteIntent = {
    ...baseIntent,
    targetFiles: [literalFile],
    atomRefs: [{ atomId: 'atom-disjoint-new', atomCid: 'cid-disjoint-new', operation: 'modify', sourceRange: { filePath: literalFile, lineStart: 1, lineEnd: 5 } }]
  };
  const active = activeIntent({
    files: [literalFile],
    atomIds: ['atom-disjoint-active'],
    atomCids: ['cid-disjoint-active'],
    atomRanges: [{ filePath: literalFile, lineStart: 40, lineEnd: 50, atomCid: 'cid-disjoint-active' }]
  });

  const decision = calculateBrokerDecision(newIntent, registryOf(active));
  assert.ok(
    !decision.conflicts.some((c) => c.kind === 'cid'),
    'disjoint atom ids/cids must remain parallel-admissible; no fabricated CID conflict'
  );
}

// --- Negative control: disjoint source ranges on the same literal file must not collapse into a full file lock ---
{
  const newIntent: WriteIntent = {
    ...baseIntent,
    targetFiles: [literalFile],
    atomRefs: [{ atomId: 'atom-new', atomCid: 'cid-new', operation: 'modify', sourceRange: { filePath: literalFile, lineStart: 1, lineEnd: 10 } }]
  };
  const active = activeIntent({
    files: [literalFile],
    atomRanges: [{ filePath: literalFile, lineStart: 100, lineEnd: 110, atomCid: 'cid-active' }]
  });

  const matrix = evaluateConflictMatrix(newIntent, [active]);
  assert.ok(
    matrix.conflicts.some((c) => c.kind === 'file-range' && c.detail.includes('Syntactically disjoint')),
    'the canonical range-level check must record the disjoint evidence, not silently drop it'
  );

  const physical = evaluatePhysicalOverlap(newIntent, [active]);
  assert.equal(physical, null, 'disjoint source ranges on a shared file must not be routed to deterministic-composer as a full file lock');

  const decision = calculateBrokerDecision(newIntent, registryOf(active));
  assert.equal(decision.verdict, 'parallel-safe', 'disjoint source ranges on a shared file must remain parallel-admissible end to end');
}

// --- Negative control: disjoint content anchors on distinct atoms must not fabricate overlap ---
{
  const newIntent: WriteIntent = {
    ...baseIntent,
    targetFiles: [literalFile],
    atomRefs: [{ atomId: 'atom-anchor-new', atomCid: 'cid-anchor-new', operation: 'modify', sourceRange: { filePath: literalFile, lineStart: 1, lineEnd: 5 } }]
  };
  const active = activeIntent({
    files: [literalFile],
    atomRanges: [{ filePath: literalFile, lineStart: 200, lineEnd: 210, atomCid: 'cid-anchor-active' }]
  });

  const decision = calculateBrokerDecision(newIntent, registryOf(active));
  assert.equal(decision.verdict, 'parallel-safe', 'distinct anchors/atoms with disjoint ranges must remain parallel-admissible');
}

// --- evaluateProposalOverlap call site: same canonical file matching, proposal-scoped ---
{
  const newIntent: WriteIntent = {
    ...baseIntent,
    targetFiles: [globFile],
    atomRefs: [{ atomId: 'atom-new', atomCid: 'cid-new', operation: 'modify', sourceRange: { filePath: literalFile, lineStart: 10, lineEnd: 20 } }],
    proposalAdmission: { trigger: 'same-file-overlap-risk', summarySubmitted: true, boundedRegions: [{ filePath: literalFile, lineStart: 10, lineEnd: 20 }] }
  };
  const active: ActiveWriteIntent = {
    ...activeIntent({ files: [literalFile], atomRanges: [{ filePath: literalFile, lineStart: 15, lineEnd: 25, atomCid: 'cid-active' }] }),
    admission: {
      trigger: 'same-file-overlap-risk',
      state: 'proposal-submitted',
      requiresProposal: true,
      summarySubmitted: true,
      hotFiles: [],
      boundedRegions: [{ filePath: literalFile, lineStart: 15, lineEnd: 25 }],
      rearbitrationRequired: false,
      reason: 'active proposal fixture'
    }
  };

  const baseAdmission = buildProposalAdmissionBase(newIntent);
  const conflictMatrix = evaluateConflictMatrix(newIntent, [active]);
  const proposalDecision = evaluateProposalOverlap(newIntent, [active], baseAdmission, conflictMatrix);
  assert.ok(proposalDecision !== null, 'evaluateProposalOverlap must not false-negative on glob-intent/literal-candidate proposal regions');
  assert.notEqual(proposalDecision?.verdict, 'parallel-safe');
}

console.log('broker overlap call-site parity fixtures passed');
