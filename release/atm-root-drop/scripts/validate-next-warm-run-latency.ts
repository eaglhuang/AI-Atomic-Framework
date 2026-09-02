// ATM-BUG-2026-07-07-048 (OPT-13) latency validator.
//
// Investigation for OPT-13 found that `node atm.mjs next` does NOT actually
// trigger an import-time `git ls-files` template scan on its hot path (that
// scan only runs for `integration add/verify`, which install/compile skill
// templates). So there was no import-time git-scan bug to remove on this
// command's startup path. What *is* missing is objective, regression-proof
// evidence of end-to-end warm-run latency, split into:
//   - cliLogicMs: time spent inside the CLI's own `next` route (from its
//     built-in ATM_NEXT_PROFILE phase telemetry).
//   - wrapperOverheadMs: everything else (Node process startup + onefile
//     wrapper decompression/cache lookup + IPC), computed as
//     wall-clock - cliLogicMs for the same profiled sample.
//
// This builds a fresh, isolated onefile release (mirroring
// validate-onefile-budget.ts) so the measurement reflects the current
// source tree rather than a possibly-stale local build artifact, then runs
// several warm `next --json` invocations against the real repository (the
// same workload a developer/agent actually pays for) to compute p50/p95.
//
// Runnable directly via:
//   node --strip-types scripts/validate-next-warm-run-latency.ts
//   node --strip-types scripts/validate-next-warm-run-latency.ts --json

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildRootDropRelease } from './build-root-drop-release.ts';
import { buildOnefileRelease } from './build-onefile-release.ts';
import { createTempWorkspace } from './temp-root.ts';
import { createNextWarmLatencyWorkload } from './lib/next-warm-latency-workload.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsonOutput = process.argv.includes('--json');
const planningRoot = path.resolve(repoRoot, '..', '3KLife', 'docs', 'ai_atomic_framework');
const workload = createNextWarmLatencyWorkload(planningRoot);

const budget = {
  // Acceptance bar from ATM-BUG-2026-07-07-048 / OPT-13:
  //   - cliLogicMs: the CLI's own `next` route must stay fast (this is what
  //     import-time regressions would hit; investigation found no git ls-files
  //     scan on the `next` hot path).
  //   - warmRunP95MaxMs: end-to-end onefile warm-run ceiling for agents using
  //     `node atm.mjs next --json` on Windows-class machines.
  cliLogicMaxMs: readBudgetNumber('ATM_NEXT_CLI_LOGIC_MAX_MS', 500),
  warmRunP95MaxMs: readBudgetNumber('ATM_NEXT_WARM_RUN_MAX_P95_MS', 5_500),
  sampleCount: readBudgetNumber('ATM_NEXT_WARM_RUN_SAMPLE_COUNT', 20),
  cachePrimeCount: readBudgetNumber('ATM_NEXT_WARM_RUN_CACHE_PRIME_COUNT', 3)
};

type TimedRun = {
  exitCode: number;
  elapsedMs: number;
  stdout: string;
  stderr: string;
};

