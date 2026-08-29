/**
 * ATM-GOV-0313 — complete catalog schema contract.
 *
 * Case ids:
 *   test_task_atm_gov_0313_complete_catalog_schema_contract_7d958211
 *   test_task_atm_gov_0313_historical_shard_namespace_migration_8a48480f
 *
 * The repair this suite guards: every shard case id must live in the canonical
 * `test_int_` / `test_task_` namespace, the pre-migration ids must remain
 * resolvable through `legacyAliases` (closed cards still reference them), and
 * catalog validation must aggregate across all shards instead of stopping at the
 * first offender.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  buildTestCaseId,
  loadAllShardCaseIds,
  loadLegacyCaseAliases,
  loadTestCaseGroupShards,
  reportShardReachability,
  resolveLegacyCaseId,
  validateLegacyCaseAliases,
  validateTestCaseGroupShards
} from '../../packages/cli/src/commands/test-catalog.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const groupsRoot = path.join(root, 'tests/catalog/groups');
const schema = JSON.parse(readFileSync(
  path.join(root, 'schemas/validators/test-case-group.schema.json'),
  'utf8'
));
const validateSchema = new Ajv2020({ allErrors: true }).compile(schema);
const caseIdPattern = /^(test_int_|test_task_)[A-Za-z0-9_.:-]+$/;

// ACC-1 — every shard file on disk, not just the group-shaped ones the group
// normalizer keeps, must expose canonical case ids.
const shardFiles = readdirSync(groupsRoot).filter((name) => name.endsWith('.shard.json'));
assert.ok(shardFiles.length >= 3, 'expected shard files under tests/catalog/groups');

const namespaceOffenders: string[] = [];
const rawSchemaFailures: string[] = [];
const requiredCaseFailures: string[] = [];
for (const name of shardFiles) {
  const raw = JSON.parse(readFileSync(path.join(groupsRoot, name), 'utf8')) as Record<string, unknown>;
  if (!validateSchema(raw)) {
    rawSchemaFailures.push(`${name}::${JSON.stringify(validateSchema.errors)}`);
  }
  for (const entry of Array.isArray(raw.cases) ? raw.cases : []) {
    const caseId = String((entry as Record<string, unknown>)?.caseId ?? '');
    if (!caseIdPattern.test(caseId)) namespaceOffenders.push(`${name}::${caseId}`);
    const testCase = entry as Record<string, unknown>;
    if (!testCase.responsibility) requiredCaseFailures.push(`${name}::${caseId}::missing-responsibility`);
    if (testCase.responsibility === 'task-required') {
      if (!String(testCase.command ?? '').trim()) requiredCaseFailures.push(`${name}::${caseId}::missing-command`);
      const coverageCount = (Array.isArray(testCase.coversAcceptance) ? testCase.coversAcceptance.length : 0)
        + (Array.isArray(testCase.coversImpactEdges) ? testCase.coversImpactEdges.length : 0);
      if (coverageCount === 0) requiredCaseFailures.push(`${name}::${caseId}::zero-coverage`);
    }
  }
}
assert.deepEqual(rawSchemaFailures, [], `raw shard schema failures:\n${rawSchemaFailures.join('\n')}`);
assert.deepEqual(requiredCaseFailures, [], `required case contract failures:\n${requiredCaseFailures.join('\n')}`);
assert.equal(
  namespaceOffenders.length,
  0,
  `all shard case ids must be canonical; offenders:\n${namespaceOffenders.join('\n')}`
);

// ACC-1 negative control — the already-valid test_task_atm_gov_* ids must survive
// the migration byte-identical.
const allCaseIds = loadAllShardCaseIds(root);
const preservedAtmGovIds = [
  'test_task_atm_gov_0307_incident_corpus_9a1e6b34',
  'test_task_atm_gov_0307_state_replay_4f2d8c71',
  'test_task_atm_gov_0312_coverage_certificate_73b4e0c2',
  'test_task_atm_gov_0312_quality_vector_1d8f6a90',
  'test_task_atm_gov_0313_complete_catalog_schema_contract_7d958211',
  'test_task_atm_gov_0313_historical_shard_namespace_migration_8a48480f'
];
for (const caseId of preservedAtmGovIds) {
  assert.ok(allCaseIds.includes(caseId), `pre-existing valid case id must not be renamed: ${caseId}`);
}

// ACC-2 — the five migrated ids each carry exactly one legacy alias that resolves
// to a real case, the id builder is deterministic, and the new ids do not collide.
const legacyAliases = loadLegacyCaseAliases(root);
const migrated = [
  {
    legacyCaseId: 'test_broker_apply_admission_before_ref_update',
    namespace: 'git_commit_attribution',
    semanticKey: 'admission_before_ref_update'
  },
  {
    legacyCaseId: 'test_sealed_commit_dual_lane_prepare_and_broker_finalization',
    namespace: 'git_commit_attribution',
    semanticKey: 'dual_lane_prepare_and_broker_finalization'
  },
  {
    legacyCaseId: 'test_governed_commit_seal_source_and_provenance_gates',
    namespace: 'git_commit_attribution',
    semanticKey: 'seal_source_and_provenance_gates'
  },
  {
    legacyCaseId: 'test_atm_gov_0277_model_relative_certificate_vocabulary_0d0fd68c',
    namespace: 'atm_gov_0277',
    semanticKey: 'model_relative_certificate_vocabulary'
  },
  {
    legacyCaseId: 'test_atm_gov_0279_obligation_inventory_drift_detector_5c7f6251',
    namespace: 'atm_gov_0279',
    semanticKey: 'obligation_inventory_drift_detector'
  }
];

const canonicalIds = new Set<string>();
for (const entry of migrated) {
  const matches = legacyAliases.filter((alias) => alias.legacyCaseId === entry.legacyCaseId);
  assert.equal(matches.length, 1, `legacy id ${entry.legacyCaseId} must map exactly once`);
  const expected = buildTestCaseId({ kind: 'task', namespace: entry.namespace, semanticKey: entry.semanticKey });
  const repeated = buildTestCaseId({ kind: 'task', namespace: entry.namespace, semanticKey: entry.semanticKey });
  assert.equal(expected, repeated, 'buildTestCaseId must be deterministic');
  assert.equal(matches[0].canonicalCaseId, expected, `legacy id ${entry.legacyCaseId} must map to the derived id`);
  assert.ok(allCaseIds.includes(expected), `canonical case ${expected} must exist in a shard`);
  canonicalIds.add(expected);
}
assert.equal(canonicalIds.size, migrated.length, 'migrated canonical ids must be collision-free');
assert.equal(
  validateLegacyCaseAliases(legacyAliases, allCaseIds).length,
  0,
  'no legacy alias may be unresolvable'
);

// ACC-3 — validation aggregates across shards; a bad shard is reported, never
// silently skipped.
const shards = loadTestCaseGroupShards(root);
const schemaFailures: string[] = [];
for (const shard of shards) {
  const { sourcePath: _sourcePath, ...schemaBody } = shard;
  if (!validateSchema(schemaBody)) schemaFailures.push(shard.groupId);
}
assert.deepEqual(schemaFailures, [], 'live shards must all validate');
assert.equal(validateTestCaseGroupShards(shards).length, 0, 'live shards must be diagnostic-free');

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-plan4-catalog-contract-'));
writeFileSync(path.join(tempRoot, 'bad.shard.json'), JSON.stringify({
  schemaId: 'atm.testCaseGroup.v1',
  specVersion: '0.1.0',
  groupId: 'test_group_bad_namespace',
  theme: 'Bad namespace fixture',
  resourceKey: 'test-group:bad-namespace',
  maintainers: ['atm-core'],
  cases: [
    {
      caseId: 'legacy_uncanonical_case',
      semanticKey: 'uncanonical_case'
    }
  ],
  legacyAliases: [
    {
      legacyCaseId: 'legacy_missing_case',
      canonicalCaseId: 'test_task_missing_case_deadbeef'
    }
  ]
}, null, 2), 'utf8');

const badShards = loadTestCaseGroupShards(root, tempRoot);
assert.equal(badShards.length, 1, 'temp bad shard must be loaded, not skipped');
const { sourcePath: _badSourcePath, ...badBody } = badShards[0];
assert.equal(validateSchema(badBody), false, 'uncanonical case id must be rejected by the schema');
assert.equal(
  validateLegacyCaseAliases(loadLegacyCaseAliases(root, tempRoot), loadAllShardCaseIds(root, tempRoot)).length,
  1,
  'unresolvable legacy alias must be reported'
);
assert.equal(
  validateLegacyCaseAliases(loadLegacyCaseAliases(root, tempRoot), loadAllShardCaseIds(root, tempRoot))[0].code,
  'ATM_TEST_CASE_UNRESOLVED_LEGACY_ALIAS'
);

// ACC-4 — frozen unreachable-shard register.
//
// KNOWN-DEBT REGISTER — SHRINK-ONLY. DO NOT ADD ENTRIES.
//
// `normalizeGroupShard` accepts exactly one schemaId (`atm.testCaseGroup.v1`) and
// silently returns null for everything else. The shards below use four other
// schemaIds, so `loadTestCaseGroupShards` never sees them and their case ids are
// never validated — the validator exits 0 while skipping them. Those shards are
// sealed deliverables of other, already-closed cards, so ATM-GOV-0313 does not
// repair them; it freezes the blind spot instead so it cannot grow.
//
// Ownership: the repair is owned by a follow-up card. Rules for this register:
//   * A new shard with a non-accepted schemaId FAILS this test immediately.
//     That is intended — do not append to the register to make it pass. Give the
//     new shard `schemaId: "atm.testCaseGroup.v1"` and the `cases[]` shape.
//   * Repairing one of the entries below FAILS this test too. That is also
//     intended — delete the repaired row deliberately and lower
//     EXPECTED_HIDDEN_CASE_ID_TOTAL by its count.
//   * Entries may never be added without owner approval.
const UNREACHABLE_SHARD_REGISTER: readonly {
  readonly groupId: string;
  readonly schemaId: string;
  readonly hiddenCaseIds: number;
}[] = [];
const EXPECTED_HIDDEN_CASE_ID_TOTAL = 0;

const reachability = reportShardReachability(root);
assert.equal(reachability.length, shardFiles.length, 'reachability must report every shard file on disk');

const observedUnreachable = reachability
  .filter((entry) => !entry.reachable)
  .map((entry) => ({ groupId: entry.groupId, schemaId: entry.schemaId, hiddenCaseIds: entry.caseIds.length }))
  .sort((left, right) => left.groupId.localeCompare(right.groupId));

// Set equality, not subset: growth and repair must both break the build.
assert.deepEqual(
  observedUnreachable,
  [...UNREACHABLE_SHARD_REGISTER].sort((left, right) => left.groupId.localeCompare(right.groupId)),
  'every shard must use the canonical reachable schema'
);

// The debt is quantified, not merely listed.
assert.equal(
  observedUnreachable.reduce((total, entry) => total + entry.hiddenCaseIds, 0),
  EXPECTED_HIDDEN_CASE_ID_TOTAL,
  'hidden case-id total drifted from the frozen register'
);

// Every reachable shard the register does not name must actually load.
const loadedGroupIds = new Set(shards.map((shard) => shard.groupId));
for (const entry of reachability) {
  if (entry.reachable) {
    assert.ok(loadedGroupIds.has(entry.groupId), `reachable shard ${entry.groupId} must be loaded`);
    continue;
  }
  assert.equal(loadedGroupIds.has(entry.groupId), false, `unreachable shard ${entry.groupId} must not load`);
}

// No hidden case id may be silently counted as validated by the group loader.
const validatedCaseIds = new Set(shards.flatMap((shard) => shard.cases.map((entry) => entry.caseId)));
const falselyValidated = reachability
  .filter((entry) => !entry.reachable)
  .flatMap((entry) => entry.caseIds.filter((caseId) => validatedCaseIds.has(caseId)).map((caseId) => `${entry.groupId}::${caseId}`));
assert.deepEqual(falselyValidated, [], 'hidden case ids must never be reported as validated');

// ACC-5 — a raw legacy id is rejected by the canonical pattern yet still resolves
// through the alias table.
for (const entry of migrated) {
  assert.equal(caseIdPattern.test(entry.legacyCaseId), false, `${entry.legacyCaseId} must fail the canonical pattern`);
  const resolved = resolveLegacyCaseId(entry.legacyCaseId, legacyAliases);
  assert.ok(resolved && allCaseIds.includes(resolved), `${entry.legacyCaseId} must resolve to a live case`);
}
assert.equal(resolveLegacyCaseId('test_never_existed', legacyAliases), null);

// ACC-6 — lineage is preserved rather than deleted, so a rollback can still read
// the pre-migration ids off the shards.
for (const file of [
  'test_group_commit_attribution.shard.json',
  'test_group_plan4_coverage_semantics.shard.json',
  'test_group_plan4_obligation_inventory.shard.json',
  'test_group_plan4_coverage_universe.shard.json',
  'test_group_plan4_mutation_lineage.shard.json',
  'test_group_plan4_quality_gauntlet.shard.json',
  'test_group_plan4_validator_selection.shard.json'
]) {
  const raw = JSON.parse(readFileSync(path.join(groupsRoot, file), 'utf8')) as Record<string, unknown>;
  const entries = Array.isArray(raw.legacyAliases) ? raw.legacyAliases : [];
  assert.ok(entries.length > 0, `${file} must retain its legacyAliases lineage`);
}

// ACC-7 — an unloadable shard fails closed and is named.
//
// The blind spot was never that a shard was malformed; it was that the loader
// answered null and said nothing, so the catalog could report green over case
// ids it had never read. Loading must therefore refuse the whole set and name
// every offending file with its schemaId, and the reachability report must stay
// readable while the loader refuses — a refusal is not a diagnosis.
const unreachableRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-plan4-catalog-unreachable-'));
const usableCase = { caseId: 'test_int_fixture_reachable_aaaaaaaa', semanticKey: 'fixture_reachable' };
writeFileSync(path.join(unreachableRoot, 'good.shard.json'), JSON.stringify({
  schemaId: 'atm.testCaseGroup.v1',
  specVersion: '0.1.0',
  groupId: 'test_group_fixture_good',
  theme: 'Reachable fixture',
  resourceKey: 'test-group:fixture-good',
  maintainers: ['atm-core'],
  cases: [usableCase]
}, null, 2), 'utf8');
assert.equal(loadTestCaseGroupShards(root, unreachableRoot).length, 1, 'a canonical shard must load');
assert.deepEqual(
  reportShardReachability(root, unreachableRoot).map((entry) => entry.unreachableReason),
  [null],
  'a reachable shard reports no reason'
);

writeFileSync(path.join(unreachableRoot, 'legacy-namespace.shard.json'), JSON.stringify({
  schemaId: 'atm.testCatalogGroupShard.v1',
  specVersion: '0.1.0',
  groupId: 'test_group_fixture_legacy_namespace',
  theme: 'Non-canonical schemaId fixture',
  resourceKey: 'test-group:fixture-legacy',
  maintainers: ['atm-core'],
  cases: [{ caseId: 'test_int_fixture_hidden_bbbbbbbb', semanticKey: 'fixture_hidden' }]
}, null, 2), 'utf8');
writeFileSync(path.join(unreachableRoot, 'incomplete.shard.json'), JSON.stringify({
  schemaId: 'atm.testCaseGroup.v1',
  specVersion: '0.1.0',
  groupId: 'test_group_fixture_incomplete',
  theme: '',
  resourceKey: '',
  maintainers: ['atm-core'],
  cases: [{ caseId: 'test_int_fixture_incomplete_cccccccc', semanticKey: 'fixture_incomplete' }]
}, null, 2), 'utf8');

assert.throws(
  () => loadTestCaseGroupShards(root, unreachableRoot),
  (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    assert.ok(message.includes('ATM_TEST_CASE_SHARD_UNREACHABLE'), message);
    assert.ok(message.includes('legacy-namespace.shard.json'), 'the offending file must be named');
    assert.ok(message.includes('atm.testCatalogGroupShard.v1'), 'the rejected schemaId must be named');
    assert.ok(message.includes('incomplete.shard.json'), 'every offender is named in one message');
    assert.ok(/theme/.test(message) && /resourceKey/.test(message), 'the missing fields must be named');
    return true;
  },
  'an unloadable shard must fail closed instead of being skipped'
);

const unreachableReport = reportShardReachability(root, unreachableRoot);
assert.equal(unreachableReport.length, 3, 'the report must survive what the loader refuses');
const reasons = new Map(unreachableReport.map((entry) => [entry.fileName, entry.unreachableReason]));
assert.equal(reasons.get('good.shard.json'), null);
assert.match(String(reasons.get('legacy-namespace.shard.json')), /not the canonical atm\.testCaseGroup\.v1/);
assert.match(String(reasons.get('incomplete.shard.json')), /missing required field\(s\): theme, resourceKey/);
assert.deepEqual(
  unreachableReport.filter((entry) => !entry.reachable).map((entry) => entry.caseIds.length),
  [1, 1],
  'hidden case ids stay countable even when the loader refuses'
);

console.log('[plan4-catalog-contract:test] ok');
