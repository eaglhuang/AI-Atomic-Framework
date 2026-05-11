import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

const schemaEntries = {
  'atomic-spec': 'schemas/atomic-spec.schema.json',
  'atomic-map': 'schemas/registry/atomic-map.schema.json',
  'agent-prompt': 'schemas/agent-prompt.schema.json',
  'execution-evidence': 'schemas/agent-execute/execution-evidence.schema.json',
  'governance-artifact': 'schemas/governance/artifact.schema.json',
  'governance-log': 'schemas/governance/log.schema.json',
  'governance-run-report': 'schemas/governance/run-report.schema.json',
  'governance-state': 'schemas/governance/markdown-json-state.schema.json',
  'governance-evidence': 'schemas/governance/evidence.schema.json',
  'governance-context-summary': 'schemas/governance/context-summary.schema.json',
  'governance-adapter-report': 'schemas/governance/adapter-report.schema.json',
  'governance-atomize-adapter': 'schemas/governance/atomize-adapter.schema.json',
  'governance-infect-adapter': 'schemas/governance/infect-adapter.schema.json',
  'governance-inject-plan': 'schemas/governance/inject-plan.schema.json',
  'governance-rollback-plan': 'schemas/governance/rollback-plan.schema.json',
  'evidence-usage-feedback': 'schemas/governance/evidence/usage-feedback.schema.json',
  'evidence-quality-baseline': 'schemas/governance/evidence/quality-baseline.schema.json',
  'evidence-quality-comparison': 'schemas/governance/evidence/quality-comparison.schema.json',
  'evidence-rollback-proof': 'schemas/governance/evidence/rollback-proof.schema.json',
  'human-review-decision': 'schemas/human-review/decision.schema.json',
  'governance-work-item': 'schemas/governance/work-item.schema.json',
  'governance-scope-lock': 'schemas/governance/scope-lock.schema.json',
  'governance-bundle': 'schemas/governance/governance-bundle.schema.json',
  'police-registry-candidate-report': 'schemas/police/registry-candidate-report.schema.json',
  'upgrade-proposal': 'schemas/upgrade/upgrade-proposal.schema.json',
  'rollback-proof': 'schemas/registry/rollback-proof.schema.json',
  registry: 'schemas/registry.schema.json',
  'registry-v1': 'packages/core/src/registry/registry-v1.schema.json',
  'version-index': 'schemas/registry/version-index.schema.json',
  'regression-matrix': 'schemas/regression-matrix.schema.json',
  'test-report': 'schemas/test-report.schema.json',
  'behavior-proposal': 'schemas/behavior/behavior-proposal.schema.json',
  'polymorphic-template': 'schemas/polymorphism/polymorphic-template.schema.json',
  'dimension-spec': 'schemas/polymorphism/dimension-spec.schema.json'
};

const supportSchemaEntries = {
  'test-report-metrics': 'schemas/test-report/metrics.schema.json'
};

const bannedProtectedSurfaceTerms = [
  ['3K', 'Life'].join(''),
  ['Co', 'cos'].join(''),
  ['cocos', '-creator'].join(''),
  ['html', '-to-', 'ucuf'].join(''),
  ['ga', 'cha'].join(''),
  ['UC', 'UF'].join(''),
  ['draft', '-builder'].join(''),
  ['task', '-lock'].join(''),
  ['compute', '-gate'].join(''),
  ['doc', '-id-', 'registry'].join(''),
  ['tools', '_node/'].join(''),
  ['assets', '/scripts/'].join(''),
  ['docs', '/agent-', 'briefs/'].join('')
];

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function readText(relativePath) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function fail(message) {
  console.error(`[schema:${mode}] ${message}`);
  process.exitCode = 1;
}

