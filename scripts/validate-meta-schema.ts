import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { installManifestSchemaVersion, legacyInstallManifestSchemaVersion, readInstallManifestSchemaVersion } from '../packages/agent-pack-sdk/src/install-manifest.ts';
import { atmChartFrontmatterSchemaVersion } from '../packages/cli/src/commands/atm-chart.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = readArg('--mode') ?? 'validate';

function fail(code: string, message: string) {
  console.error(`[meta-schema:${mode}] FAIL code=${code} message=${message}`);
  process.exitCode = 1;
}

function assert(condition: unknown, code: string, message: string) {
  if (!condition) fail(code, message);
}

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function readText(relativePath: string) {
  return readFileSync(path.join(root, relativePath), 'utf8');
}

function formatErrors(errors: any) {
  return (errors || []).map((error: any) => `${error.instancePath || '/'} ${error.message}`).join('; ');
}

const requiredFiles = [
  'compatibility-matrix.json',
  'schemas/governance/compatibility-matrix.schema.json',
  'schemas/charter/charter-invariants.schema.json',
  'schemas/integrations/install-manifest.schema.json',
  'packages/agent-pack-sdk/src/install-manifest.ts',
  'packages/cli/src/commands/atm-chart.ts',
  'docs/META_SCHEMA.md',
  'tests/meta-schema/legacy-install-manifest.json',
  'tests/meta-schema/new-install-manifest.json',
  'tests/meta-schema/legacy-atm-chart.md',
  'tests/meta-schema/meta-schema.test.ts',
  'scripts/validators.config.json'
];

for (const file of requiredFiles) {
  assert(existsSync(path.join(root, file)), 'META_SCHEMA_FILE_MISSING', `${file} must exist`);
}

const compatibilityMatrix = readJson('compatibility-matrix.json');
const compatibilitySchema = readJson('schemas/governance/compatibility-matrix.schema.json');
const installManifestSchema = readJson('schemas/integrations/install-manifest.schema.json');
const invariantsSchema = readJson('schemas/charter/charter-invariants.schema.json');

assert(compatibilityMatrix.schemaVersion === 'atm.compatibilityMatrix.v0.1', 'META_SCHEMA_COMPAT_MATRIX_VERSION_INVALID', 'compatibility-matrix.json must use atm.compatibilityMatrix.v0.1');
assert(compatibilitySchema.$defs?.activeMatrix?.properties?.schemaVersion?.const === 'atm.compatibilityMatrix.v0.1', 'META_SCHEMA_COMPAT_SCHEMA_MISSING', 'compatibility-matrix schema must declare atm.compatibilityMatrix.v0.1');
assert(installManifestSchema.properties?.schemaVersion?.const === installManifestSchemaVersion, 'META_SCHEMA_INSTALL_MANIFEST_CONST_MISSING', 'install manifest schema must declare atm.installManifest.v0.1');
assert(installManifestSchema.required?.includes('schemaVersion'), 'META_SCHEMA_INSTALL_MANIFEST_REQUIRED_MISSING', 'install manifest schemaVersion must be required for strict v0.1 validation');
assert(invariantsSchema.properties?.schemaVersion?.const === 'atm.invariants.v0.1', 'META_SCHEMA_INVARIANTS_CONST_MISSING', 'charter invariants schema must declare atm.invariants.v0.1');
assert(invariantsSchema.required?.includes('schemaVersion'), 'META_SCHEMA_INVARIANTS_REQUIRED_MISSING', 'charter invariants schemaVersion must be required');

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
assert(ajv.validateSchema(installManifestSchema), 'META_SCHEMA_INSTALL_SCHEMA_INVALID', `install manifest schema is invalid: ${formatErrors(ajv.errors)}`);
const validateInstallManifest = ajv.compile(installManifestSchema);
const newManifest = readJson('tests/meta-schema/new-install-manifest.json');
assert(validateInstallManifest(newManifest), 'META_SCHEMA_INSTALL_FIXTURE_INVALID', `new install manifest fixture must pass strict schema: ${formatErrors(validateInstallManifest.errors)}`);

