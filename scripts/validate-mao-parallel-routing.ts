import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  evaluateMaoParallelScenario,
  listMaoParallelRoutingScenarioFiles,
  loadAllMaoParallelRoutingScenarios,
  loadMaoParallelRoutingManifest,
  loadMaoParallelRoutingScenario,
  renderMaoParallelRoutingBenchmarkMarkdown,
  runMaoParallelRoutingBenchmarkSuite
} from './lib/mao-parallel-routing-benchmark-runner.ts';
import { createValidator } from './lib/validator-harness.ts';

const harness = createValidator('mao-parallel-routing', {
  argv: process.argv.slice(2),
  defaultMode: 'validate'
});

function ensureFixturePack(): void {
  harness.requireFile('scripts/fixtures/mao-parallel-routing/manifest.json');
  harness.requireFile('scripts/lib/mao-parallel-routing-benchmark-runner.ts');

  const manifest = loadMaoParallelRoutingManifest(harness.root);
  harness.assert(manifest.scenarios.length >= 10, 'mao parallel routing manifest must contain at least 10 scenarios');

  const onDisk = listMaoParallelRoutingScenarioFiles(harness.root);
  harness.assert(onDisk.length >= 10, 'mao parallel routing fixture directory must contain at least 10 scenario files');

  const scenarios = loadAllMaoParallelRoutingScenarios(harness.root);
  const hasM5Extension = scenarios.some((scenario) => scenario.coverageTier === 'm5-runner-extension');
  harness.assert(hasM5Extension, 'benchmark matrix must include at least one M5 runner-extension placeholder scenario');

  const hasRouteLifecycle = scenarios.some((scenario) => scenario.kind === 'route-lifecycle');
  harness.assert(hasRouteLifecycle, 'benchmark matrix must include route lifecycle scenarios (TASK-MAO-0003/0007)');

  const hasSteward = scenarios.some((scenario) => scenario.kind === 'steward-plan');
  harness.assert(hasSteward, 'benchmark matrix must include steward arbitration scenarios (TASK-MAO-0009)');

  for (const scenarioFile of manifest.scenarios) {
    const scenario = loadMaoParallelRoutingScenario(harness.root, scenarioFile);
    harness.assert(Boolean(scenario.id), `${scenarioFile} must define id`);
    harness.assert(Boolean(scenario.description), `${scenarioFile} must define description`);
    harness.assert(Boolean(scenario.kind), `${scenarioFile} must define kind`);
    harness.assert(Boolean(scenario.capabilityIntroducedBy), `${scenarioFile} must define capabilityIntroducedBy`);
    harness.assert(Boolean(scenario.coverageTier), `${scenarioFile} must define coverageTier`);
    harness.assert(Boolean(scenario.groundTruth), `${scenarioFile} must define groundTruth`);
    harness.assert(Boolean(scenario.expected), `${scenarioFile} must define expected outcomes`);
  }
}

function runBenchmarkGate(): void {
  const scenarios = loadAllMaoParallelRoutingScenarios(harness.root);
  const report = runMaoParallelRoutingBenchmarkSuite(harness.root);

  if (report.falseSafeRegressions.length > 0) {
    harness.fail(`false-safe regression gate failed: ${report.falseSafeRegressions.join(', ')}`);
  }

  if (report.expectationFailures.length > 0) {
    harness.fail(`benchmark expectation failures: ${report.expectationFailures.join(', ')}`);
  }

  for (const scenario of scenarios) {
    const result = evaluateMaoParallelScenario(scenario);
    if (!result.matchedExpectation) {
      harness.fail(
        `${scenario.id} did not match expected routing outcome (${result.routingVerdict} / validator ${result.validatorOutcome})`
      );
    }
  }

  const reportPath = path.join(harness.root, 'docs/reports/mao-parallel-routing-benchmark.md');
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${renderMaoParallelRoutingBenchmarkMarkdown(report, scenarios)}\n`, 'utf8');
  harness.assert(existsSync(reportPath), 'benchmark report must be written to docs/reports/mao-parallel-routing-benchmark.md');

  harness.ok(
    `scenarios=${report.scenarioCount} catchRate=${report.catchRate.catchRatePercent}% shipSafe=${report.shipSafe} avgLatencyNs=${report.latency.averageNs}`
  );
}

ensureFixturePack();
runBenchmarkGate();
