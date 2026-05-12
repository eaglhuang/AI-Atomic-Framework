import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateDependencyGraph } from '../packages/core/src/police/dependency-graph.mjs';
import { validateForbiddenImports } from '../packages/core/src/police/forbidden-import-scanner.mjs';
import { validateLayerBoundary } from '../packages/core/src/police/layer-boundary.mjs';
import { validateRegistryConsistency } from '../packages/core/src/police/registry-consistency.mjs';
import { createSchemaValidator, validateJsonDocument } from '../packages/core/src/police/schema-validator.mjs';
import { runPoliceChecks } from '../packages/core/src/police/index.mjs';
import { runLifecyclePolice, LIFECYCLE_POLICE_WRITER } from '../packages/plugin-rule-guard/src/lifecycle-police.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const fixture = readJson('tests/police.fixture.json');

const protectedFiles = [
  'packages/plugin-sdk/src/police.ts',
  'packages/plugin-sdk/src/index.ts',
  'packages/core/src/police/index.mjs',
  'packages/core/src/police/schema-validator.mjs',
  'packages/core/src/police/dependency-graph.mjs',
  'packages/core/src/police/layer-boundary.mjs',
  'packages/core/src/police/forbidden-import-scanner.mjs',
  'packages/core/src/police/registry-consistency.mjs',
  'packages/plugin-rule-guard/src/lifecycle-police.ts',
  'schemas/layer-policy.schema.json',
  'schemas/police/non-regression-report.schema.json',
  'schemas/police/quality-comparison-report.schema.json',
  'schemas/police/registry-candidate-report.schema.json',
  'schemas/police/lifecycle-finding.schema.json',
  'schemas/police/lifecycle-notice.schema.json',
  'scripts/validate-police.mjs',
  'tests/police.fixture.json'
];

const bannedProtectedSurfaceTerms = [
  ['3K', 'Life'].join(''),
  ['Co', 'cos'].join(''),
  ['html', '-to-', 'ucuf'].join(''),
  ['ga', 'cha'].join(''),
  ['UC', 'UF'].join(''),
  ['task', '-lock'].join(''),
  ['compute', '-gate'].join(''),
  ['doc', '-id-', 'registry'].join(''),
  ['tools', '_node/'].join(''),
  ['assets', '/scripts/'].join(''),
  ['docs', '/agent-', 'briefs/'].join('')
];

function fail(message) {
  console.error(`[police:${mode}] ${message}`);
  process.exitCode = 1;
}

