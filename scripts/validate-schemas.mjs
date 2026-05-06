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
  registry: 'schemas/registry.schema.json',
  'regression-matrix': 'schemas/regression-matrix.schema.json',
  'test-report': 'schemas/test-report.schema.json'
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

const schemas = new Map();
for (const [schemaName, relativePath] of Object.entries(schemaEntries)) {
  if (!existsSync(path.join(root, relativePath))) {
    fail(`missing schema file: ${relativePath}`);
    continue;
  }
  const schema = readJson(relativePath);
  if (!ajv.validateSchema(schema)) {
    fail(`${relativePath} is not a valid JSON Schema: ${formatErrors(ajv.errors)}`);
    continue;
  }
  for (const requiredMetadata of ['schemaId', 'specVersion', 'migration']) {
    if (!schema.required?.includes(requiredMetadata)) {
      fail(`${relativePath} must require ${requiredMetadata}`);
    }
  }
  if (!schema.$id || !schema.$schema) {
    fail(`${relativePath} must define $id and $schema`);
  }
  schemas.set(schemaName, schema);
  ajv.addSchema(schema, schemaName);
}

const atomicSchema = schemas.get('atomic-spec');
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
  'schemas/README.md',
  'scripts/validate-schemas.mjs',
  manifestPath,
  ...readdirSync(path.join(root, 'tests', 'schema-fixtures', 'positive')).map((entry) => `tests/schema-fixtures/positive/${entry}`),
  ...readdirSync(path.join(root, 'tests', 'schema-fixtures', 'negative')).map((entry) => `tests/schema-fixtures/negative/${entry}`)
];

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