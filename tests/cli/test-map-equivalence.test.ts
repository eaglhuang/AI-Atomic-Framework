import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTempWorkspace } from '../../scripts/temp-root.ts';
import { createMinimalAtomicMapSpec } from '../../packages/core/src/manager/map-generator.ts';
import { resolveCanonicalMapPaths } from '../../packages/core/src/test-runner/map-integration.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = createTempWorkspace('atm-cli-map-equivalence-');
const mapId = 'ATM-MAP-9401';

try {
  writeEquivalenceWorkspace(tempRoot, mapId);

  const help = runAtm(['test', '--help']);
  assert.equal(help.exitCode, 0);
  assert.equal(help.parsed.evidence.usage.options.some((entry: any) => entry.flag === '--equivalence-fixtures'), true);

  const happy = runAtm(['test', '--cwd', tempRoot, '--map', mapId, '--equivalence-fixtures', 'fixtures/equivalence/happy.json']);
  assert.equal(happy.exitCode, 0);
  assert.equal(happy.parsed.ok, true);
  assert.equal(happy.parsed.evidence.mapId, mapId);
  assert.equal(existsSync(path.join(tempRoot, happy.parsed.evidence.reportPath)), true);
  const happyValidate = runAtm(['spec', '--cwd', tempRoot, '--validate', happy.parsed.evidence.reportPath]);
  assert.equal(happyValidate.exitCode, 0);
  assert.equal(happyValidate.parsed.ok, true);

  const negative = runAtm(['test', '--cwd', tempRoot, '--map', mapId, '--equivalence-fixtures', 'fixtures/equivalence/fail.json']);
  assert.equal(negative.exitCode, 1);
  assert.equal(negative.parsed.ok, false);
  assert.deepEqual(negative.parsed.evidence.failedCaseIds, ['case.checkout.basic']);
  assert.equal(existsSync(path.join(tempRoot, negative.parsed.evidence.reportPath)), true);

  const divergence = runAtm(['test', '--cwd', tempRoot, '--map', mapId, '--equivalence-fixtures', 'fixtures/equivalence/known-divergence.json']);
  assert.equal(divergence.exitCode, 0);
  assert.equal(divergence.parsed.ok, true);
  assert.deepEqual(divergence.parsed.evidence.acceptedKnownDivergenceIds, ['case.checkout.basic']);
  const divergenceReport = JSON.parse(readFileSync(path.join(tempRoot, divergence.parsed.evidence.reportPath), 'utf8'));
  assert.equal(divergenceReport.passed, true);
  assert.equal(divergenceReport.cases[0].passed, false);
  assert.equal(divergenceReport.knownDivergences[0].reviewRef, 'review-advisory://checkout-mini/basic-divergence');

  const pairing = runAtm(['test', '--cwd', tempRoot, '--equivalence-fixtures', 'fixtures/equivalence/happy.json']);
  assert.equal(pairing.exitCode, 2);
  assert.equal(pairing.parsed.ok, false);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[cli-test-map-equivalence:test] ok (5 acceptance checks)');

function runAtm(args: string[]) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 0,
    parsed: JSON.parse(payload || JSON.stringify({ ok: false, stdout: result.stdout, stderr: result.stderr }))
  };
}

