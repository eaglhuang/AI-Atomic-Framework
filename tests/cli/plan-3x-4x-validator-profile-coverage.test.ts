import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveValidationObligations } from '../../packages/cli/src/commands/validation-obligations.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (relativePath: string): any => JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
const readText = (relativePath: string): string => readFileSync(path.join(root, relativePath), 'utf8');

const shard = readJson('tests/catalog/groups/test_group_plan_3x_4x_complete_closeout.shard.json');
assert.equal(shard.schemaId, 'atm.testCaseGroup.v1');
assert.ok(shard.supportedSeams.includes('atm.testCaseCatalog.v1'));
assert.ok(shard.supportedSeams.includes('atm.validatorProfileResponsibility.v1'));
const closureCase = shard.cases.find((entry: any) =>
  entry.caseId === 'test_task_atm_gov_0329_plan_3x_4x_catalog_profile_coverage_fad18eba'
);
assert.equal(closureCase?.responsibility, 'task-required');
assert.deepEqual([...closureCase.coversAcceptance].sort(), ['ACC-1', 'ACC-2', 'ACC-3', 'ACC-4', 'ACC-5']);
assert.ok(shard.legacyAliases.some((entry: any) =>
  entry.legacyCaseId === 'test_plan_3x_4x_catalog_profile_coverage_0329'
  && entry.canonicalCaseId === closureCase.caseId
));

const groupRoot = path.join(root, 'tests/catalog/groups');
const groupFiles = readFileSync(path.join(root, 'tests/cli/plan4-catalog-contract.test.ts'), 'utf8');
assert.match(groupFiles, /EXPECTED_HIDDEN_CASE_ID_TOTAL = 0/);
const requiredNegativeControls = new Set([
  'plan4_certificate_binding_stale_replay',
  'obligation_inventory_drift_detector',
  'plan4_hidden_negative_control_fail_closed',
  'plan4_exam_authority_separation'
]);
const allCases = readdirSync(groupRoot)
  .filter((name: string) => name.endsWith('.shard.json'))
  .map((name: string) => readJson(`tests/catalog/groups/${name}`))
  .flatMap((entry: any) => entry.cases ?? []);
assert.equal(new Set(allCases.map((entry: any) => entry.caseId)).size, allCases.length, 'catalog case ids must be unique');
assert.ok(allCases.length > 0 && allCases.every((entry: any) => entry.caseId && entry.semanticKey));
for (const semanticKey of requiredNegativeControls) {
  const control = allCases.find((entry: any) => entry.semanticKey === semanticKey);
  assert.equal(control?.responsibility, 'task-required', `${semanticKey} must be a required negative control`);
  assert.ok(control?.command, `${semanticKey} must be executable`);
}

const catalog = readJson('scripts/test-catalog.config.json');
assert.equal(catalog.schemaId, 'atm.testCatalog.v1');
assert.equal(catalog.caseGroupShards.root, 'tests/catalog/groups');
const profiles = readJson('scripts/validators.config.json').profiles;
assert.ok(profiles.standard.validators.includes('validate-module-boundaries'));
assert.ok(profiles.standard.validators.includes('validate-test-facade'));
assert.equal(profiles.full.extends, 'standard');

const obligation = resolveValidationObligations([
  'scripts/test-catalog.config.json',
  'scripts/validators.config.json',
  '.github/workflows/ci.yml',
  '.github/workflows/release-npm.yml'
]);
assert.ok(obligation.validators.includes('validate-test-facade'));
assert.ok(obligation.validators.includes('validate-module-boundaries'));

const ciWorkflow = readText('.github/workflows/ci.yml');
assert.match(ciWorkflow, /npm run typecheck/);
assert.match(ciWorkflow, /npm run lint/);
assert.match(ciWorkflow, /npm test/);
assert.match(ciWorkflow, /npm run validate:standard/);

const releaseWorkflow = readText('.github/workflows/release-npm.yml');
for (const expected of [
  'npm run validate:release-prepublish -- --run-id',
  'npm run validate:full -- --run-id',
  'npm run validate:root-drop-release',
  'npm run validate:onefile-release',
  'npm run validate:runner-reproducibility',
  'release/atm-onefile/atm.mjs --version',
  'release/atm-root-drop/atm.mjs --version',
  'release/sbom.json',
  'npm pack --workspaces --dry-run'
]) assert.ok(releaseWorkflow.includes(expected), `release workflow must include ${expected}`);
assert.match(releaseWorkflow, /Post-publish full validation/);

const runnerSource = readText('scripts/run-validators/implementation.ts');
for (const contractMarker of [
  '--run-id', '--resume', '--status', 'summary.partial.json', 'killAllRunningValidatorChildren',
  'atm.validatorDag.v1', 'atm.validatorSelectionReport.v1', 'cacheDecision', 'durationMs',
  'timedOut', 'outputDigest'
]) assert.ok(runnerSource.includes(contractMarker), `validator runner must expose ${contractMarker}`);

console.log('plan 3x/4x validator profile coverage: ok');
