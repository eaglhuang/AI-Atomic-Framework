import assert from 'node:assert/strict';
import { buildResourceOverlapReport, compareResourceKeys } from '../../packages/core/src/broker/resource-overlap.ts';
import { enrichWriteIntentWithResourceOverlaps } from '../../packages/core/src/broker/intent-enrichment.ts';
import { evaluateConflictMatrix } from '../../packages/core/src/broker/conflict-matrix.ts';
import type { ActiveWriteIntent, WriteIntent } from '../../packages/core/src/broker/types.ts';

const intent: WriteIntent = {
  schemaId: 'atm.writeIntent.v1',
  specVersion: '0.1.0',
  migration: { strategy: 'none', fromVersion: null, notes: 'structured overlap fixture' },
  taskId: 'ATM-GOV-0209-new',
  actorId: 'tester',
  baseCommit: 'abc123',
  targetFiles: ['packages/core/src/broker/resource-overlap.ts'],
  atomRefs: [{
    atomId: 'atom-overlap',
    atomCid: 'cid-overlap',
    operation: 'modify',
    sourceRange: { filePath: 'packages/core/src/broker/resource-overlap.ts', lineStart: 10, lineEnd: 20 }
  }],
  readAtoms: [{ atomId: 'atom-read', atomCid: 'cid-read', operation: 'modify' }],
  sharedSurfaces: { generators: [], projections: [], registries: [], validators: ['validate:cli'], artifacts: [] },
  requestedLane: 'auto'
};

const active: ActiveWriteIntent = {
  intentId: 'active-intent',
  taskId: 'ATM-GOV-0209-active',
  teamRunId: null,
  actorId: 'active',
  baseCommit: 'abc123',
  resourceKeys: {
    files: ['packages/core/src/broker/**'],
    atomIds: ['atom-written'],
    atomCids: ['cid-written'],
    readAtomIds: ['atom-overlap'],
    readAtomCids: [],
    generators: [],
    projections: [],
    registries: [],
    validators: ['validate:*'],
    artifacts: [],
    atomRanges: [{ filePath: 'packages/core/src/broker/resource-overlap.ts', lineStart: 18, lineEnd: 30, atomCid: 'cid-written' }]
  },
  leaseEpoch: 1,
  leaseSeconds: 1800,
  leaseMaxSeconds: 1800,
  heartbeatAt: '2026-07-20T00:00:00.000Z',
  lane: 'direct-brokered',
  expiresAt: '2999-01-01T00:00:00.000Z'
};

assert.equal(compareResourceKeys('file', 'packages\\core\\src\\broker\\resource-overlap.ts', 'packages/core/src/broker/**').verdict, 'overlap');
assert.equal(compareResourceKeys('file', 'packages/[bad].ts', 'packages/core/index.ts').verdict, 'unknown');

const report = buildResourceOverlapReport(intent, [active]);
assert.equal(report.schemaId, 'atm.resourceOverlapReport.v1');
assert.ok(report.summary.overlap > 0);
assert.equal(report.summary.shadowMismatches, 0);
assert.ok(report.facts.some((fact) => fact.resourceKind === 'file' && fact.verdict === 'overlap' && fact.intersection.kind === 'pattern'));
assert.ok(report.facts.some((fact) => fact.resourceKind === 'validator' && fact.normalizedRightKey === 'validate:*'));
assert.ok(report.facts.some((fact) => fact.intersection.kind === 'line-range' && fact.verdict === 'overlap'));

const enriched = enrichWriteIntentWithResourceOverlaps(intent, [active]);
assert.equal(enriched.intent.resourceOverlaps?.length, report.facts.length);

const matrix = evaluateConflictMatrix(intent, [active]);
assert.equal(matrix.arbitrationVerdict, 'freeze');
assert.ok(matrix.resourceOverlaps?.some((fact) => fact.resourceKind === 'file' && fact.verdict === 'overlap'));

const disjointReport = buildResourceOverlapReport(
  { ...intent, targetFiles: ['docs/readme.md'], atomRefs: [{ atomId: 'atom-x', atomCid: 'cid-x', operation: 'modify' }] },
  [{ ...active, resourceKeys: { ...active.resourceKeys, files: ['packages/core/**'], validators: [] } }]
);
assert.ok(disjointReport.facts.some((fact) => fact.resourceKind === 'file' && fact.verdict === 'disjoint'));

console.log('broker structured overlap fixtures passed');
