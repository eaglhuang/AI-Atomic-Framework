/**
 * ATM-GOV-0285 — validator catalog selection bridge.
 *
 * Case id: test_atm_gov_0285_catalog_selection_by_impact_cone_b4a67e10
 *
 * Red predicate: selector ignores required test ids or impact cone and returns
 * unrelated or empty validators.
 */

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  ATM_VALIDATOR_CATALOG_MAPPING_MISSING,
  VALIDATOR_CATALOG_SELECTION_SCHEMA_ID,
  selectValidatorCatalogEntries,
  type CatalogCaseEntry,
  type ValidatorSelectionRequest
} from '../../packages/core/src/evidence/validator-catalog-selection.ts';

const catalog: readonly CatalogCaseEntry[] = [
  {
    caseId: 'test_required_case_a',
    groupId: 'test_group_alpha',
    command: 'node --strip-types tests/cli/alpha.test.ts',
    responsibility: 'task-required',
    supportedSeams: ['atm.alphaSeam.v1'],
    coversImpactEdges: ['alpha input -> alpha output'],
    coversAcceptance: ['ACC-1']
  },
  {
    caseId: 'test_seam_overlap_case',
    groupId: 'test_group_beta',
    command: 'node --strip-types tests/cli/beta.test.ts',
    responsibility: 'phase-suite',
    supportedSeams: ['atm.sharedSeam.v1'],
    coversImpactEdges: ['beta input -> beta output'],
    coversAcceptance: []
  },
  {
    caseId: 'test_impact_edge_case',
    groupId: 'test_group_gamma',
    command: 'node --strip-types tests/cli/gamma.test.ts',
    responsibility: 'advisory',
    supportedSeams: [],
    coversImpactEdges: ['shared edge -> observed effect'],
    coversAcceptance: []
  },
  {
    caseId: 'test_declared_validator_case',
    groupId: 'test_group_delta',
    command: 'npm run validate:delta',
    responsibility: 'task-required',
    supportedSeams: [],
    coversImpactEdges: [],
    coversAcceptance: []
  },
  {
    caseId: 'test_unrelated_case',
    groupId: 'test_group_omega',
    command: 'node --strip-types tests/cli/omega.test.ts',
    responsibility: 'advisory',
    supportedSeams: ['atm.unrelatedSeam.v1'],
    coversImpactEdges: ['unrelated input -> unrelated output'],
    coversAcceptance: []
  }
];

const request: ValidatorSelectionRequest = {
  taskId: 'ATM-GOV-FIXTURE',
  requiredTestCaseIds: ['test_required_case_a'],
  validatorRefs: [{ command: 'npm run validate:delta' }],
  changedPublicSeams: ['atm.sharedSeam.v1'],
  causalImpactEdges: ['shared edge -> observed effect']
};

// --- ACC-1: every declared input contributes to selection ----------------

const selection = selectValidatorCatalogEntries({ catalog, request });
assert.equal(selection.schemaId, VALIDATOR_CATALOG_SELECTION_SCHEMA_ID);
assert.equal(selection.ok, true);
assert.deepEqual(
  selection.selected.map((entry) => entry.caseId),
  ['test_declared_validator_case', 'test_impact_edge_case', 'test_required_case_a', 'test_seam_overlap_case']
);
assert.deepEqual(
  selection.selected.map((entry) => `${entry.caseId}:${entry.reasons.join('+')}`),
  [
    'test_declared_validator_case:declared-validator-ref',
    'test_impact_edge_case:impact-edge-overlap',
    'test_required_case_a:task-required-case',
    'test_seam_overlap_case:seam-overlap'
  ],
  'each selected case must name why the task pulled it in'
);
assert.deepEqual(
  selection.selected.map((entry) => entry.command),
  ['npm run validate:delta', 'node --strip-types tests/cli/gamma.test.ts', 'node --strip-types tests/cli/alpha.test.ts', 'node --strip-types tests/cli/beta.test.ts']
);

// --- ACC-2: everything else is omitted with an explicit reason code ------

