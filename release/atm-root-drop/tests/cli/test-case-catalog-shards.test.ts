import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import {
  buildTestCaseId,
  generateReadOnlyTestCaseCatalog,
  loadTestCaseGroupShards,
  normalizeSemanticKey,
  validateTestCaseGroupShards
} from '../../packages/cli/src/commands/test-catalog.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const schema = JSON.parse(readFileSync(
  path.join(root, 'schemas/validators/test-case-group.schema.json'),
  'utf8'
));
const validateSchema = new Ajv2020({ allErrors: true }).compile(schema);

const stableA = buildTestCaseId({
  kind: 'int',
  namespace: 'runner_sync',
  semanticKey: 'actor_continuity'
});
const stableB = buildTestCaseId({
  kind: 'int',
  namespace: 'runner_sync',
  semanticKey: 'actor_continuity'
});
assert.equal(stableA, stableB, 'IDs must be deterministic');
assert.match(stableA, /^test_int_runner_sync_actor_continuity_[a-f0-9]{8}$/);
assert.notEqual(
  buildTestCaseId({ kind: 'int', namespace: 'runner_sync', semanticKey: 'actor_continuity' }),
  buildTestCaseId({ kind: 'task', namespace: 'runner_sync', semanticKey: 'actor_continuity' })
);
assert.equal(normalizeSemanticKey('Actor Continuity!!'), 'actor_continuity');

const shards = loadTestCaseGroupShards(root);
assert.ok(shards.length >= 2, 'expected fixture shards under tests/catalog/groups');
for (const shard of shards) {
  const { sourcePath: _sourcePath, ...schemaBody } = shard;
  assert.equal(validateSchema(schemaBody), true, `shard ${shard.groupId} must validate`);
}

const okCatalog = generateReadOnlyTestCaseCatalog(shards, { generatedAt: '2026-07-25T00:00:00.000Z' });
assert.equal(okCatalog.schemaId, 'atm.generatedTestCaseCatalog.v1');
assert.equal(okCatalog.queryAuthorityOnly, true);
assert.equal(okCatalog.mutableRegistry, false);
assert.equal(okCatalog.diagnostics.length, 0);
assert.ok(okCatalog.cases.some((entry) => entry.caseId.startsWith('test_int_')));
assert.ok(okCatalog.cases.some((entry) => entry.aliases.length > 0));
assert.ok(okCatalog.cases.some((entry) => entry.promotedTo));

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-test-case-shards-'));
const badShardPath = path.join(tempRoot, 'bad.shard.json');
writeFileSync(badShardPath, JSON.stringify({
  schemaId: 'atm.testCaseGroup.v1',
  specVersion: '0.1.0',
  groupId: 'test_group_bad',
  theme: 'Bad fixtures',
  resourceKey: 'test-group:bad',
  maintainers: [],
  cases: [
    {
      caseId: 'test_int_bad_one_aaaaaaaa',
      semanticKey: 'dup_key'
    },
    {
      caseId: 'test_int_bad_two_bbbbbbbb',
      semanticKey: 'dup_key',
      dependsOnCaseIds: ['test_int_missing_cccccccc']
    }
  ],
  aliases: [
    {
      aliasId: 'test_int_bad_alias_dddddddd',
      canonicalCaseId: 'test_int_missing_cccccccc'
    }
  ],
  lineage: [
    {
      caseId: 'test_int_bad_one_aaaaaaaa',
      promotedTo: 'test_int_bad_cycle_eeeeeeee'
    },
    {
      caseId: 'test_int_bad_cycle_eeeeeeee',
      promotedTo: 'test_int_bad_one_aaaaaaaa'
    }
  ]
}, null, 2), 'utf8');

const badShards = loadTestCaseGroupShards(root, tempRoot);
const badDiagnostics = validateTestCaseGroupShards(badShards);
const codes = new Set(badDiagnostics.map((entry) => entry.code));
assert.ok(codes.has('ATM_TEST_CASE_GROUP_MISSING_OWNER'));
assert.ok(codes.has('ATM_TEST_CASE_SEMANTIC_DUPLICATE'));
assert.ok(codes.has('ATM_TEST_CASE_UNRESOLVED_REFERENCE'));
assert.ok(codes.has('ATM_TEST_CASE_UNRESOLVED_ALIAS'));
assert.ok(codes.has('ATM_TEST_CASE_LINEAGE_CYCLE'));

console.log('[test-case-catalog-shards:test] ok');
