import assert from 'node:assert/strict';
import { buildLinkedSurfaceScopePreflight } from '../../packages/cli/src/commands/tasks/scope-preflight/implementation.ts';
import { buildScopeAmendmentRearbitration } from '../../packages/cli/src/commands/tasks/scope-amendment/implementation.ts';
import type { LinkedSurfaceEdge } from '../../packages/core/src/scope/linked-surface/index.ts';

const cycleEdges: LinkedSurfaceEdge[] = [
  {
    edgeId: 'a-to-b',
    producerId: 'generator.a',
    kind: 'build-output',
    inputs: ['a.ts'],
    outputs: ['b.ts'],
    availability: 'required',
    provenance: { registryId: 'cycle.registry', declaredBy: 'fixture' }
  },
  {
    edgeId: 'b-to-a',
    producerId: 'generator.b',
    kind: 'build-output',
    inputs: ['b.ts'],
    outputs: ['a.ts'],
    availability: 'required',
    provenance: { registryId: 'cycle.registry', declaredBy: 'fixture' }
  }
];

const closure = buildLinkedSurfaceScopePreflight({
  existingScope: ['a.ts'],
  edges: cycleEdges,
  registeredProducerIds: ['generator.a', 'generator.b'],
  brokerReadSet: ['a.ts'],
  brokerWriteSet: ['a.ts']
}).closure;

const receipt = buildScopeAmendmentRearbitration({
  closure,
  currentScope: ['a.ts'],
  ticketReadSet: ['a.ts'],
  ticketWriteSet: ['a.ts']
});

assert.equal(receipt.ok, false);
assert.equal(receipt.errorCode, 'ATM_BROKER_REARBITRATION_REQUIRED');
assert.deepEqual(receipt.amendmentPaths, ['b.ts']);
assert.deepEqual(receipt.rearbitration.missingReadSet, ['b.ts']);
assert.deepEqual(receipt.rearbitration.missingWriteSet, ['b.ts']);
assert.deepEqual(receipt.rearbitration.amendedWriteSet, ['a.ts', 'b.ts']);
assert.equal(closure.findings.some((finding) => finding.code === 'ATM_LINKED_SURFACE_CYCLE'), true);

const clean = buildScopeAmendmentRearbitration({
  closure,
  currentScope: ['a.ts', 'b.ts'],
  ticketReadSet: ['a.ts', 'b.ts'],
  ticketWriteSet: ['a.ts', 'b.ts']
});
assert.equal(clean.ok, true);
assert.equal(clean.errorCode, null);

console.log('[scope-amendment-rearbitration.test] ok');
