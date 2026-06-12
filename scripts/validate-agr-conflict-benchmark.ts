import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  evaluateConflictScenario,
  listAgrConflictBenchmarkScenarioFiles,
  loadAgrConflictBenchmarkManifest,
  loadAgrConflictBenchmarkScenario,
  loadAllAgrConflictBenchmarkScenarios,
  renderAgrConflictBenchmarkMarkdown,
  runAgrConflictBenchmarkSuite
} from './lib/agr-conflict-benchmark-runner.ts';
import { createValidator } from './lib/validator-harness.ts';

const harness = createValidator('agr-conflict-benchmark', {
  argv: process.argv.slice(2),
  defaultMode: 'validate'
});

function ensureWiring(): void {
  const packageJson = harness.readJson<{ scripts?: Record<string, string> }>('package.json');
  harness.assert(
    packageJson.scripts?.['validate:agr-conflict-benchmark'] === 'node --strip-types scripts/validate-agr-conflict-benchmark.ts --mode validate',
    'package.json must expose validate:agr-conflict-benchmark'
  );

  const validatorsConfig = harness.readJson<{
    validators?: Array<{ name: string; entry: string; slow?: boolean }>;
    profiles?: Record<string, { validators?: string[] }>;
  }>('scripts/validators.config.json');
  const validatorDef = validatorsConfig.validators?.find((entry) => entry.name === 'validate-agr-conflict-benchmark');
  harness.assert(Boolean(validatorDef), 'validators.config.json must register validate-agr-conflict-benchmark');
  harness.assert(
    validatorDef?.entry === 'scripts/validate-agr-conflict-benchmark.ts',
    'validate-agr-conflict-benchmark entry path mismatch'
  );
  harness.assert(validatorDef?.slow === false, 'validate-agr-conflict-benchmark should be a fast validator');
}

function ensureFixturePack(): void {
  harness.requireFile('scripts/fixtures/agr-conflict-benchmark/manifest.json');
  harness.requireFile('scripts/lib/agr-conflict-benchmark-runner.ts');

  const manifest = loadAgrConflictBenchmarkManifest(harness.root);
  harness.assert(manifest.scenarios.length >= 8, 'agr conflict benchmark manifest must contain at least 8 scenarios');

  const onDisk = listAgrConflictBenchmarkScenarioFiles(harness.root);
  harness.assert(onDisk.length >= 8, 'agr conflict benchmark fixture directory must contain at least 8 scenario files');

  const scenarios = loadAllAgrConflictBenchmarkScenarios(harness.root);
  const hasCapsuleDrift = scenarios.some((scenario) => scenario.conflictType === 'capsule-cid-drift');
  harness.assert(hasCapsuleDrift, 'benchmark matrix must include a dedicated capsule CID drift scenario');

  for (const scenarioFile of manifest.scenarios) {
    const scenario = loadAgrConflictBenchmarkScenario(harness.root, scenarioFile);
    harness.assert(Boolean(scenario.id), `${scenarioFile} must define id`);
    harness.assert(Boolean(scenario.description), `${scenarioFile} must define description`);
    harness.assert(Boolean(scenario.conflictType), `${scenarioFile} must define conflictType`);
    harness.assert(Boolean(scenario.groundTruth), `${scenarioFile} must define groundTruth`);
    harness.assert(Boolean(scenario.expected), `${scenarioFile} must define expected outcomes`);
  }
}

function runBenchmarkGate(): void {
  const report = runAgrConflictBenchmarkSuite(harness.root);

  if (report.falseSafeRegressions.length > 0) {
    harness.fail(`false-safe regression gate failed: ${report.falseSafeRegressions.join(', ')}`);
  }

  if (report.expectationFailures.length > 0) {
    harness.fail(`benchmark expectation failures: ${report.expectationFailures.join(', ')}`);
  }

  const scenarios = loadAgrConflictBenchmarkManifest(harness.root).scenarios.map((scenarioFile) =>
    loadAgrConflictBenchmarkScenario(harness.root, scenarioFile)
  );

  for (const scenario of scenarios) {
    const result = evaluateConflictScenario(scenario);
    if (!result.matchedExpectation) {
      harness.fail(`${scenario.id} did not match expected conflict outcome (${result.conflictVerdict})`);
    }
  }

  const reportPath = path.join(harness.root, 'docs/reports/agr-conflict-arbitration-benchmark.md');
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${renderAgrConflictBenchmarkMarkdown(report)}\n`, 'utf8');

  harness.ok(
    `scenarios=${report.scenarioCount} catchRate=${report.catchRate.catchRatePercent}% shipSafe=${report.shipSafe} avgLatencyNs=${report.latency.averageNs}`
  );
}

ensureWiring();
ensureFixturePack();
runBenchmarkGate();