function check(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function readText(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function validateSchemaFixtures() {
  const ajv = createSchemaValidator();
  for (const entry of fixture.schemaFixtures) {
    const schema = readJson(entry.schemaPath);
    check(ajv.validateSchema(schema), `${entry.schemaPath} must be a valid JSON Schema`);
    for (const requiredMetadata of ['schemaId', 'specVersion', 'migration']) {
      check(schema.required?.includes(requiredMetadata), `${entry.schemaPath} must require ${requiredMetadata}`);
    }
    const positive = validateJsonDocument(readJson(entry.positivePath), schema, { ajv, checkId: entry.name });
    check(positive.ok, `positive schema fixture failed: ${entry.name} ${positive.errors.join('; ')}`);
    if (entry.negativePath) {
      const negative = validateJsonDocument(readJson(entry.negativePath), schema, { ajv, checkId: entry.name });
      check(!negative.ok, `negative schema fixture unexpectedly passed: ${entry.name}`);
    }
  }
}

function validateDependencyGraphFixtures() {
  const positive = validateDependencyGraph(readJson(fixture.dependencyGraph.positivePath));
  check(positive.ok, 'positive dependency graph fixture must be acyclic');
  const negative = validateDependencyGraph(readJson(fixture.dependencyGraph.negativePath));
  check(!negative.ok, 'negative dependency graph fixture must fail cycle detection');
  check(negative.violations.some((violation) => violation.code === 'ATM_POLICE_DEPENDENCY_CYCLE'), 'cycle fixture must report ATM_POLICE_DEPENDENCY_CYCLE');
}

function validateLayerBoundaryFixtures() {
  const policy = readJson(fixture.layerBoundary.policyPath);
  const positive = validateLayerBoundary(readJson(fixture.layerBoundary.positivePath), policy);
  check(positive.ok, 'positive layer boundary fixture must pass');
  const negative = validateLayerBoundary(readJson(fixture.layerBoundary.negativePath), policy);
  check(!negative.ok, 'negative layer boundary fixture must fail');
  check(negative.violations.some((violation) => violation.code === 'ATM_POLICE_LAYER_BOUNDARY'), 'boundary fixture must report ATM_POLICE_LAYER_BOUNDARY');
}

function validateForbiddenImportFixtures() {
  const positive = validateForbiddenImports(readJson(fixture.forbiddenImport.positivePath), fixture.forbiddenImport.forbiddenPatterns);
  check(positive.ok, 'positive forbidden import fixture must pass');
  const negative = validateForbiddenImports(readJson(fixture.forbiddenImport.negativePath), fixture.forbiddenImport.forbiddenPatterns);
  check(!negative.ok, 'negative forbidden import fixture must fail');
  check(negative.violations.some((violation) => violation.code === 'ATM_POLICE_FORBIDDEN_IMPORT'), 'forbidden fixture must report ATM_POLICE_FORBIDDEN_IMPORT');
}

function validateRegistryGateFixtures() {
  const positiveGate = readJson(fixture.registryGate.positivePath);
  const positive = validateRegistryConsistency(positiveGate);
  check(positive.ok && positive.canPromote, 'positive evolution registry gate must allow promote');
  const negativeGate = readJson(fixture.registryGate.negativePath);
  const negative = validateRegistryConsistency(negativeGate);
  check(!negative.ok && !negative.canPromote, 'negative evolution registry gate must block promote');
  check(negative.violations.some((violation) => violation.code === 'ATM_POLICE_PROMOTE_BLOCKED'), 'registry gate fixture must report ATM_POLICE_PROMOTE_BLOCKED');
}

function validateAtomicMapIntegration() {
  const mapFixture = readJson(fixture.atomicMap.fixturePath);
  const policy = readJson(fixture.layerBoundary.policyPath);
  const importGraph = readJson(fixture.layerBoundary.positivePath);
  const registryGate = readJson(fixture.registryGate.positivePath);
  const report = runPoliceChecks({
    lifecycleMode: 'evolution',
    mapFixture,
    layerPolicy: policy,
    importGraph,
    forbiddenPatterns: fixture.forbiddenImport.forbiddenPatterns,
    registryGate
  });
  check(report.ok, 'Police Atomic Map integration report must pass');
  check(report.canPromote, 'Police Atomic Map integration report must allow promote');
  check(report.lifecycleMode === 'evolution', 'Police report must preserve lifecycleMode=evolution');
  check(report.checks.length === 4, 'Police runner must execute dependency, layer, forbidden import, and registry checks');
}

function validateLifecyclePoliceFixtures() {
  const positive = readJson(fixture.lifecyclePolice.positivePath);
  const positiveReport = runLifecyclePolice(positive);
  check(positiveReport.schemaId === 'atm.lifecyclePoliceReport', 'lifecycle police report schemaId mismatch');
  check(positiveReport.quarantineWriteGuard.writer === LIFECYCLE_POLICE_WRITER, 'lifecycle police writer id mismatch');
  check(positiveReport.quarantineWriteGuard.allowed, 'lifecycle police writer must be allowed to write quarantine');
  check(positiveReport.findings.some((finding) => finding.trigger === 'ttl-expired' && finding.action === 'expire'), 'lifecycle police must emit ttl-expired expire finding');
  check(positiveReport.findings.some((finding) => finding.trigger === 'illegal-transition' && finding.action === 'quarantine'), 'lifecycle police must emit illegal-transition quarantine finding');
  check(positiveReport.notices.length > 0, 'lifecycle police must emit caller migration notices');

  const negativeProduction = readJson(fixture.lifecyclePolice.negativeProductionPath);
  const negativeReport = runLifecyclePolice(negativeProduction);
  check(negativeReport.hardFail, 'dev-only atom in production build must hard-fail lifecycle police report');
  check(negativeReport.findings.some((finding) => finding.trigger === 'deploy-scope-violation' && finding.action === 'hard-fail'), 'lifecycle police must emit deploy-scope-violation hard-fail finding');
}

function validateProtectedSurfaceNeutrality() {
  for (const relativePath of protectedFiles) {
    check(existsSync(path.join(root, relativePath)), `protected police file is missing: ${relativePath}`);
    const content = readText(relativePath);
    for (const term of bannedProtectedSurfaceTerms) {
      check(!content.includes(term), `${relativePath} contains downstream-only term: ${term}`);
    }
  }
}

validateSchemaFixtures();
validateDependencyGraphFixtures();
validateLayerBoundaryFixtures();
validateForbiddenImportFixtures();
validateRegistryGateFixtures();
validateAtomicMapIntegration();
validateLifecyclePoliceFixtures();
validateProtectedSurfaceNeutrality();

if (!process.exitCode) {
  console.log(`[police:${mode}] ok (${fixture.acceptance.length} acceptance checks)`);
}
