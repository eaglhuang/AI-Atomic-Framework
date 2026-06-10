import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPythonAtomizationPlanningAdapter,
  discoverPythonAtomCandidates,
  planPythonAtomizeFromCandidate
} from '../src/language-python-adapter.ts';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadFixture(name: string) {
  return {
    filePath: `packages/language-python/test/fixtures/${name}`,
    sourceText: readFileSync(path.join(fixturesDir, name), 'utf8'),
    languageId: 'python'
  };
}

function candidatesFor(name: string) {
  return discoverPythonAtomCandidates({ sourceFiles: [loadFixture(name)] });
}

function testFixtureCoverage() {
  const fixtureNames = readdirSync(fixturesDir).filter((entry) => entry.endsWith('.py')).sort();
  assert.ok(fixtureNames.length >= 5, `expected at least 5 Python fixtures, got ${fixtureNames.length}`);
  for (const name of fixtureNames) {
    const candidates = candidatesFor(name);
    assert.ok(candidates.length >= 1, `${name} should yield at least the module candidate`);
    assert.ok(
      candidates.some((candidate) => candidate.kind === 'module' && candidate.confidence === 'medium'),
      `${name} should yield a module candidate with medium confidence`
    );
  }
  console.log('ok: fixture coverage (>=5 fixtures, module candidate each)');
}

function testSimpleFunctions() {
  const candidates = candidatesFor('simple_functions.py');
  const functions = candidates.filter((candidate) => candidate.kind === 'function');
  assert.equal(functions.length, 3, 'simple_functions.py should yield 3 function candidates');
  assert.deepEqual(
    functions.map((candidate) => candidate.symbol).sort(),
    ['fetch_remote_rows', 'load_rows', 'normalize_rows']
  );
  for (const candidate of functions) {
    assert.equal(candidate.confidence, 'high');
    assert.equal(candidate.detectionMethod, 'scanner');
    assert.ok(candidate.lineStart !== null && candidate.lineStart > 0);
    assert.ok(candidate.lineEnd !== null && candidate.lineEnd >= candidate.lineStart!);
    assert.match(candidate.suggestedAtomId ?? '', /^ATM-PY-[0-9a-f]{8}$/);
  }
  console.log('ok: simple_functions.py function discovery');
}

function testClasses() {
  const candidates = candidatesFor('classes.py');
  const classes = candidates.filter((candidate) => candidate.kind === 'class');
  assert.deepEqual(classes.map((candidate) => candidate.symbol).sort(), ['RowParser', 'RowWriter']);
  for (const candidate of classes) {
    assert.equal(candidate.confidence, 'high');
  }
  const functions = candidates.filter((candidate) => candidate.kind === 'function');
  assert.equal(functions.length, 0, 'nested methods must not surface as top-level function candidates');
  console.log('ok: classes.py class discovery without nested methods');
}

function testCommandGuard() {
  const candidates = candidatesFor('cli_main.py');
  const commands = candidates.filter((candidate) => candidate.kind === 'command');
  assert.equal(commands.length, 1, 'cli_main.py should yield one command candidate');
  assert.equal(commands[0].symbol, '__main__');
  assert.equal(commands[0].confidence, 'high');
  assert.ok(candidates.some((candidate) => candidate.kind === 'function' && candidate.symbol === 'main'));
  console.log('ok: cli_main.py command guard discovery');
}

function testMixedAndModuleOnly() {
  const mixed = candidatesFor('mixed.py');
  const kinds = mixed.map((candidate) => candidate.kind);
  assert.ok(kinds.includes('class') && kinds.includes('function') && kinds.includes('command') && kinds.includes('module'));

  const moduleOnly = candidatesFor('module_only.py');
  assert.equal(moduleOnly.length, 1, 'module_only.py should yield only the module candidate');
  assert.equal(moduleOnly[0].kind, 'module');
  console.log('ok: mixed.py and module_only.py kind coverage');
}

function testFiltersAndDeterminism() {
  const sourceFiles = [loadFixture('mixed.py')];
  const onlyFunctions = discoverPythonAtomCandidates({ sourceFiles, filters: { kinds: ['function'] } });
  assert.ok(onlyFunctions.length > 0 && onlyFunctions.every((candidate) => candidate.kind === 'function'));

  const highOnly = discoverPythonAtomCandidates({ sourceFiles, filters: { minConfidence: 'high' } });
  assert.ok(highOnly.every((candidate) => candidate.confidence === 'high'));

  const first = discoverPythonAtomCandidates({ sourceFiles });
  const second = discoverPythonAtomCandidates({ sourceFiles });
  assert.deepEqual(first, second, 'discovery must be deterministic for identical input');
  console.log('ok: discovery filters and determinism');
}

async function testPlanAtomize() {
  const sourceFile = loadFixture('cli_main.py');
  const adapter = createPythonAtomizationPlanningAdapter();
  const candidates = await adapter.discoverAtomCandidates({ sourceFiles: [sourceFile] });
  const target = candidates.find((candidate) => candidate.kind === 'command');
  assert.ok(target, 'expected a command candidate to plan against');

  const plan = planPythonAtomizeFromCandidate({
    atomId: 'ATM-PY-TEST-0001',
    target: target!,
    sourceFiles: [sourceFile],
    dryRun: true
  });

  assert.equal(plan.dryRun, true);
  assert.equal(plan.atomId, 'ATM-PY-TEST-0001');
  assert.deepEqual(plan.target, target);
  assert.ok(plan.patchFiles.includes('packages/language-python/test/fixtures/cli_main.py'));
  assert.ok(plan.patchFiles.some((entry) => entry.includes('atomic_workbench/atoms/ATM-PY-TEST-0001')));
  const stepKinds = plan.steps.map((step) => step.stepKind);
  assert.deepEqual(stepKinds, ['extract-unit', 'wire-host-shim', 'evidence-required']);
  assert.ok(plan.evidenceRequired.includes('pytest-report'));
  assert.ok(plan.rollbackNotes.length > 0);

  const adapterPlan = await adapter.planAtomize({
    atomId: 'ATM-PY-TEST-0001',
    target: target!,
    sourceFiles: [sourceFile],
    dryRun: true
  });
  assert.deepEqual(adapterPlan, plan, 'adapter facade must match the direct plan function');
  console.log('ok: planAtomize dry-run wraps legacy planPythonAtomize');
}

testFixtureCoverage();
testSimpleFunctions();
testClasses();
testCommandGuard();
testMixedAndModuleOnly();
testFiltersAndDeterminism();
await testPlanAtomize();
console.log('all language-python atomization-planning tests passed');
