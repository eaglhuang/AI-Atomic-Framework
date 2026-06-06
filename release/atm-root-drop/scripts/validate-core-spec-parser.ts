import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAtomicSpecFile } from '../packages/core/src/spec/parse-spec.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const fixture = readJson('tests/core-spec-parser.fixture.json');

function fail(message: any) {
  console.error(`[core-spec-parser:${mode}] ${message}`);
  process.exitCode = 1;
}

function check(condition: any, message: any) {
  if (!condition) {
    fail(message);
  }
}

function readJson(relativePath: any) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

function normalizePortablePath(value: any) {
  return String(value ?? '')
    .replace(/\\/g, '/')
    .replace(/^([A-Z]):/i, (_match, driveLetter) => `${String(driveLetter).toLowerCase()}:`);
}

function matchesExpectedIssuePath(actualPath: any, expectedPath: any) {
  const normalizedActual = normalizePortablePath(actualPath);
  const normalizedExpected = normalizePortablePath(expectedPath);
  if (!normalizedExpected) {
    return normalizedActual.length === 0;
  }
  if (normalizedExpected.startsWith('/')) {
    return normalizedActual === normalizedExpected;
  }
  return normalizedActual === normalizedExpected || normalizedActual.endsWith(`/${normalizedExpected}`);
}

function expectSubset(actual: any, expected: any, currentPath = 'root') {
  if (Array.isArray(expected)) {
    assert.deepStrictEqual(actual, expected, `${currentPath} mismatch`);
    return;
  }
  if (expected && typeof expected === 'object') {
    for (const [key, value] of Object.entries(expected)) {
      expectSubset(actual?.[key], value, `${currentPath}.${key}`);
    }
    return;
  }
  assert.strictEqual(actual, expected, `${currentPath} mismatch`);
}

for (const validCase of fixture.validCases) {
  const result = parseAtomicSpecFile(validCase.specPath, { cwd: root });
  check(result.ok === true, `${validCase.name} must parse successfully`);
  check(result.promptReport.code === 'ATM_SPEC_PARSE_OK', `${validCase.name} must emit ATM_SPEC_PARSE_OK`);
  expectSubset(result.normalizedModel, validCase.expectedNormalizedModel, validCase.name);
}

for (const invalidCase of fixture.invalidCases) {
  const result = parseAtomicSpecFile(invalidCase.specPath, { cwd: root });
  check(result.ok === false, `${invalidCase.name} must fail parsing`);
  const issue = result.promptReport.issues.find((entry: any) => entry.code === invalidCase.expectedCode);
  check(Boolean(issue), `${invalidCase.name} must contain issue code ${invalidCase.expectedCode}`);
  check(matchesExpectedIssuePath(issue.path, invalidCase.expectedPath), `${invalidCase.name} must point to ${invalidCase.expectedPath}`);
  check(issue.prompt.includes(invalidCase.expectedPromptSnippet), `${invalidCase.name} must provide prompt hint for ${invalidCase.expectedPromptSnippet}`);
}

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-core-spec-parser-'));
try {
  const tempSpecPath = path.join(tempRoot, 'minimal-valid.atom.json');
  copyFileSync(path.join(root, fixture.hostAgnosticCase.specPath), tempSpecPath);
  const hostAgnosticResult = parseAtomicSpecFile('minimal-valid.atom.json', { cwd: tempRoot });
  check(hostAgnosticResult.ok === true, 'parser must work in a temp repo without host-specific config');
  check(hostAgnosticResult.normalizedModel?.source.specPath.endsWith('/minimal-valid.atom.json') === true, 'parser must resolve spec path from explicit cwd without reading host config');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[core-spec-parser:${mode}] ok (${fixture.validCases.length} valid cases, ${fixture.invalidCases.length} invalid cases, host-agnostic parse verified)`);
}