assert.deepEqual(
  selection.omitted.map((entry) => `${entry.caseId}:${entry.reasonCode}`),
  ['test_unrelated_case:outside-impact-cone']
);
assert.match(selection.omitted[0]!.reason, /seam|impact|required/i, 'an omission must be explainable, not a bare code');
assert.equal(selection.selected.length + selection.omitted.length, catalog.length, 'every catalog case must be accounted for');

// A request that matches nothing selects nothing and says so per case.
const emptyCone = selectValidatorCatalogEntries({
  catalog,
  request: { taskId: 'ATM-GOV-FIXTURE', requiredTestCaseIds: [], validatorRefs: [], changedPublicSeams: [], causalImpactEdges: [] }
});
assert.deepEqual(emptyCone.selected, []);
assert.equal(emptyCone.omitted.length, catalog.length);
assert.deepEqual([...new Set(emptyCone.omitted.map((entry) => entry.reasonCode))], ['outside-impact-cone']);

// Selection is order-insensitive and stable.
const reordered = selectValidatorCatalogEntries({ catalog: [...catalog].reverse(), request });
assert.equal(reordered.selectionDigest, selection.selectionDigest, 'catalog order must not change the selection');

// --- ACC-4: a required case with no catalog mapping fails closed --------

const unmapped = selectValidatorCatalogEntries({
  catalog,
  request: { ...request, requiredTestCaseIds: [...request.requiredTestCaseIds, 'test_case_never_registered'] }
});
assert.equal(unmapped.ok, false);
assert.deepEqual(unmapped.unmappedRequiredCaseIds, ['test_case_never_registered']);
assert.equal(unmapped.failClosed?.code, ATM_VALIDATOR_CATALOG_MAPPING_MISSING);
assert.equal(
  unmapped.failClosed?.requiredCommand,
  'node atm.mjs evidence validators --task ATM-GOV-FIXTURE --list --json'
);
assert.match(String(unmapped.failClosed?.repairHint), /tests\/catalog\/groups/);
// Failing closed must still report what was resolved, so the repair is scoped.
assert.deepEqual(
  unmapped.selected.map((entry) => entry.caseId),
  selection.selected.map((entry) => entry.caseId),
  'a mapping gap must not erase the rest of the selection'
);

// --- the bridge works on a real shard, not just fixtures ----------------

const shard = JSON.parse(readFileSync('tests/catalog/groups/test_group_plan4_quality_gauntlet.shard.json', 'utf8')) as {
  groupId: string;
  caseIds: readonly string[];
};
const shardCatalog: readonly CatalogCaseEntry[] = shard.caseIds.map((caseId) => ({
  caseId,
  groupId: shard.groupId,
  command: 'node --strip-types tests/cli/plan4-quality-gauntlet.test.ts',
  responsibility: 'task-required',
  supportedSeams: ['atm.qualityGauntlet.v1'],
  coversImpactEdges: [],
  coversAcceptance: []
}));
const shardSelection = selectValidatorCatalogEntries({
  catalog: shardCatalog,
  request: {
    taskId: 'ATM-GOV-0284',
    requiredTestCaseIds: [...shard.caseIds],
    validatorRefs: [],
    changedPublicSeams: [],
    causalImpactEdges: []
  }
});
assert.equal(shardSelection.ok, true);
assert.deepEqual(shardSelection.selected.map((entry) => entry.caseId), [...shard.caseIds].sort());
assert.deepEqual(shardSelection.omitted, []);

const catalogText = readFileSync('tests/catalog/groups/test_group_plan4_validator_selection.shard.json', 'utf8');
assert(catalogText.includes('test_atm_gov_0285_catalog_selection_by_impact_cone_b4a67e10'));
assert(catalogText.includes('test_atm_gov_0285_resumable_probe_cursor_91d4c7e2'));

console.log(JSON.stringify({
  marker: '[plan4-validator-catalog-selection:test] ok',
  caseId: 'test_atm_gov_0285_catalog_selection_by_impact_cone_b4a67e10',
  selectionDigest: selection.selectionDigest,
  selected: selection.selected.map((entry) => entry.caseId)
}));
