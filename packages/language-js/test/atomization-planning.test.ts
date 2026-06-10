import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createJavaScriptAtomizationPlanningAdapter,
  discoverJavaScriptAtomCandidates
} from '../src/language-js-adapter.ts';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadFixture(name: string) {
  return {
    filePath: `packages/language-js/test/fixtures/${name}`,
    sourceText: readFileSync(path.join(fixturesDir, name), 'utf8'),
    languageId: name.endsWith('.js') ? 'javascript' : 'typescript'
  };
}

function candidatesFor(name: string) {
  return discoverJavaScriptAtomCandidates({ sourceFiles: [loadFixture(name)] });
}

function symbolsOf(candidates: readonly { symbol: string }[]) {
  return candidates.map((candidate) => candidate.symbol).sort();
}

function testFixtureCoverage() {
  const fixtureNames = readdirSync(fixturesDir).filter((entry) => /\.(?:ts|js)$/.test(entry)).sort();
  assert.ok(fixtureNames.length >= 5, `expected at least 5 fixtures, got ${fixtureNames.length}`);
  const expectedCounts: Record<string, number> = {
    'arrow-consts.ts': 4,
    'commonjs-exports.js': 3,
    'exported-classes.ts': 2,
    'exported-functions.ts': 3,
    'mixed.ts': 4,
    'plain-functions.ts': 2
  };
  for (const name of fixtureNames) {
    const candidates = candidatesFor(name);
    assert.equal(
      candidates.length,
      expectedCounts[name],
      `${name} expected ${expectedCounts[name]} candidates, got ${candidates.length} (${symbolsOf(candidates).join(', ')})`
    );
  }
  console.log('ok: fixture coverage (>=5 fixtures, expected candidate counts)');
}

function testExportedFunctions() {
  const candidates = candidatesFor('exported-functions.ts');
  assert.deepEqual(symbolsOf(candidates), ['fetchRows', 'loadRows', 'main']);
  assert.ok(candidates.every((candidate) => candidate.kind === 'function' && candidate.confidence === 'high'));
  assert.ok(candidates.every((candidate) => candidate.detectionMethod === 'scanner'));

  const loadRows = candidates.find((candidate) => candidate.symbol === 'loadRows');
  assert.equal(loadRows?.lineStart, 1);
  assert.equal(loadRows?.lineEnd, 7, 'brace balancing should find the closing line');
  assert.match(loadRows?.suggestedAtomId ?? '', /^ATM-JS-[0-9a-f]{8}$/);
  console.log('ok: exported functions (high confidence, line ranges, ATM-JS atom ids)');
}

function testExportedClasses() {
  const candidates = candidatesFor('exported-classes.ts');
  assert.deepEqual(symbolsOf(candidates), ['BaseReporter', 'RowStore']);
  assert.ok(candidates.every((candidate) => candidate.kind === 'class' && candidate.confidence === 'high'));
  console.log('ok: exported classes');
}

function testArrowConsts() {
  const candidates = candidatesFor('arrow-consts.ts');
  assert.deepEqual(symbolsOf(candidates), ['double', 'fetchJson', 'sum', 'useHelper']);
  assert.ok(candidates.every((candidate) => candidate.kind === 'function' && candidate.confidence === 'medium'));

  const sum = candidates.find((candidate) => candidate.symbol === 'sum');
  assert.equal(sum?.lineStart, 1);
  assert.equal(sum?.lineEnd, 1, 'single-expression arrow should end on its own line');
  console.log('ok: arrow consts (medium confidence, non-exported arrow skipped)');
}

function testCommonJsExports() {
  const candidates = candidatesFor('commonjs-exports.js');
  assert.deepEqual(symbolsOf(candidates), ['VERSION', 'resolveRoot', 'shortName']);
  assert.ok(candidates.every((candidate) => candidate.kind === 'module' && candidate.confidence === 'medium'));
  console.log('ok: CommonJS exports (module kind, medium confidence)');
}

function testPlainTopLevelFunctions() {
  const candidates = candidatesFor('plain-functions.ts');
  assert.deepEqual(symbolsOf(candidates), ['localAsync', 'localOnly']);
  assert.ok(candidates.every((candidate) => candidate.kind === 'function' && candidate.confidence === 'low'));

  const localOnly = candidates.find((candidate) => candidate.symbol === 'localOnly');
  assert.equal(localOnly?.lineEnd, 6, 'nested function braces must stay inside the outer block');
  console.log('ok: plain top-level functions (low confidence, nested functions skipped)');
}

function testFilters() {
  const sourceFiles = ['exported-functions.ts', 'exported-classes.ts', 'commonjs-exports.js'].map(loadFixture);

  const classesOnly = discoverJavaScriptAtomCandidates({ sourceFiles, filters: { kinds: ['class'] } });
  assert.deepEqual(symbolsOf(classesOnly), ['BaseReporter', 'RowStore']);

  const highOnly = discoverJavaScriptAtomCandidates({ sourceFiles, filters: { minConfidence: 'high' } });
  assert.ok(highOnly.every((candidate) => candidate.confidence === 'high'));
  assert.equal(highOnly.length, 5);

  const prefixed = discoverJavaScriptAtomCandidates({
    sourceFiles,
    filters: { filePathPrefixes: ['packages/language-js/test/fixtures/commonjs'] }
  });
  assert.deepEqual(symbolsOf(prefixed), ['VERSION', 'resolveRoot', 'shortName']);
  console.log('ok: discovery filters (kinds, minConfidence, filePathPrefixes)');
}

function testDeterminism() {
  const first = candidatesFor('mixed.ts');
  const second = candidatesFor('mixed.ts');
  assert.deepEqual(first, second, 'discovery must be deterministic for identical input');
  console.log('ok: deterministic discovery');
}

async function testAdapterShape() {
  const adapter = createJavaScriptAtomizationPlanningAdapter();
  const discovered = await adapter.discoverAtomCandidates({ sourceFiles: [loadFixture('mixed.ts')] });
  assert.equal(discovered.length, 4);

  assert.throws(
    () => adapter.planAtomize({ atomId: 'ATM-JS-deadbeef', target: discovered[0], sourceFiles: [], dryRun: true }),
    /ATM_JS_PLAN_ATOMIZE_NOT_IMPLEMENTED/,
    'planAtomize must fail loudly until TASK-ASP-0004 lands the bridge'
  );
  console.log('ok: AtomizationPlanningAdapter shape (planAtomize deferred)');
}

testFixtureCoverage();
testExportedFunctions();
testExportedClasses();
testArrowConsts();
testCommonJsExports();
testPlainTopLevelFunctions();
testFilters();
testDeterminism();
await testAdapterShape();
console.log('all language-js atomization-planning tests passed');
