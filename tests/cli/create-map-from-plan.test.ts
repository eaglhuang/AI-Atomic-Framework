import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTempWorkspace } from '../../scripts/temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = createTempWorkspace('atm-cli-create-map-from-plan-');
const samplePlanPath = path.join(root, 'samples', 'checkout-mini.plan.json');

try {
  const validPlan = runAtm(['spec', '--validate', samplePlanPath, '--json']);
  assert.equal(validPlan.exitCode, 0, validPlan.stderr || validPlan.stdout);
  assert.equal(validPlan.parsed.ok, true);

  const create = runAtm(['create-map', '--cwd', tempRoot, '--from-plan', samplePlanPath, '--json']);
  assert.equal(create.exitCode, 0, create.stderr || create.stdout);
  assert.equal(create.parsed.ok, true);
  assert.equal(create.parsed.evidence.sourceMode, 'from-plan');
  assert.equal(create.parsed.evidence.mapId, 'ATM-MAP-0007');
  assert.deepEqual(create.parsed.evidence.defaultsUsed, []);
  assert.equal(existsSync(path.join(tempRoot, create.parsed.evidence.specPath)), true);

  const createdSpecPath = path.join(tempRoot, create.parsed.evidence.specPath);
  const createdSpec = readJson(createdSpecPath);
  assert.equal(createdSpec.schemaId, 'atm.atomicMap');
  assert.equal(createdSpec.specVersion, '0.2.0');
  assert.deepEqual(createdSpec.replacement.legacyUris, ['legacy://samples/checkout-mini']);

  const registry = readJson(path.join(tempRoot, 'atomic-registry.json'));
  const registryEntry = registry.entries.find((entry: any) => entry.mapId === 'ATM-MAP-0007');
  assert.ok(registryEntry);
  assert.deepEqual(registryEntry.replacement.legacyUris, ['legacy://samples/checkout-mini']);

  const integration = runAtm(['test', '--cwd', tempRoot, '--map', 'ATM-MAP-0007', '--json']);
  assert.equal(integration.exitCode, 0, integration.stderr || integration.stdout);
  assert.equal(integration.parsed.ok, true);

  const shadowTransition = runAtm([
    'replacement-lane',
    'transition',
    '--cwd', tempRoot,
    '--map', 'ATM-MAP-0007',
    '--to', 'shadow',
    '--evidence', 'atomic_workbench/maps/ATM-MAP-0007/map.test.report.json',
    '--json'
  ]);
  assert.equal(shadowTransition.exitCode, 0, shadowTransition.stderr || shadowTransition.stdout);
  assert.equal(shadowTransition.parsed.ok, true);

  const fixturePath = writeEquivalenceFixture(tempRoot, 'ATM-MAP-0007');
  const equivalence = runAtm(['test', '--cwd', tempRoot, '--map', 'ATM-MAP-0007', '--equivalence-fixtures', fixturePath, '--json']);
  assert.equal(equivalence.exitCode, 0, equivalence.stderr || equivalence.stdout);
  assert.equal(equivalence.parsed.ok, true);

  const equivalenceReportPath = path.join(tempRoot, 'atomic_workbench', 'maps', 'ATM-MAP-0007', 'map.equivalence.report.json');
  assert.equal(existsSync(equivalenceReportPath), true);

  const upgrade = runAtm([
    'upgrade',
    '--cwd', tempRoot,
    '--propose',
    '--atom', 'ATM-CORE-0001',
    '--from', '1.0.0',
    '--to', '1.1.0',
    '--target', 'map',
    '--map', 'ATM-MAP-0007',
    '--replacement-mode', 'active',
    '--dry-run',
    '--equivalence-report', equivalenceReportPath,
    '--input', path.join(root, 'fixtures', 'upgrade', 'hash-diff-report.json'),
    '--input', path.join(root, 'tests', 'schema-fixtures', 'positive', 'minimal-execution-evidence.json'),
    '--input', path.join(root, 'tests', 'police-fixtures', 'positive', 'non-regression-report.json'),
    '--input', path.join(root, 'fixtures', 'upgrade', 'quality-comparison-pass.json'),
    '--input', path.join(root, 'tests', 'police-fixtures', 'positive', 'registry-candidate-report.json'),
    '--json'
  ]);
  assert.equal(upgrade.exitCode, 0, upgrade.stderr || upgrade.stdout);
  assert.equal(upgrade.parsed.ok, true);
  assert.equal(upgrade.parsed.evidence.proposal.status, 'pending');

  const canaryTransition = runAtm([
    'replacement-lane',
    'transition',
    '--cwd', tempRoot,
    '--map', 'ATM-MAP-0007',
    '--to', 'canary',
    '--evidence', 'atomic_workbench/maps/ATM-MAP-0007/map.equivalence.report.json',
    '--json'
  ]);
  assert.equal(canaryTransition.exitCode, 0, canaryTransition.stderr || canaryTransition.stdout);
  assert.equal(canaryTransition.parsed.ok, true);

  const roundTrip = runAtm(['create-map', '--cwd', tempRoot, '--spec', createdSpecPath, '--json']);
  assert.equal(roundTrip.exitCode, 0, roundTrip.stderr || roundTrip.stdout);
  assert.equal(roundTrip.parsed.ok, true);
  assert.equal(roundTrip.parsed.evidence.sourceMode, 'spec');
  assert.equal(roundTrip.parsed.evidence.idempotent, true);

  const invalidPlanPath = path.join(root, 'tests', 'schema-fixtures', 'negative', 'decomposition-plan-missing-legacy-uris.json');
  const invalidPlan = runAtm(['create-map', '--cwd', tempRoot, '--from-plan', invalidPlanPath, '--json']);
  assert.equal(invalidPlan.exitCode, 2);
  assert.equal(invalidPlan.parsed.ok, false);
  assert.equal(invalidPlan.parsed.messages[0].code, 'ATM_DECOMP_PLAN_INVALID');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[cli-create-map-from-plan:test] ok (schema, from-plan, e2e smoke, spec round-trip, invalid plan)');

function runAtm(args: string[]) {
  const result = spawnSync(process.execPath, [path.join(root, 'atm.mjs'), ...args], {
    cwd: root,
    encoding: 'utf8'
  });
  const payload = (result.stdout || result.stderr || '').trim();
  return {
    exitCode: result.status ?? 0,
    stdout: result.stdout,
    stderr: result.stderr,
    parsed: JSON.parse(payload || JSON.stringify({ ok: false, stdout: result.stdout, stderr: result.stderr }))
  };
}

function readJson(filePath: string) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeEquivalenceFixture(repositoryRoot: string, mapId: string) {
  const fixtureDirectory = path.join(repositoryRoot, 'fixtures', 'equivalence');
  mkdirSync(fixtureDirectory, { recursive: true });
  const mapExecutorPath = path.join(fixtureDirectory, 'map-executor.mjs');
  const legacyExecutorPath = path.join(fixtureDirectory, 'legacy-executor.mjs');
  const fixturePath = path.join(fixtureDirectory, 'checkout-mini.fixture.json');

  writeFileSync(mapExecutorPath, "export async function run(input) {\n  return { total: 100, currency: 'USD', cartSize: Array.isArray(input?.cart) ? input.cart.length : 0 };\n}\n", 'utf8');
  writeFileSync(legacyExecutorPath, "export async function run(input) {\n  return { total: 100, currency: 'USD', cartSize: Array.isArray(input?.cart) ? input.cart.length : 0 };\n}\n", 'utf8');
  writeFileSync(fixturePath, `${JSON.stringify({
    mapId,
    fixtureSetId: 'fixture.checkout-mini',
    mapExecutor: {
      modulePath: 'fixtures/equivalence/map-executor.mjs',
      exportName: 'run'
    },
    legacyExecutor: {
      modulePath: 'fixtures/equivalence/legacy-executor.mjs',
      exportName: 'run'
    },
    cases: [
      {
        caseId: 'case.checkout.basic',
        input: {
          cart: [
            {
              sku: 'sample',
              quantity: 1
            }
          ]
        },
        metric: {
          name: 'semanticMatch'
        },
        evidenceRefs: ['evidence://checkout-mini/basic']
      }
    ]
  }, null, 2)}\n`, 'utf8');

  return fixturePath;
}