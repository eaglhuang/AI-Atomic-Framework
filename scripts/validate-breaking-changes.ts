import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode') ? process.argv[process.argv.indexOf('--mode') + 1] : 'validate';

function fail(message: string) {
  console.error(`[breaking-changes:${mode}] ${message}`);
  process.exitCode = 1;
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

const matrix = readJson('compatibility-matrix.json');
const defaultGuardsSchema = readJson('schemas/governance/default-guards.schema.json');
const releaseWorkflow = readFileSync(path.join(root, '.github', 'workflows', 'release-npm.yml'), 'utf8');

const schemaVersionConst = defaultGuardsSchema.properties?.schemaVersion?.const;
assert(schemaVersionConst === 'atm.defaultGuards.v0.1', 'default-guards schemaVersion const must stay explicit');
assert(defaultGuardsSchema.properties?.versionContract, 'default-guards schema must expose optional versionContract for chart/template evolution');
assert(defaultGuardsSchema.$defs?.migration?.properties?.notes?.minLength === 1, 'migration.notes must require non-empty guidance');
assert(defaultGuardsSchema.$defs?.migration?.properties?.strategy?.enum?.includes('breaking'), 'migration.strategy must include breaking');

for (const chartVersion of matrix.atmChartVersions ?? []) {
  assert(chartVersion.version, 'each atmChartVersions entry must declare version');
  assert(chartVersion.sourceSchemaVersion === schemaVersionConst, `chart ${chartVersion.version} sourceSchemaVersion must match default-guards schema`);
  assert(chartVersion.minFrameworkVersion, `chart ${chartVersion.version} must declare minFrameworkVersion`);
  if (chartVersion.status === 'unsupported') {
    assert(typeof chartVersion.migrationGuide === 'string' && chartVersion.migrationGuide.trim().length > 0, `unsupported chart ${chartVersion.version} must include migrationGuide`);
  }
}

for (const templateVersion of matrix.agentTemplateVersions ?? []) {
  assert(templateVersion.version, 'each agentTemplateVersions entry must declare version');
  assert(templateVersion.minFrameworkVersion, `template ${templateVersion.version} must declare minFrameworkVersion`);
  if (templateVersion.status === 'unsupported') {
    assert(typeof templateVersion.migrationGuide === 'string' && templateVersion.migrationGuide.trim().length > 0, `unsupported template ${templateVersion.version} must include migrationGuide`);
  }
}

assert(releaseWorkflow.includes('scripts/validate-version-compatibility.ts --mode validate --release-tag "$GITHUB_REF_NAME"'), 'release workflow must validate tag/package/matrix version compatibility before publish');
assert(releaseWorkflow.indexOf('Set npm package versions from tag') < releaseWorkflow.indexOf('Validate release version compatibility'), 'release version compatibility must run after package versions are set from tag');

if (!process.exitCode) {
  console.log(`[breaking-changes:${mode}] ok (migration guide gate, schema version contract, release gate)`);
}
