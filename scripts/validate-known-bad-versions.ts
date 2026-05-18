import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { isSemverVersion, isSupportedKnownBadRange } from '../packages/cli/src/startup-known-bad.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';

function fail(code: string, message: string) {
  console.error(`[known-bad-versions:${mode}] FAIL code=${code} message=${message}`);
  process.exitCode = 1;
}

function assert(condition: unknown, code: string, message: string) {
  if (!condition) fail(code, message);
}

function readJson(relativePath: string) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

const schemaPath = 'schemas/governance/known-bad-versions.schema.json';
const manifestPath = 'known-bad-versions.json';

assert(existsSync(path.join(root, schemaPath)), 'KNOWN_BAD_SCHEMA_MISSING', `${schemaPath} must exist`);
assert(existsSync(path.join(root, manifestPath)), 'KNOWN_BAD_MANIFEST_MISSING', `${manifestPath} must exist`);

const schema = readJson(schemaPath);
const releaseIntegrityBuilder = readFileSync(path.join(root, 'scripts', 'build-release-integrity.ts'), 'utf8');
assert(
  releaseIntegrityBuilder.includes("'known-bad-versions.json'") || releaseIntegrityBuilder.includes('"known-bad-versions.json"'),
  'KNOWN_BAD_BUNDLE_SYNC_MISSING',
  'scripts/build-release-integrity.ts must bundle known-bad-versions.json into CLI release artefacts'
);
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

validateKnownBadFile(manifestPath);

const fixtureDir = path.join(root, 'tests', 'known-bad');
assert(existsSync(fixtureDir), 'KNOWN_BAD_FIXTURE_DIR_MISSING', 'tests/known-bad must exist');
for (const entry of existsSync(fixtureDir) ? readdirSync(fixtureDir) : []) {
  if (entry.endsWith('.json')) {
    validateKnownBadFile(path.join('tests', 'known-bad', entry).replace(/\\/g, '/'));
  }
}

if (!process.exitCode) {
  const testPath = path.join(root, 'tests', 'known-bad', 'known-bad-version.test.ts');
  assert(existsSync(testPath), 'KNOWN_BAD_TEST_MISSING', 'tests/known-bad/known-bad-version.test.ts must exist');
  if (existsSync(testPath)) {
    const testResult = spawnSync(process.execPath, ['--experimental-strip-types', testPath], {
      cwd: root,
      encoding: 'utf8'
    });
    if (testResult.status !== 0) {
      fail('KNOWN_BAD_TEST_FAILED', `known-bad-version.test.ts failed stdout=${JSON.stringify(testResult.stdout)} stderr=${JSON.stringify(testResult.stderr)}`);
    }
  }
}

if (!process.exitCode) {
  console.log(`[known-bad-versions:${mode}] ok — known-bad manifest, schema, ranges, and CLI fixture verified`);
}

function validateKnownBadFile(relativePath: string) {
  let payload: any;
  try {
    payload = readJson(relativePath);
  } catch (error: any) {
    fail('KNOWN_BAD_JSON_INVALID', `${relativePath} is not valid JSON: ${error.message}`);
    return;
  }

  if (!validate(payload)) {
    fail('KNOWN_BAD_SCHEMA_INVALID', `${relativePath} schema errors: ${formatErrors(validate.errors)}`);
    return;
  }

  for (const [index, entry] of payload.entries.entries()) {
    assert(
      isSupportedKnownBadRange(entry.versionRange),
      'KNOWN_BAD_RANGE_INVALID',
      `${relativePath} entries[${index}].versionRange is not a supported semver range: ${entry.versionRange}`
    );
    assert(
      isSemverVersion(entry.replacementVersion),
      'KNOWN_BAD_REPLACEMENT_INVALID',
      `${relativePath} entries[${index}].replacementVersion is not a semver version: ${entry.replacementVersion}`
    );
  }
}

function formatErrors(errors: any) {
  return (errors || [])
    .map((error: any) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ');
}
