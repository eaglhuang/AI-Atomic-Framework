import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createPropagationReport } from '../../packages/core/src/test-runner/propagation.ts';
import { createTempWorkspace } from '../../scripts/temp-root.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = createTempWorkspace('atm-cli-create-map-from-plan-');
const samplePlanPath = path.join(root, 'samples', 'checkout-mini.plan.json');

// Fixed timestamp so proposal ID is deterministic (M10 active gate requires human-review proposalId match)
const FIXED_PROPOSED_AT = '2026-01-01T00:00:00.000Z';
const E2E_MAP_PROPOSAL_ID = 'proposal.atm-core-0001.from-1.0.0.to-1.1.0.map-atm-map-0007.behavior-evolve';

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

  // M10 active gate requires propagation-report + review-advisory + human-review in addition to equivalence
  const propagationReportPath = path.join(tempRoot, 'propagation-report.pass.json');
  const reviewAdvisoryPath = path.join(tempRoot, 'review-advisory.pass.json');
  const humanReviewPath = path.join(tempRoot, 'human-review.approve.json');
  writeJson(propagationReportPath, createPassingPropagationReport());
  writeJson(reviewAdvisoryPath, createPassingReviewAdvisory());
  writeJson(humanReviewPath, createApprovedHumanReviewDecision());

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
    '--proposed-at', FIXED_PROPOSED_AT,
    '--equivalence-report', equivalenceReportPath,
    '--propagation-report', propagationReportPath,
    '--review-advisory', reviewAdvisoryPath,
    '--human-review', humanReviewPath,
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

function writeJson(filePath: string, document: unknown) {
  writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
}

function createPassingPropagationReport() {
  return createPropagationReport({
    ok: true,
    discoveredMaps: ['ATM-MAP-0007'],
    perMapStatus: [
      {
        mapId: 'ATM-MAP-0007',
        ok: true,
        exitCode: 0,
        durationMs: 12,
        resolutionMode: 'canonical',
        reportPath: 'atomic_workbench/maps/ATM-MAP-0007/map.test.report.json',
        warnings: []
      }
    ],
    failedDownstream: [],
    propagationDuration: 12,
    metrics: { latency: 12, errorRate: 0, coverage: 1, edgeCaseCount: 0 },
    summary: { total: 1, passed: 1, failed: 0, durationMs: 12 }
  }, {
    atomId: 'ATM-CORE-0001',
    behaviorId: 'behavior.evolve',
    generatedAt: FIXED_PROPOSED_AT,
    reportId: 'propagation.atm-core-0001.evolve.e2e'
  });
}

function createPassingReviewAdvisory() {
  // Use mapId as target.id to avoid a strict proposalId dependency at construction time
  return {
    schemaVersion: '1.0.0',
    reportId: 'review-advisory.e2e-pass',
    status: 'ok',
    generatedAt: FIXED_PROPOSED_AT,
    target: { kind: 'proposal', id: 'ATM-MAP-0007' },
    summary: { high: 0, medium: 0, low: 0, info: 0 },
    findings: [],
    advisoryUnavailable: false,
    needsReview: false,
    unavailableReasons: []
  };
}

function createApprovedHumanReviewDecision() {
  return {
    schemaId: 'atm.humanReviewDecision',
    specVersion: '0.1.0',
    proposalId: E2E_MAP_PROPOSAL_ID,
    atomId: 'ATM-CORE-0001',
    decision: 'approve',
    reason: 'All automated gates passed — approved for active replacement.',
    decidedBy: 'ATM E2E test harness',
    decidedAt: FIXED_PROPOSED_AT,
    queueRecord: {
      proposalId: E2E_MAP_PROPOSAL_ID,
      atomId: 'ATM-CORE-0001',
      status: 'approved'
    }
  };
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