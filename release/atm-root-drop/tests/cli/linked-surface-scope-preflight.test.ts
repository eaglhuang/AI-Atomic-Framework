import assert from 'node:assert/strict';
import { buildLinkedSurfaceScopePreflight } from '../../packages/cli/src/commands/tasks/scope-preflight/implementation.ts';
import type { LinkedSurfaceEdge } from '../../packages/core/src/scope/linked-surface/index.ts';

const edges: LinkedSurfaceEdge[] = [
  {
    edgeId: 'template-to-compiled',
    producerId: 'template.compiler',
    kind: 'template-compiler',
    inputs: ['templates/card.tpl'],
    outputs: ['generated/card.ts'],
    availability: 'required',
    provenance: { registryId: 'fixture.registry', declaredBy: 'fixture' }
  },
  {
    edgeId: 'compiled-to-validator',
    producerId: 'validator.generator',
    kind: 'validator',
    inputs: ['generated/card.ts'],
    outputs: ['tests/generated/card.test.ts'],
    availability: 'required',
    provenance: { registryId: 'fixture.registry', declaredBy: 'fixture' }
  },
  {
    edgeId: 'compiled-to-editor-projection',
    producerId: 'editor.projector',
    kind: 'editor-projection',
    inputs: ['generated/card.ts'],
    outputs: ['editor/card.preview.json'],
    availability: 'optional',
    provenance: { registryId: 'fixture.registry', declaredBy: 'fixture' }
  },
  {
    edgeId: 'unregistered-skill-projection',
    producerId: 'unknown.skill',
    kind: 'manifest',
    inputs: ['templates/card.tpl'],
    outputs: ['skills/card/SKILL.md'],
    availability: 'required',
    provenance: { registryId: 'fixture.registry', declaredBy: 'fixture' }
  }
];

const receipt = buildLinkedSurfaceScopePreflight({
  existingScope: ['templates/card.tpl'],
  edges,
  registeredProducerIds: ['template.compiler', 'validator.generator', 'editor.projector']
});

assert.equal(receipt.ok, false);
assert.equal(receipt.errorCode, 'ATM_SCOPE_AMENDMENT_REQUIRED');
assert.deepEqual(receipt.requiredAdditions, ['generated/card.ts', 'tests/generated/card.test.ts']);
assert.deepEqual(receipt.optionalSurfaces, ['editor/card.preview.json']);
assert.deepEqual(receipt.unavailableSurfaces, ['skills/card/SKILL.md']);
assert.equal(receipt.closure.traversalOrder.includes('template-to-compiled'), true);
assert.equal(receipt.closure.findings.some((finding) => finding.code === 'ATM_LINKED_SURFACE_UNSUPPORTED'), true);

const disjoint = buildLinkedSurfaceScopePreflight({
  existingScope: ['docs/readme.md'],
  edges,
  registeredProducerIds: ['template.compiler', 'validator.generator', 'editor.projector']
});
assert.deepEqual(disjoint.requiredAdditions, []);
assert.equal(disjoint.ok, true);

console.log('[linked-surface-scope-preflight.test] ok');
