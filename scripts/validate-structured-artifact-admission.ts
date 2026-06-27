import { createValidator } from './lib/validator-harness.ts';
import { loadStructuredArtifactScenarios, runStructuredArtifactAdmission } from './lib/structured-artifact-admission-runner.ts';

const harness = createValidator('structured-artifact-admission', {
  argv: process.argv.slice(2),
  defaultMode: 'validate'
});

function ensureWiring(): void {
  const packageJson = harness.readJson<{ scripts?: Record<string, string> }>('package.json');
  harness.assert(
    packageJson.scripts?.['validate:structured-artifact-admission'] === 'node --strip-types scripts/validate-structured-artifact-admission.ts --mode validate',
    'package.json must expose validate:structured-artifact-admission'
  );
  harness.assert(
    packageJson.scripts?.['bench:structured-artifact-admission'] === 'node --strip-types scripts/run-structured-artifact-admission-track.ts',
    'package.json must expose bench:structured-artifact-admission'
  );

  const validatorsConfig = harness.readJson<{
    validators?: Array<{ name: string; entry: string; slow?: boolean }>;
    profiles?: Record<string, { validators?: string[] }>;
  }>('scripts/validators.config.json');
  const validatorDef = validatorsConfig.validators?.find((entry) => entry.name === 'validate-structured-artifact-admission');
  harness.assert(Boolean(validatorDef), 'validators.config.json must register validate-structured-artifact-admission');
  harness.assert(
    validatorDef?.entry === 'scripts/validate-structured-artifact-admission.ts',
    'validate-structured-artifact-admission entry path mismatch'
  );
  harness.assert(validatorDef?.slow === false, 'structured artifact validator should be fast');
  harness.assert(
    validatorsConfig.profiles?.standard?.validators?.includes('validate-structured-artifact-admission') === true,
    'standard profile must include validate-structured-artifact-admission'
  );
}

function ensureFixtureCoverage(): void {
  harness.requireFile('scripts/fixtures/structured-artifact-admission/manifest.json');
  harness.requireFile('scripts/fixtures/structured-artifact-admission/scenarios.json');
  harness.requireFile('scripts/lib/structured-artifact-admission-runner.ts');

  const scenarios = loadStructuredArtifactScenarios(harness.root);
  harness.assert(scenarios.length >= 12 && scenarios.length <= 20, `expected 12-20 scenarios, got ${scenarios.length}`);

  const formats = new Set(scenarios.map((scenario) => scenario.format));
  for (const format of ['json', 'yaml', 'toml', 'openapi', 'atom-map-shard'] as const) {
    harness.assert(formats.has(format), `missing structured artifact format coverage: ${format}`);
  }

  for (const scenario of scenarios) {
    harness.assert(Boolean(scenario.id), 'scenario id required');
    harness.assert(Boolean(scenario.targetFile), `${scenario.id} targetFile required`);
    harness.assert(Boolean(scenario.expectedVerdict), `${scenario.id} expected verdict required`);
    if (scenario.kind === 'compose') {
      harness.assert((scenario.proposals?.length ?? 0) >= 2, `${scenario.id} compose scenario needs at least two proposals`);
    } else {
      harness.assert(Boolean(scenario.newIntent), `${scenario.id} registry scenario needs newIntent`);
      harness.assert(Boolean(scenario.activeIntent), `${scenario.id} registry scenario needs activeIntent`);
    }
  }
}

function runGate(): void {
  const result = runStructuredArtifactAdmission(harness.root);
  harness.assert(result.summary.scenarioCount >= 12, 'structured artifact summary must include at least 12 scenarios');
  harness.assert(result.summary.shipSafe, `structured artifact expectation failures: ${result.summary.expectationFailures.join(', ')}`);
  harness.assert(result.summary.verdictCounts['parallel-safe'] > 0, 'must include parallel-safe cases');
  harness.assert(result.summary.verdictCounts.serial > 0, 'must include serial cases');
  harness.assert(
    result.summary.verdictCounts['blocked-shared-surface'] + result.summary.verdictCounts['blocked-cid-conflict'] > 0,
    'must include blocked cases'
  );
  harness.ok(`scenarios=${result.summary.scenarioCount} matched=${result.summary.matchedCount} shipSafe=${result.summary.shipSafe}`);
}

ensureWiring();
ensureFixtureCoverage();
runGate();
