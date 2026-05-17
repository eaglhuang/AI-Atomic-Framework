import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createTempWorkspace } from '../../scripts/temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = createTempWorkspace('atm cli create map from spec ');
const fixture01 = path.join(root, 'tests', 'schema-fixtures', 'positive', 'atomic-map-0.1-minimal.json');
const fixture02 = path.join(root, 'tests', 'schema-fixtures', 'positive', 'atomic-map-0.2-replacement.json');

try {
  const create01 = runAtm(['create-map', '--cwd', tempRoot, '--spec', fixture01, '--json']);
  assert.equal(create01.exitCode, 0, JSON.stringify(create01.parsed, null, 2));
  assert.equal(create01.parsed.ok, true);
  assert.equal(create01.parsed.evidence.sourceMode, 'spec');
  assert.equal(create01.parsed.evidence.mapId, 'ATM-MAP-9101');
  assert.equal(create01.parsed.evidence.nextActionHint.route, 'map-integration-test');
  assert.match(create01.parsed.evidence.nextActionHint.command, /test .*--map/);
  const created01 = readJson(path.join(tempRoot, create01.parsed.evidence.specPath));
  assert.equal(created01.specVersion, '0.1.0');
  assert.equal('replacement' in created01, false);

  const create02 = runAtm(['create-map', '--cwd', tempRoot, '--spec', fixture02, '--json']);
  assert.equal(create02.exitCode, 0, JSON.stringify(create02.parsed, null, 2));
  assert.equal(create02.parsed.ok, true);
  assert.equal(create02.parsed.evidence.mapId, 'ATM-MAP-9102');
  assert.equal(create02.parsed.evidence.nextActionHint.route, 'map-integration-test');
  const created02 = readJson(path.join(tempRoot, create02.parsed.evidence.specPath));
  assert.equal(created02.specVersion, '0.2.0');
  assert.deepEqual(created02.replacement, {
    legacyUris: ['legacy://samples/checkout-mini'],
    mode: 'draft',
    evidenceRefs: []
  });
  const registry = readJson(path.join(tempRoot, 'atomic-registry.json'));
  const replacementEntry = registry.entries.find((entry: any) => entry.mapId === 'ATM-MAP-9102');
  assert.ok(replacementEntry);
  assert.deepEqual(replacementEntry.replacement, {
    legacyUris: ['legacy://samples/checkout-mini'],
    mode: 'draft',
    evidenceRefs: []
  });

  const invalidSpecPath = path.join(tempRoot, 'invalid map spec.json');
  writeFileSync(invalidSpecPath, `${JSON.stringify({
    ...readJson(fixture02),
    replacement: {
      legacyUris: ['legacy://samples/checkout-mini'],
      mode: 'not-a-valid-mode',
      evidenceRefs: []
    }
  }, null, 2)}\n`, 'utf8');
  const invalid = runAtm(['create-map', '--cwd', tempRoot, '--spec', invalidSpecPath, '--json']);
  assert.equal(invalid.exitCode, 2, JSON.stringify(invalid.parsed, null, 2));
  assert.equal(invalid.parsed.ok, false);
  assert.equal(invalid.parsed.messages[0].code, 'ATM_MAP_SPEC_INVALID');

  const equivalenceFixturePath = writeEquivalenceFixture(tempRoot, 'ATM-MAP-9102');
  const equivalence = runAtm(['test', '--cwd', tempRoot, '--map', 'ATM-MAP-9102', '--equivalence-fixtures', equivalenceFixturePath, '--json']);
  assert.equal(equivalence.exitCode, 0, JSON.stringify(equivalence.parsed, null, 2));
  assert.equal(equivalence.parsed.ok, true);
  assert.equal(equivalence.parsed.evidence.nextActionHint.route, 'replacement-lane-canary');
  assert.match(equivalence.parsed.evidence.nextActionHint.command, /replacement-lane transition/);

  const blockedUpgrade = runAtm([
    'upgrade',
    '--cwd', tempRoot,
    '--propose',
    '--atom', 'ATM-CORE-0001',
    '--from', '1.0.0',
    '--to', '1.1.0',
    '--target', 'map',
    '--map', 'ATM-MAP-9102',
    '--replacement-mode', 'active',
    '--dry-run',
    '--input', path.join(root, 'fixtures', 'upgrade', 'hash-diff-report.json'),
    '--input', path.join(root, 'tests', 'schema-fixtures', 'positive', 'minimal-execution-evidence.json'),
    '--input', path.join(root, 'tests', 'police-fixtures', 'positive', 'non-regression-report.json'),
    '--input', path.join(root, 'fixtures', 'upgrade', 'quality-comparison-pass.json'),
    '--input', path.join(root, 'tests', 'police-fixtures', 'positive', 'registry-candidate-report.json'),
    '--json'
  ]);
  assert.equal(blockedUpgrade.exitCode, 0, JSON.stringify(blockedUpgrade.parsed, null, 2));
  assert.equal(blockedUpgrade.parsed.ok, true);
  assert.equal(blockedUpgrade.parsed.evidence.status, 'blocked');
  assert.equal(blockedUpgrade.parsed.evidence.nextActionHint.route, 'map-equivalence-required');
  assert.deepEqual(blockedUpgrade.parsed.evidence.nextActionHint.requiredEvidenceKinds, ['map-equivalence']);
  assert.match(blockedUpgrade.parsed.evidence.nextActionHint.command, /--equivalence-fixtures/);

  const powerShellRoot = createTempWorkspace('atm cli spec powershell smoke ');
  mkdirSync(path.join(powerShellRoot, 'spec inputs'), { recursive: true });
  copyFileSync(fixture02, path.join(powerShellRoot, 'spec inputs', 'atomic map 0.2 replacement.json'));
  const pwsh = spawnSync('powershell', [
    '-NoProfile',
    '-Command',
    `node \"${path.join(root, 'atm.mjs')}\" create-map --cwd \"${powerShellRoot}\" --spec \"spec inputs/atomic map 0.2 replacement.json\" --json`
  ], {
    cwd: root,
    encoding: 'utf8'
  });
  const powerShellPayload = JSON.parse((pwsh.stdout || pwsh.stderr || '').trim());
  assert.equal(pwsh.status, 0, JSON.stringify(powerShellPayload, null, 2));
  assert.equal(powerShellPayload.ok, true);
  assert.equal(powerShellPayload.evidence.mapId, 'ATM-MAP-9102');
  rmSync(powerShellRoot, { recursive: true, force: true });
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[cli-create-map-from-spec:test] ok (0.1/0.2 spec create, invalid schema, powershell path smoke)');

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