const legacyManifest = readJson('tests/meta-schema/legacy-install-manifest.json');
const legacyStrictValid = validateInstallManifest(legacyManifest);
assert(!legacyStrictValid, 'META_SCHEMA_LEGACY_INSTALL_STRICTLY_VALID', 'legacy install manifest without schemaVersion must not pass strict v0.1 schema');
const legacyRead = readInstallManifestSchemaVersion(legacyManifest);
assert(legacyRead.schemaVersion === legacyInstallManifestSchemaVersion, 'META_SCHEMA_LEGACY_INSTALL_VERSION_WRONG', 'legacy install manifest must be read as atm.installManifest.v0.0');
assert(legacyRead.warnings.some((warning) => warning.code === 'ATM_INSTALL_MANIFEST_LEGACY_SCHEMA_VERSION'), 'META_SCHEMA_LEGACY_INSTALL_WARN_MISSING', 'legacy install manifest read must emit a migration warning');

const generatedChart = renderChartFixture();
const generatedChartVersion = readAtmChartFrontmatterSchemaVersion(generatedChart);
assert(generatedChartVersion === atmChartFrontmatterSchemaVersion, 'META_SCHEMA_ATM_CHART_VERSION_MISSING', 'rendered ATMChart frontmatter must include schema_version: atm.atmChart.v0.1');
const legacyChartVersion = readAtmChartFrontmatterSchemaVersion(readText('tests/meta-schema/legacy-atm-chart.md'));
assert(legacyChartVersion === 'atm.atmChart.v0.0', 'META_SCHEMA_LEGACY_ATM_CHART_VERSION_WRONG', 'legacy ATMChart without schema_version must be treated as atm.atmChart.v0.0');

const validatorsConfig = readJson('scripts/validators.config.json');
assert(validatorsConfig.profiles?.standard?.validators?.includes('validate-meta-schema'), 'META_SCHEMA_STANDARD_PROFILE_MISSING', 'standard profile must include validate-meta-schema');
const validatorEntry = validatorsConfig.validators?.find((entry: any) => entry?.name === 'validate-meta-schema');
assert(validatorEntry?.entry === 'scripts/validate-meta-schema.ts', 'META_SCHEMA_VALIDATOR_ENTRY_MISSING', 'validators.config.json must register scripts/validate-meta-schema.ts');

if (!process.exitCode && mode !== 'test') {
  const testResult = spawnSync(process.execPath, ['--strip-types', path.join(root, 'tests/meta-schema/meta-schema.test.ts')], {
    cwd: root,
    encoding: 'utf8'
  });
  if (testResult.status !== 0) {
    fail('META_SCHEMA_TEST_FAILED', `tests/meta-schema/meta-schema.test.ts failed stdout=${JSON.stringify(testResult.stdout)} stderr=${JSON.stringify(testResult.stderr)}`);
  }
}

if (!process.exitCode) {
  console.log(`[meta-schema:${mode}] ok — schemaVersion contracts, legacy manifest warning, ATMChart frontmatter, and standard validator registration verified`);
}

function renderChartFixture() {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-meta-schema-'));
  try {
    const bootstrap = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), 'bootstrap', '--cwd', tempRoot, '--json'], {
      cwd: root,
      encoding: 'utf8'
    });
    assert(bootstrap.status === 0, 'META_SCHEMA_BOOTSTRAP_FAILED', `bootstrap fixture failed: ${bootstrap.stdout}${bootstrap.stderr}`);
    const render = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), 'atm-chart', 'render', '--cwd', tempRoot, '--json'], {
      cwd: root,
      encoding: 'utf8'
    });
    assert(render.status === 0, 'META_SCHEMA_ATM_CHART_RENDER_FAILED', `atm-chart render fixture failed: ${render.stdout}${render.stderr}`);
    return readFileSync(path.join(tempRoot, '.atm', 'memory', 'atm-chart.md'), 'utf8');
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function readAtmChartFrontmatterSchemaVersion(content: string) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return 'atm.atmChart.v0.0';
  const fields = Object.fromEntries(match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf(':');
      return separatorIndex > 0
        ? [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim()]
        : [line, ''];
    }));
  return fields.schema_version || 'atm.atmChart.v0.0';
}

function readArg(flag: string) {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : null;
}