function formatErrors(errors) {
  return (errors || [])
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const supportSchemas = loadSchemas(supportSchemaEntries, { enforceMetadata: false });
const schemas = loadSchemas(schemaEntries, {
  enforceMetadata: true,
  metadataExemptSchemaNames: ['version-index']
});

for (const [schemaName, schema] of supportSchemas.entries()) {
  ajv.addSchema(schema, schemaName);
}

for (const [schemaName, schema] of schemas.entries()) {
  ajv.addSchema(schema, schemaName);
}

for (const [schemaName, schema] of supportSchemas.entries()) {
  if (!ajv.validateSchema(schema)) {
    fail(`${supportSchemaEntries[schemaName]} is not a valid JSON Schema: ${formatErrors(ajv.errors)}`);
  }
}

for (const [schemaName, schema] of schemas.entries()) {
  if (!ajv.validateSchema(schema)) {
    fail(`${schemaEntries[schemaName]} is not a valid JSON Schema: ${formatErrors(ajv.errors)}`);
  }
}

const atomicSchema = schemas.get('atomic-spec');
const atomicMapSchema = schemas.get('atomic-map');
const performanceBudget = atomicSchema?.$defs?.performanceBudget;
if (performanceBudget?.properties?.hotPath?.type !== 'boolean') {
  fail('atomic-spec performanceBudget.hotPath must be boolean');
}
const inputMutationEnum = performanceBudget?.properties?.inputMutation?.enum || [];
for (const value of ['forbidden', 'allowed', 'clone-on-write']) {
  if (!inputMutationEnum.includes(value)) {
    fail(`atomic-spec performanceBudget.inputMutation missing enum value: ${value}`);
  }
}

const lifecycleModeEnum = atomicSchema?.$defs?.compatibility?.properties?.lifecycleMode?.enum || [];
for (const value of ['birth', 'evolution']) {
  if (!lifecycleModeEnum.includes(value)) {
    fail(`atomic-spec compatibility.lifecycleMode missing enum value: ${value}`);
  }
}
if (atomicSchema?.properties?.lifecycleMode) {
  fail('atomic-spec lifecycleMode must stay under compatibility, not top-level');
}
if (atomicSchema?.$defs?.semanticFingerprint?.pattern !== '^(?:sf:)?sha256:[a-f0-9]{64}$') {
  fail('atomic-spec semanticFingerprint must accept sf:sha256 fingerprints');
}
if (atomicSchema?.$defs?.lineage?.required?.join(',') !== 'bornBy,parentRefs,bornAt') {
  fail('atomic-spec lineage must require bornBy, parentRefs, and bornAt');
}
if (atomicSchema?.$defs?.ttl?.required?.[0] !== 'expiresAt') {
  fail('atomic-spec ttl must require expiresAt');
}
if (!atomicSchema?.properties?.polymorphicTemplateRef) {
  fail('atomic-spec must expose polymorphicTemplateRef');
}
if (!atomicSchema?.properties?.dimensionSpecRef) {
  fail('atomic-spec must expose dimensionSpecRef');
}
if (!atomicSchema?.properties?.lazyInstantiation) {
  fail('atomic-spec must expose lazyInstantiation');
}
for (const value of ['all-env', 'dev-only', 'staging-only', 'test-only']) {
  if (!atomicSchema?.$defs?.deployScope?.enum?.includes(value)) {
    fail(`atomic-spec deployScope missing enum value: ${value}`);
  }
}
for (const value of ['mutable', 'frozen-after-release', 'immutable']) {
  if (!atomicSchema?.$defs?.mutabilityPolicy?.enum?.includes(value)) {
    fail(`atomic-spec mutabilityPolicy missing enum value: ${value}`);
  }
}
if (atomicMapSchema?.properties?.semanticFingerprint?.oneOf?.length !== 2) {
  fail('atomic-map semanticFingerprint must allow string or null');
}
if (atomicMapSchema?.properties?.pendingSfCalculation?.type !== 'boolean') {
  fail('atomic-map pendingSfCalculation must be boolean');
}

const registrySchema = schemas.get('registry');
if (!registrySchema?.$defs?.registryEntry?.properties?.currentVersion) {
  fail('registry atom entry must expose currentVersion');
}
if (!registrySchema?.$defs?.registryEntry?.properties?.versions) {
  fail('registry atom entry must expose versions');
}
if (registrySchema?.$defs?.registryEntry?.properties?.status?.enum?.join(',') !== 'draft,validated,active,transitioning,deprecated,expired,quarantined') {
  fail('registry atom entry status enum must be draft/validated/active/transitioning/deprecated/expired/quarantined');
}
if (registrySchema?.$defs?.registryEntry?.properties?.governance?.properties?.tier?.enum?.join(',') !== 'constitutional,governed,standard,experimental') {
  fail('registry atom entry governance.tier enum must be constitutional/governed/standard/experimental');
}
if (!registrySchema?.$defs?.registryEntry?.properties?.semanticFingerprint) {
  fail('registry atom entry must expose semanticFingerprint');
}
if (!registrySchema?.$defs?.registryEntry?.properties?.lineageLogRef) {
  fail('registry atom entry must expose lineageLogRef');
}
if (!registrySchema?.$defs?.registryEntry?.properties?.evidenceIndexRef) {
  fail('registry atom entry must expose evidenceIndexRef');
}
if (!registrySchema?.$defs?.registryEntry?.properties?.ttl) {
  fail('registry atom entry must expose ttl');
}
if (!registrySchema?.$defs?.registryVersion?.properties?.semanticFingerprint) {
  fail('registry version record must expose semanticFingerprint');
}
if (registrySchema?.$defs?.mapRegistryEntry?.properties?.semanticFingerprint?.oneOf?.length !== 2) {
  fail('registry map entry must allow semanticFingerprint string or null');
}
if (registrySchema?.$defs?.mapRegistryEntry?.properties?.status?.enum?.join(',') !== 'draft,validated,active,transitioning,deprecated,expired,quarantined') {
  fail('registry map entry status enum must be draft/validated/active/transitioning/deprecated/expired/quarantined');
}
if (registrySchema?.$defs?.mapRegistryEntry?.properties?.governance?.properties?.tier?.enum?.join(',') !== 'constitutional,governed,standard,experimental') {
  fail('registry map entry governance.tier enum must be constitutional/governed/standard/experimental');
}
if (registrySchema?.$defs?.mapRegistryEntry?.properties?.pendingSfCalculation?.type !== 'boolean') {
  fail('registry map entry must expose pendingSfCalculation');
}

const registryV1Schema = schemas.get('registry-v1');
if (registryV1Schema?.$defs?.registryEntry?.properties?.status?.enum?.join(',') !== 'draft,validated,active,transitioning,deprecated,expired,quarantined') {
  fail('registry-v1 atom entry status enum must be draft/validated/active/transitioning/deprecated/expired/quarantined');
}
if (registryV1Schema?.$defs?.registryEntry?.properties?.governance?.properties?.tier?.enum?.join(',') !== 'constitutional,governed,standard,experimental') {
  fail('registry-v1 atom entry governance.tier enum must be constitutional/governed/standard/experimental');
}
if (!registryV1Schema?.$defs?.registryVersion?.properties?.semanticFingerprint) {
  fail('registry-v1 version record must expose semanticFingerprint');
}

const policeRegistryCandidateSchema = schemas.get('police-registry-candidate-report');
if (policeRegistryCandidateSchema?.properties?.candidateStatus?.enum?.join(',') !== 'draft,validated,active,transitioning,deprecated,expired,quarantined') {
  fail('police registry candidate status enum must be draft/validated/active/transitioning/deprecated/expired/quarantined');
}

const versionIndexSchema = schemas.get('version-index');
if (versionIndexSchema?.minProperties !== 1) {
  fail('version-index must require at least one row');
}
if (!versionIndexSchema?.$defs?.versionIndexRow?.properties?.latest) {
  fail('version-index row must expose latest');
}
if (!versionIndexSchema?.$defs?.versionIndexRow?.properties?.versions) {
  fail('version-index row must expose versions');
}

const manifestPath = 'tests/schema-fixtures/manifest.json';
const manifest = readJson(manifestPath);
for (const fixture of manifest.positive || []) {
  const validate = ajv.getSchema(fixture.schema);
  if (!validate) {
    fail(`unknown positive fixture schema: ${fixture.schema}`);
    continue;
  }
  const relativePath = `tests/schema-fixtures/${fixture.path}`;
  const valid = validate(readJson(relativePath));
  if (!valid) {
    fail(`positive fixture failed (${fixture.name}): ${formatErrors(validate.errors)}`);
  }
}

for (const fixture of manifest.negative || []) {
  const validate = ajv.getSchema(fixture.schema);
  if (!validate) {
    fail(`unknown negative fixture schema: ${fixture.schema}`);
    continue;
  }
  const relativePath = `tests/schema-fixtures/${fixture.path}`;
  const valid = validate(readJson(relativePath));
  if (valid) {
    fail(`negative fixture unexpectedly passed: ${fixture.name}`);
    continue;
  }
  const matched = (validate.errors || []).some((error) => {
    if (error.keyword !== fixture.expectedKeyword) {
      return false;
    }
    if (fixture.expectedMissingProperty) {
      return error.params?.missingProperty === fixture.expectedMissingProperty;
    }
    return true;
  });
  if (!matched) {
    fail(`negative fixture did not produce expected ${fixture.expectedKeyword}: ${fixture.name}; got ${formatErrors(validate.errors)}`);
  }
}

const protectedFiles = [
  ...Object.values(schemaEntries),
  ...Object.values(supportSchemaEntries),
  'schemas/README.md',
  'scripts/validate-schemas.mjs',
  manifestPath,
  ...readdirSync(path.join(root, 'tests', 'schema-fixtures', 'positive')).map((entry) => `tests/schema-fixtures/positive/${entry}`),
  ...readdirSync(path.join(root, 'tests', 'schema-fixtures', 'negative')).map((entry) => `tests/schema-fixtures/negative/${entry}`)
];

const upgradeFixtureDir = path.join(root, 'fixtures', 'upgrade');
if (existsSync(upgradeFixtureDir)) {
  protectedFiles.push(...readdirSync(upgradeFixtureDir).map((entry) => `fixtures/upgrade/${entry}`));
}

const humanReviewFixtureDir = path.join(root, 'fixtures', 'human-review');
if (existsSync(humanReviewFixtureDir)) {
  protectedFiles.push(...readdirSync(humanReviewFixtureDir).map((entry) => `fixtures/human-review/${entry}`));
}

const rollbackFixtureDir = path.join(root, 'fixtures', 'rollback');
if (existsSync(rollbackFixtureDir)) {
  protectedFiles.push(...readdirSync(rollbackFixtureDir).map((entry) => `fixtures/rollback/${entry}`));
}

for (const relativePath of protectedFiles) {
  const content = readText(relativePath);
  for (const term of bannedProtectedSurfaceTerms) {
    if (content.includes(term)) {
      fail(`${relativePath} contains downstream-only term: ${term}`);
    }
  }
}

if (!process.exitCode) {
  console.log(`[schema:${mode}] ok (${Object.keys(schemaEntries).length} schemas, ${manifest.positive.length} positive fixtures, ${manifest.negative.length} negative fixtures)`);
}

function loadSchemas(entries, options = {}) {
  const loadedSchemas = new Map();
  const metadataExemptSchemaNames = new Set(options.metadataExemptSchemaNames ?? []);
  for (const [schemaName, relativePath] of Object.entries(entries)) {
    if (!existsSync(path.join(root, relativePath))) {
      fail(`missing schema file: ${relativePath}`);
      continue;
    }
    const schema = readJson(relativePath);
    if (!schema.$id || !schema.$schema) {
      fail(`${relativePath} must define $id and $schema`);
    }
    if (options.enforceMetadata && !metadataExemptSchemaNames.has(schemaName)) {
      for (const requiredMetadata of ['schemaId', 'specVersion', 'migration']) {
        if (!schema.required?.includes(requiredMetadata)) {
          fail(`${relativePath} must require ${requiredMetadata}`);
        }
      }
    }
    loadedSchemas.set(schemaName, schema);
  }
  return loadedSchemas;
}
