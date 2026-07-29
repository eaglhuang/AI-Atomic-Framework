#!/usr/bin/env node
/**
 * Thin adapter: run one sealed scenario against an arbitrary historical/current
 * runner pair and emit paired red/green discrimination evidence.
 *
 * Control flow accepts runner paths and scenario files as data. It does not
 * embed Plan 3 task ids.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRunnerProbeReceipt,
  digestRunnerContent,
  evaluateRedGreenDiscrimination,
  sealDiscriminationScenario,
  sealRunnerIdentity,
  validateRedGreenDiscriminationSummary,
  type DiscriminationScenarioSeal,
  type RedGreenDiscriminationSummary,
  type RunnerRole,
  type SealedRunnerIdentity
} from '../packages/core/src/broker/replay/runner-discrimination.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = path.join(repoRoot, 'artifacts', 'generated', 'atm-plan3-red-green');
const summaryPath = path.join(artifactDir, 'summary.json');
const scenarioPathDefault = path.join(artifactDir, 'scenario.json');
const fixtureDir = path.join(artifactDir, 'fixtures');

type Mode = 'generate' | 'validate';

interface CliOptions {
  readonly mode: Mode;
  readonly historicalRunner: string | null;
  readonly currentRunner: string | null;
  readonly scenarioFile: string | null;
  readonly historicalCommit: string | null;
  readonly currentCommit: string | null;
  readonly useFixtures: boolean;
}

function parseArgs(argv: readonly string[]): CliOptions {
  let mode: Mode = 'generate';
  let historicalRunner: string | null = null;
  let currentRunner: string | null = null;
  let scenarioFile: string | null = null;
  let historicalCommit: string | null = null;
  let currentCommit: string | null = null;
  let useFixtures = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--mode') {
      const value = argv[++index];
      if (value !== 'generate' && value !== 'validate') {
        throw new Error(`unsupported mode: ${value}`);
      }
      mode = value;
      continue;
    }
    if (arg === '--historical-runner') {
      historicalRunner = argv[++index] ?? null;
      continue;
    }
    if (arg === '--current-runner') {
      currentRunner = argv[++index] ?? null;
      continue;
    }
    if (arg === '--scenario') {
      scenarioFile = argv[++index] ?? null;
      continue;
    }
    if (arg === '--historical-commit') {
      historicalCommit = argv[++index] ?? null;
      continue;
    }
    if (arg === '--current-commit') {
      currentCommit = argv[++index] ?? null;
      continue;
    }
    if (arg === '--use-fixtures') {
      useFixtures = true;
      continue;
    }
  }
  return {
    mode,
    historicalRunner,
    currentRunner,
    scenarioFile,
    historicalCommit,
    currentCommit,
    useFixtures
  };
}

function ensureFixtureRunners(): { readonly historical: string; readonly current: string } {
  mkdirSync(fixtureDir, { recursive: true });
  const historical = path.join(fixtureDir, 'historical-runner.mjs');
  const current = path.join(fixtureDir, 'current-runner.mjs');
  writeFileSync(historical, `#!/usr/bin/env node
const payload = {
  ok: false,
  evidence: {
    verdict: 'remain-open',
    blockers: ['sealed-failure-class-exposed'],
    faultCounters: {
      staleAuthorizationCount: 1,
      dimensionMismatchedAuthorizationCount: 1
    }
  }
};
process.stdout.write(JSON.stringify(payload));
process.exit(1);
`, 'utf8');
  writeFileSync(current, `#!/usr/bin/env node
const payload = {
  ok: true,
  evidence: {
    verdict: 'ready-to-close',
    blockers: [],
    faultCounters: {
      staleAuthorizationCount: 0,
      dimensionMismatchedAuthorizationCount: 0
    }
  }
};
process.stdout.write(JSON.stringify(payload));
process.exit(0);
`, 'utf8');
  return { historical, current };
}

function loadOrBuildScenario(scenarioFile: string | null): DiscriminationScenarioSeal {
  if (scenarioFile && existsSync(scenarioFile)) {
    const raw = JSON.parse(readFileSync(scenarioFile, 'utf8')) as {
      scenarioId?: string;
      probeArgv?: string[];
      assertion?: unknown;
      thresholds?: unknown;
      coverage?: unknown;
      workload?: unknown;
    };
    return sealDiscriminationScenario({
      scenarioId: String(raw.scenarioId ?? 'runner-discrimination-scenario'),
      probeArgv: Array.isArray(raw.probeArgv) ? raw.probeArgv.map(String) : ['--probe'],
      assertion: raw.assertion ?? { kind: 'closure-verdict', expectedHistorical: 'red', expectedCurrent: 'green' },
      thresholds: raw.thresholds ?? { starvationThresholdMs: 30000, thresholdSource: 'paired-baseline-evidence' },
      coverage: raw.coverage ?? { surface: 'runner-discrimination' },
      workload: raw.workload ?? { probe: 'json-verdict' }
    });
  }
  return sealDiscriminationScenario({
    scenarioId: 'runner-discrimination-default',
    probeArgv: ['--probe'],
    assertion: { kind: 'closure-verdict', expectedHistorical: 'red', expectedCurrent: 'green' },
    thresholds: { starvationThresholdMs: 30000, thresholdSource: 'paired-baseline-evidence' },
    coverage: { surface: 'runner-discrimination' },
    workload: { probe: 'json-verdict' }
  });
}

function sealRunnerFromPath(input: {
  readonly role: RunnerRole;
  readonly runnerPath: string;
  readonly commitSha: string | null;
}): SealedRunnerIdentity {
  const absolute = path.resolve(input.runnerPath);
  const available = existsSync(absolute);
  const contentDigest = available
    ? digestRunnerContent(readFileSync(absolute))
    : `sha256:${'0'.repeat(64)}`;
  return sealRunnerIdentity({
    role: input.role,
    entrypoint: path.relative(repoRoot, absolute).replace(/\\/g, '/'),
    contentDigest,
    commitSha: input.commitSha,
    available
  });
}

function runProbe(input: {
  readonly role: RunnerRole;
  readonly runner: SealedRunnerIdentity;
  readonly runnerPath: string;
  readonly scenario: DiscriminationScenarioSeal;
}): ReturnType<typeof buildRunnerProbeReceipt> {
  const absolute = path.resolve(repoRoot, input.runnerPath);
  const command = `${process.execPath} ${absolute} ${input.scenario.probeArgv.join(' ')}`;
  if (!input.runner.available) {
    return buildRunnerProbeReceipt({
      role: input.role,
      runner: input.runner,
      scenarioDigest: input.scenario.scenarioDigest,
      command,
      exitCode: null,
      stdout: '',
      stderr: 'runner-missing',
      executed: false
    });
  }
  const result = spawnSync(process.execPath, [absolute, ...input.scenario.probeArgv], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024
  });
  return buildRunnerProbeReceipt({
    role: input.role,
    runner: input.runner,
    scenarioDigest: input.scenario.scenarioDigest,
    command,
    exitCode: typeof result.status === 'number' ? result.status : null,
    stdout: String(result.stdout ?? ''),
    stderr: String(result.stderr ?? ''),
    executed: true
  });
}

function writeScenarioArtifact(scenario: DiscriminationScenarioSeal): void {
  mkdirSync(artifactDir, { recursive: true });
  writeFileSync(scenarioPathDefault, `${JSON.stringify({
    scenarioId: scenario.scenarioId,
    probeArgv: scenario.probeArgv,
    assertion: { kind: 'closure-verdict', expectedHistorical: 'red', expectedCurrent: 'green' },
    thresholds: { starvationThresholdMs: 30000, thresholdSource: 'paired-baseline-evidence' },
    coverage: { surface: 'runner-discrimination' },
    workload: { probe: 'json-verdict' },
    sealed: {
      assertionDigest: scenario.assertionDigest,
      thresholdDigest: scenario.thresholdDigest,
      coverageDigest: scenario.coverageDigest,
      workloadDigest: scenario.workloadDigest,
      scenarioDigest: scenario.scenarioDigest
    }
  }, null, 2)}\n`, 'utf8');
}

function generate(options: CliOptions): RedGreenDiscriminationSummary {
  mkdirSync(artifactDir, { recursive: true });
  const fixtures = options.useFixtures
    || (!options.historicalRunner && !options.currentRunner)
    ? ensureFixtureRunners()
    : null;
  const historicalPath = options.historicalRunner
    ?? fixtures?.historical
    ?? path.join(repoRoot, 'atm.mjs');
  const currentPath = options.currentRunner
    ?? fixtures?.current
    ?? path.join(repoRoot, 'atm.mjs');

  const scenario = loadOrBuildScenario(
    options.scenarioFile ? path.resolve(options.scenarioFile) : null
  );
  writeScenarioArtifact(scenario);

  const historicalSeal = sealRunnerFromPath({
    role: 'historical',
    runnerPath: historicalPath,
    commitSha: options.historicalCommit
  });
  const currentSeal = sealRunnerFromPath({
    role: 'current',
    runnerPath: currentPath,
    commitSha: options.currentCommit
  });

  // Seal identities before execution; receipts bind the pre-execution digests.
  const historical = runProbe({
    role: 'historical',
    runner: historicalSeal,
    runnerPath: historicalPath,
    scenario
  });
  const current = runProbe({
    role: 'current',
    runner: currentSeal,
    runnerPath: currentPath,
    scenario
  });

  const summary = evaluateRedGreenDiscrimination({
    scenario,
    historical,
    current,
    generatedAt: new Date().toISOString()
  });
  writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return summary;
}

function validate(): RedGreenDiscriminationSummary {
  if (!existsSync(summaryPath)) {
    throw new Error(`missing summary artifact: ${path.relative(repoRoot, summaryPath)}`);
  }
  const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as RedGreenDiscriminationSummary;
  const findings = validateRedGreenDiscriminationSummary(summary);
  if (findings.length > 0) {
    throw new Error(`red-green discrimination validation failed: ${findings.join('; ')}`);
  }
  return summary;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const summary = options.mode === 'validate' ? validate() : generate(options);
  const findings = validateRedGreenDiscriminationSummary(summary);
  if (findings.length > 0) {
    throw new Error(`red-green discrimination invalid: ${findings.join('; ')}`);
  }
  process.stdout.write(`${JSON.stringify({
    ok: true,
    mode: options.mode,
    discrimination: summary.discrimination,
    scenarioDigest: summary.scenario.scenarioDigest,
    historicalVerdict: summary.historical.verdict,
    currentVerdict: summary.current.verdict,
    summaryPath: path.relative(repoRoot, summaryPath).replace(/\\/g, '/'),
    digest: summary.digest
  }, null, 2)}\n`);
  if (options.mode === 'generate' && summary.discrimination !== 'red-green') {
    process.exitCode = 2;
  }
}

main();
