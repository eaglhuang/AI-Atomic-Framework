import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAtomicSpecFile } from '../packages/core/src/spec/parse-spec.mjs';
import { defaultAtomSpecFileName, defaultAtomTestFileName, scaffoldAtomWorkbench } from '../packages/core/src/manager/scaffold.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv.includes('--mode')
  ? process.argv[process.argv.indexOf('--mode') + 1]
  : 'validate';
const fixture = readJson('tests/scaffold-builder.fixture.json');

function fail(message) {
  console.error(`[scaffold-builder:${mode}] ${message}`);
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

const parsed = parseAtomicSpecFile(fixture.specPath, { cwd: root });
check(parsed.ok === true, 'fixture spec must parse before scaffolding');

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-scaffold-builder-'));
try {
  const scaffold = scaffoldAtomWorkbench(parsed.normalizedModel, { repositoryRoot: tempRoot });
  check(scaffold.ok === true, 'scaffold must succeed');
  check(scaffold.createdFiles.length === 2, 'first scaffold must create two files');
  check(scaffold.skippedFiles.length === 0, 'first scaffold must not skip files');

  const workbenchPath = path.join(tempRoot, fixture.defaultWorkbenchPath);
  const specPath = path.join(workbenchPath, defaultAtomSpecFileName);
  const testPath = path.join(workbenchPath, defaultAtomTestFileName);
  check(existsSync(specPath), 'default scaffold must create atom.spec.json');
  check(existsSync(testPath), 'default scaffold must create atom.test.ts');

  const scaffoldedSpec = JSON.parse(readFileSync(specPath, 'utf8'));
  check(scaffoldedSpec.id === fixture.expectedAtomId, 'scaffolded spec must preserve atom id');
  check(scaffoldedSpec.title === fixture.expectedTitle, 'scaffolded spec must preserve atom title');

  const scaffoldedTest = readFileSync(testPath, 'utf8');
  check(scaffoldedTest.includes(fixture.expectedAtomId), 'scaffolded test must mention atom id');
  check(scaffoldedTest.includes(defaultAtomSpecFileName), 'scaffolded test must reference atom spec file');

  writeFileSync(testPath, `${scaffoldedTest}\n// manual edit\n`, 'utf8');
  const secondScaffold = scaffoldAtomWorkbench(parsed.normalizedModel, { repositoryRoot: tempRoot });
  check(secondScaffold.createdFiles.length === 0, 'second scaffold must not create files again');
  check(secondScaffold.skippedFiles.length === 2, 'second scaffold must skip existing files');
  check(readFileSync(testPath, 'utf8').includes('// manual edit'), 'second scaffold must not overwrite manual edits');

  const customScaffold = scaffoldAtomWorkbench(parsed.normalizedModel, {
    repositoryRoot: tempRoot,
    workbenchPath: fixture.customWorkbenchPath
  });
  check(customScaffold.createdFiles.length === 2, 'custom scaffold path must also create two files');
  check(existsSync(path.join(tempRoot, fixture.customWorkbenchPath, defaultAtomSpecFileName)), 'custom scaffold must honor adapter-determined workbenchPath');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (!process.exitCode) {
  console.log(`[scaffold-builder:${mode}] ok (default path, idempotent rerun, and custom workbench path verified)`);
}