function writeEquivalenceWorkspace(repositoryRoot: string, targetMapId: string) {
  const spec = createMinimalAtomicMapSpec({
    mapId: targetMapId,
    mapVersion: '0.1.0',
    members: [{ atomId: 'ATM-FIXTURE-0001', version: '0.1.0', role: 'entry-adapter' }],
    edges: [],
    entrypoints: ['ATM-FIXTURE-0001'],
    qualityTargets: { requiredChecks: 1, promoteGateRequired: true },
    replacement: {
      legacyUris: ['legacy://samples/checkout-mini'],
      mode: 'draft',
      evidenceRefs: []
    }
  });
  const paths = resolveCanonicalMapPaths(targetMapId);
  mkdirSync(path.join(repositoryRoot, paths.workbenchPath), { recursive: true });
  mkdirSync(path.join(repositoryRoot, 'fixtures', 'equivalence'), { recursive: true });
  mkdirSync(path.join(repositoryRoot, 'fixtures', 'legacy'), { recursive: true });
  writeFileSync(path.join(repositoryRoot, paths.specPath), `${JSON.stringify(spec, null, 2)}\n`, 'utf8');
  writeFileSync(path.join(repositoryRoot, paths.testPath), "console.log('map integration ok');\n", 'utf8');
  writeFileSync(path.join(repositoryRoot, 'atomic_workbench', 'maps', targetMapId, 'map.executor.ts'), [
    'export async function run(input) {',
    '  return { total: Number(input?.subtotal || 0), currency: "USD" };',
    '}'
  ].join('\n'), 'utf8');
  writeFileSync(path.join(repositoryRoot, 'atomic_workbench', 'maps', targetMapId, 'map.executor.divergent.ts'), [
    'export async function run(input) {',
    '  return { total: Number(input?.subtotal || 0) + 1, currency: "USD" };',
    '}'
  ].join('\n'), 'utf8');
  writeFileSync(path.join(repositoryRoot, 'fixtures', 'legacy', 'checkout-mini.ts'), [
    'export async function run(input) {',
    '  return { total: Number(input?.subtotal || 0), currency: "USD" };',
    '}'
  ].join('\n'), 'utf8');

  writeFixture(repositoryRoot, 'happy.json', {
    fixtureSetId: 'fixture.checkout-mini.happy',
    mapExecutor: { modulePath: `atomic_workbench/maps/${targetMapId}/map.executor.ts` },
    legacyExecutor: { modulePath: 'fixtures/legacy/checkout-mini.ts' },
    cases: [
      {
        caseId: 'case.checkout.basic',
        input: { subtotal: 100 },
        metric: { name: 'semanticMatch' },
        evidenceRefs: ['fixture:checkout-basic'],
        knownDivergence: false
      }
    ]
  });

  writeFixture(repositoryRoot, 'fail.json', {
    fixtureSetId: 'fixture.checkout-mini.fail',
    mapExecutor: { modulePath: `atomic_workbench/maps/${targetMapId}/map.executor.divergent.ts` },
    legacyExecutor: { modulePath: 'fixtures/legacy/checkout-mini.ts' },
    cases: [
      {
        caseId: 'case.checkout.basic',
        input: { subtotal: 100 },
        metric: { name: 'semanticMatch' },
        evidenceRefs: ['fixture:checkout-basic'],
        knownDivergence: false
      }
    ]
  });

  writeFixture(repositoryRoot, 'known-divergence.json', {
    fixtureSetId: 'fixture.checkout-mini.known-divergence',
    mapExecutor: { modulePath: `atomic_workbench/maps/${targetMapId}/map.executor.divergent.ts` },
    legacyExecutor: { modulePath: 'fixtures/legacy/checkout-mini.ts' },
    cases: [
      {
        caseId: 'case.checkout.basic',
        input: { subtotal: 100 },
        metric: { name: 'semanticMatch' },
        evidenceRefs: ['fixture:checkout-basic'],
        knownDivergence: true
      }
    ],
    knownDivergences: [
      {
        caseId: 'case.checkout.basic',
        reason: 'Map preview intentionally rounds one currency unit higher for staged review.',
        justification: 'Accepted for staged shadow verification before upgrade gate wiring lands.',
        reviewer: 'reviewer.fixture',
        reviewRef: 'review-advisory://checkout-mini/basic-divergence'
      }
    ]
  });
}

function writeFixture(repositoryRoot: string, fileName: string, fixture: unknown) {
  writeFileSync(path.join(repositoryRoot, 'fixtures', 'equivalence', fileName), `${JSON.stringify(fixture, null, 2)}\n`, 'utf8');
}