function main(): void {
  const tempRoot = createTempWorkspace('atm-next-warm-run-latency-');
  try {
  buildCurrentPackageDist();
  const rootDrop = buildRootDropRelease({
    repositoryRoot: repoRoot,
    releaseRoot: path.join(tempRoot, 'release', 'atm-root-drop')
  });
  const release = buildOnefileRelease({
    repositoryRoot: repoRoot,
    rootDropRoot: rootDrop.releaseRoot,
    outputRoot: path.join(tempRoot, 'release', 'atm-onefile')
  });
  const measuredArtifact = materializeStableOnefileMeasurementArtifact(release.outputFilePath);
  const cacheRoot = path.join(tempRoot, 'onefile-cache');

  // Prime the onefile extraction cache; these runs are intentionally excluded
  // from the warm-run sample set (they pay one-time decompression cost).
  for (let primeIndex = 0; primeIndex < budget.cachePrimeCount; primeIndex += 1) {
    runTimed(measuredArtifact.outputFilePath, workload.args, cacheRoot);
  }

  const samples: number[] = [];
  for (let index = 0; index < budget.sampleCount; index += 1) {
    const run = runTimed(measuredArtifact.outputFilePath, workload.args, cacheRoot);
    if (run.exitCode !== 0) {
      throw new Error(`warm-run sample ${index + 1} exited ${run.exitCode}: ${run.stderr.slice(0, 2000)}`);
    }
    samples.push(run.elapsedMs);
  }

  const profiledRun = runTimed(measuredArtifact.outputFilePath, workload.args, cacheRoot, { ATM_NEXT_PROFILE: '1' });
  const cliLogicMs = extractCliLogicMsFromProfileOutput(profiledRun.stderr);

  const sorted = [...samples].sort((left, right) => left - right);
  const p50 = percentile(sorted, 0.5);
  const p95 = percentile(sorted, 0.95);
  const wrapperOverheadMs = cliLogicMs !== null ? Math.max(0, profiledRun.elapsedMs - cliLogicMs) : null;

  const findings: Array<{ code: string; message: string; remediation: string }> = [];
  if (cliLogicMs !== null && cliLogicMs > budget.cliLogicMaxMs) {
    findings.push({
      code: 'ATM_NEXT_CLI_LOGIC_BUDGET_EXCEEDED',
      message: `node atm.mjs next --json CLI logic time is ${formatMs(cliLogicMs)}, budget is ${budget.cliLogicMaxMs}ms.`,
      remediation: 'Profile with ATM_NEXT_PROFILE=1 to see which CLI phase regressed inside the frozen runner.'
    });
  }
  if (p95 > budget.warmRunP95MaxMs) {
    findings.push({
      code: 'ATM_NEXT_WARM_RUN_P95_BUDGET_EXCEEDED',
      message: `node atm.mjs next --json warm-run p95 is ${formatMs(p95)}, budget is ${budget.warmRunP95MaxMs}ms.`,
      remediation: 'Profile with ATM_NEXT_PROFILE=1 to see which CLI phase regressed, and check whether onefile wrapper/extraction overhead grew (see wrapperOverheadMs in this report).'
    });
  }

  const report = {
    ok: findings.length === 0,
    budget,
    measuredArtifact: measuredArtifact.artifactKey,
    measuredAgainstRepo: repoRoot,
    workload,
    platform: process.platform,
    samples: sorted.map((value) => Number(value.toFixed(2))),
    p50Ms: Number(p50.toFixed(2)),
    p95Ms: Number(p95.toFixed(2)),
    cliLogicMs: cliLogicMs !== null ? Number(cliLogicMs.toFixed(2)) : null,
    wrapperOverheadMs: wrapperOverheadMs !== null ? Number(wrapperOverheadMs.toFixed(2)) : null,
    findings
  };

  emitReport(report);
  process.exitCode = report.ok ? 0 : 1;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

// Measuring a newly named temp launcher on Windows measures the security
// scanner's treatment of that path, not the warm launcher users retain.
// Keep the generated source fresh, but materialize byte-identical launchers
// at a content-addressed path so a warm sample has a stable executable file.
export function materializeStableOnefileMeasurementArtifact(
  sourceFilePath: string,
  stableRoot = path.join(repoRoot, '.atm', 'runtime', 'next-warm-run-artifacts')
): { outputFilePath: string; artifactKey: string; reused: boolean } {
  const source = readFileSync(sourceFilePath);
  const artifactKey = createHash('sha256').update(source).digest('hex');
  const artifactRoot = path.join(stableRoot, artifactKey);
  const outputFilePath = path.join(artifactRoot, 'atm.mjs');
  const reused = existsSync(outputFilePath) && readFileSync(outputFilePath).equals(source);
  if (!reused) {
    mkdirSync(artifactRoot, { recursive: true });
    copyFileSync(sourceFilePath, outputFilePath);
  }
  return { outputFilePath, artifactKey, reused };
}

if (path.resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  main();
}

function readBudgetNumber(name: string, defaultValue: number): number {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === '') return defaultValue;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number, got ${JSON.stringify(rawValue)}`);
  }
  return Math.floor(parsed);
}

function buildCurrentPackageDist(): void {
  const result = spawnSync(process.execPath, ['--strip-types', path.join(repoRoot, 'scripts', 'build-package-dist.ts')], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error(`failed to compile current package source before latency measurement: ${(result.stderr ?? '').slice(0, 2000)}`);
  }
}

function runTimed(entrypointPath: string, args: readonly string[], cacheRoot: string, extraEnv: Record<string, string> = {}): TimedRun {
  const startedAt = process.hrtime.bigint();
  const result = spawnSync(process.execPath, [entrypointPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ATM_ONEFILE_CACHE_ROOT: cacheRoot,
      ...extraEnv
    }
  });
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  return {
    exitCode: result.status ?? 1,
    elapsedMs,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}

function percentile(sortedAscending: readonly number[], fraction: number): number {
  if (sortedAscending.length === 0) return 0;
  const index = Math.min(sortedAscending.length - 1, Math.floor(sortedAscending.length * fraction));
  return sortedAscending[index];
}

// The CLI's own ATM_NEXT_PROFILE telemetry prints a `[ATM_NEXT_PROFILE]`
// block to stderr with lines like `phase-name: +Xms (Yms)`, where the last
// `(Yms)` is the running cumulative total for that block. That cumulative
// total on the final line is the CLI-internal logic time for this request.
function extractCliLogicMsFromProfileOutput(stderrOutput: string): number | null {
  const profileBlockStart = stderrOutput.lastIndexOf('[ATM_NEXT_PROFILE]');
  if (profileBlockStart === -1) return null;
  const block = stderrOutput.slice(profileBlockStart);
  const cumulativeMatches = [...block.matchAll(/\(([0-9]+)ms\)/g)];
  if (cumulativeMatches.length === 0) return null;
  const lastMatch = cumulativeMatches[cumulativeMatches.length - 1];
  return Number(lastMatch[1]);
}

function formatMs(value: number): string {
  return `${value.toFixed(0)}ms`;
}

function emitReport(report: unknown): void {
  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }
  const typedReport = report as {
    ok: boolean;
    p50Ms: number;
    p95Ms: number;
    cliLogicMs: number | null;
    wrapperOverheadMs: number | null;
    findings: Array<{ code: string; message: string; remediation: string }>;
  };
  console.log(`[next-warm-run-latency:validate] p50=${formatMs(typedReport.p50Ms)} p95=${formatMs(typedReport.p95Ms)} cliLogicMs=${typedReport.cliLogicMs ?? 'n/a'} wrapperOverheadMs=${typedReport.wrapperOverheadMs ?? 'n/a'}`);
  for (const finding of typedReport.findings) {
    console.error(`[next-warm-run-latency:validate] ${finding.code}: ${finding.message}\n  remediation: ${finding.remediation}`);
  }
  console.log(typedReport.ok ? '[next-warm-run-latency:validate] ok' : '[next-warm-run-latency:validate] failed');
}
