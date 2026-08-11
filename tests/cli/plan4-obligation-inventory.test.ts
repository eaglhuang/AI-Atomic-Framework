import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createObligationInventory,
  detectObligationInventoryDrift,
  OBLIGATION_INVENTORY_DRIFT_SCHEMA_ID,
  OBLIGATION_INVENTORY_SCHEMA_ID
} from '../../packages/core/src/evidence/obligation-inventory.ts';
import { createQualityCertificate } from '../../packages/core/src/evidence/coverage-semantics.ts';

const baseEntries = [
  {
    obligationId: 'atm.plan4.obligation.inventory.digest',
    semanticFamily: 'plan4-obligation-inventory',
    owningSeam: 'atm.obligationInventory.v1',
    lifecycleStatus: 'active' as const,
    sourceRefs: [{ kind: 'task' as const, ref: 'ATM-GOV-0279' }],
    validatorRefs: [{
      command: 'node --strip-types tests/cli/plan4-obligation-inventory.test.ts',
      caseId: 'test_task_atm_gov_0279_obligation_inventory_drift_detector_54fc3f05'
    }],
    observedAt: '2026-07-31T00:00:00.000Z'
  },
  {
    obligationId: 'atm.plan4.obligation.inventory.schema',
    semanticFamily: 'plan4-obligation-inventory',
    owningSeam: 'atm.obligationInventory.v1',
    lifecycleStatus: 'active' as const,
    sourceRefs: [{ kind: 'schema' as const, ref: 'schemas/evidence/obligation-inventory.schema.json' }],
    validatorRefs: [{
      command: 'node --strip-types tests/cli/plan4-obligation-inventory.test.ts',
      caseId: 'test_task_atm_gov_0279_obligation_inventory_drift_detector_54fc3f05'
    }],
    observedAt: '2026-07-31T00:00:00.000Z'
  }
];

const inventory = createObligationInventory({
  inventoryId: 'atm.plan4.foundation.obligations',
  modelId: 'atm.plan4.foundation',
  generatedAt: '2026-07-31T00:00:00.000Z',
  entries: baseEntries
});

assert.equal(inventory.schemaId, OBLIGATION_INVENTORY_SCHEMA_ID);
assert.equal(inventory.entries.length, 2);
assert.equal(inventory.entries[0].obligationId, 'atm.plan4.obligation.inventory.digest');
assert.ok(inventory.inventoryDigest.startsWith('sha256:'));

const reordered = createObligationInventory({
  inventoryId: 'atm.plan4.foundation.obligations',
  modelId: 'atm.plan4.foundation',
  generatedAt: '2026-07-31T00:05:00.000Z',
  entries: [...baseEntries].reverse()
});
assert.equal(reordered.inventoryDigest, inventory.inventoryDigest, 'inventory digest must be deterministic under entry reordering');

const current = createObligationInventory({
  inventoryId: 'atm.plan4.foundation.obligations',
  modelId: 'atm.plan4.foundation',
  generatedAt: '2026-07-31T00:10:00.000Z',
  entries: [
    {
      ...baseEntries[0],
      sourceRefs: [...baseEntries[0].sourceRefs, { kind: 'seam' as const, ref: 'atm.inventoryDriftDetector.v1' }],
      observedAt: '2026-07-30T23:00:00.000Z'
    },
    {
      obligationId: 'atm.plan4.obligation.inventory.stale-certificate',
      semanticFamily: 'plan4-obligation-inventory',
      owningSeam: 'atm.inventoryDriftDetector.v1',
      lifecycleStatus: 'active',
      sourceRefs: [{ kind: 'seam', ref: 'atm.inventoryDriftDetector.v1' }],
      validatorRefs: [{
        command: 'node --strip-types tests/cli/plan4-obligation-inventory.test.ts',
        caseId: 'test_task_atm_gov_0279_obligation_inventory_drift_detector_54fc3f05'
      }],
      observedAt: '2026-07-31T00:10:00.000Z'
    }
  ]
});

const priorCertificate = createQualityCertificate({
  certificateId: 'cert-before-inventory-change',
  issuedAt: '2026-07-31T00:00:00.000Z',
  model: { modelId: 'atm.plan4.foundation', digest: inventory.inventoryDigest },
  claimKind: 'finite-model-proven',
  coverageRatio: 1,
  obligationSummary: [{ status: 'proven', count: 2 }],
  assumptions: [{ id: 'bounded-inventory', statement: 'Certificate is bounded to the previous obligation inventory digest.' }]
});

const certificateBefore = JSON.stringify(priorCertificate);
const drift = detectObligationInventoryDrift({
  previous: inventory,
  current,
  staleObservedBefore: '2026-07-31T00:00:00.000Z',
  staleCertificateId: priorCertificate.certificateId,
  staleCertificateDigest: priorCertificate.model.digest
});

assert.equal(drift.schemaId, OBLIGATION_INVENTORY_DRIFT_SCHEMA_ID);
assert.equal(drift.changed, true);
assert.equal(JSON.stringify(priorCertificate), certificateBefore, 'drift evidence must not mutate the prior certificate');
assert.ok(drift.items.some((entry) => entry.kind === 'added' && entry.obligationId === 'atm.plan4.obligation.inventory.stale-certificate'));
assert.ok(drift.items.some((entry) => entry.kind === 'removed' && entry.obligationId === 'atm.plan4.obligation.inventory.schema'));
assert.ok(drift.items.some((entry) => entry.kind === 'changed' && entry.obligationId === 'atm.plan4.obligation.inventory.digest'));
assert.ok(drift.items.some((entry) => entry.kind === 'stale-observed' && entry.obligationId === 'atm.plan4.obligation.inventory.digest'));

const schema = JSON.parse(readFileSync('schemas/evidence/obligation-inventory.schema.json', 'utf8'));
assert.equal(schema.properties.schemaId.const, OBLIGATION_INVENTORY_SCHEMA_ID);
assert.ok(schema.properties.entries.items.required.includes('obligationId'));
assert.ok(schema.properties.entries.items.required.includes('semanticFamily'));
assert.ok(schema.properties.entries.items.required.includes('owningSeam'));
assert.ok(schema.properties.entries.items.required.includes('validatorRefs'));

const shard = JSON.parse(readFileSync('tests/catalog/groups/test_group_plan4_obligation_inventory.shard.json', 'utf8'));
const testCase = shard.cases.find((entry: { caseId?: string }) =>
  entry.caseId === 'test_task_atm_gov_0279_obligation_inventory_drift_detector_54fc3f05'
);
assert.ok(testCase, 'catalog shard must include the task-required obligation inventory test case');
assert.ok(testCase.coversAcceptance.includes('ACC-5'));

console.log(JSON.stringify({
  marker: '[plan4-obligation-inventory:test] ok',
  inventoryDigest: inventory.inventoryDigest,
  driftKinds: [...new Set(drift.items.map((entry) => entry.kind))].sort()
}));
