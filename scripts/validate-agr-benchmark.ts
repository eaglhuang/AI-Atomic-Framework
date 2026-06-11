import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  listAgrBenchmarkScenarioFiles,
  loadAgrBenchmarkManifest,
  runAgrBenchmarkScenario,
  runAgrBenchmarkSuite,
  loadAgrBenchmarkScenario
} from './lib/agr-benchmark-runner.ts';
import { createValidator } from './lib/validator-harness.ts';

const harness = createValidator('agr-benchmark', {
  argv: process.argv.slice(2),
  defaultMode: 'validate'
});

function ensureWiring(): void {
  const packageJson = harness.readJson<{ scripts?: Record<string, string> }>('package.json');
  harness.assert(
    packageJson.scripts?.['validate:agr-benchmark'] === 'node --strip-types scripts/validate-agr-benchmark.ts --mode validate',
    'package.json must expose validate:agr-benchmark'
  );

  const validatorsConfig = harness.readJson<{ validators?: Array<{ name: string; entry: string; slow?: boolean }>; profiles?: Record<string, { validators?: string[] }> }>(
    'scripts/validators.config.json'
  );
  const validatorDef = validatorsConfig.validators?.find((entry) => entry.name === 'validate-agr-benchmark');
  harness.assert(Boolean(validatorDef), 'validators.config.json must register validate-agr-benchmark');
  harness.assert(
    validatorDef?.entry === 'scripts/validate-agr-benchmark.ts',
    'validate-agr-benchmark entry path mismatch'
  );
  harness.assert(validatorDef?.slow === false, 'validate-agr-benchmark should be a fast validator');
  harness.assert(
    validatorsConfig.profiles?.standard?.validators?.includes('validate-agr-benchmark') === true,
    'standard profile must include validate-agr-benchmark'
  );
}

function ensureFixturePack(): void {
  harness.requireFile('scripts/fixtures/agr-benchmark/manifest.json');
  harness.requireFile('scripts/lib/agr-benchmark-runner.ts');

  const manifest = loadAgrBenchmarkManifest(harness.root);
  harness.assert(manifest.scenarios.length >= 10, 'agr benchmark manifest must contain at least 10 scenarios');

  const onDisk = listAgrBenchmarkScenarioFiles(harness.root);
  harness.assert(onDisk.length >= 10, 'agr benchmark fixture directory must contain at least 10 scenario files');

  for (const scenarioFile of manifest.scenarios) {
    const scenario = loadAgrBenchmarkScenario(harness.root, scenarioFile);
    harness.assert(Boolean(scenario.id), `${scenarioFile} must define id`);
    harness.assert(Boolean(scenario.description), `${scenarioFile} must define description`);
    harness.assert(scenario.relevantModes.length > 0, `${scenarioFile} must define relevantModes`);
    harness.assert(Boolean(scenario.groundTruth), `${scenarioFile} must define groundTruth`);
    harness.assert(Boolean(scenario.expected), `${scenarioFile} must define expected outcomes`);

    for (const mode of scenario.relevantModes) {
      harness.assert(Boolean(scenario.expected[mode]), `${scenarioFile} must define expected.${mode}`);
    }

    if (scenario.kind === 'compose') {
      harness.assert((scenario.proposals?.length ?? 0) >= 2, `${scenarioFile} compose scenario needs at least two proposals`);
    }

    if (scenario.kind === 'registry') {
      harness.assert(Boolean(scenario.registryCase), `${scenarioFile} registry scenario needs registryCase`);
    }
  }
}

function runBenchmarkGate(): void {
  const report = runAgrBenchmarkSuite(harness.root);

  harness.assert(report.scenarioCount >= 10, `expected >= 10 scenarios, got ${report.scenarioCount}`);
  harness.assert(report.modeComparisons > 0, 'benchmark must compare at least one mode outcome');

  if (report.falseSafeRegressions.length > 0) {
    harness.fail(`false-safe regression gate failed: ${report.falseSafeRegressions.join(', ')}`);
  }

  if (report.expectationFailures.length > 0) {
    harness.fail(`benchmark expectation failures: ${report.expectationFailures.join(', ')}`);
  }

  const scenarios = loadAgrBenchmarkManifest(harness.root).scenarios.map((scenarioFile) =>
    loadAgrBenchmarkScenario(harness.root, scenarioFile)
  );

  for (const scenario of scenarios) {
    const result = runAgrBenchmarkScenario(scenario);
    for (const modeResult of result.modes) {
      if (!modeResult.matchedExpectation) {
        harness.fail(`${scenario.id}:${modeResult.mode} did not match expected benchmark outcome`);
      }
    }
  }

  harness.ok(
    `scenarios=${report.scenarioCount} comparisons=${report.modeComparisons} catchRate=${report.catchRate.validatorCaughtCount}/${report.catchRate.brokerFalseSafeCount}`
  );
}

ensureWiring();
ensureFixturePack();
runBenchmarkGate();
