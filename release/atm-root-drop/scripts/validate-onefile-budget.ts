import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildRootDropRelease } from './build-root-drop-release.ts';
import { buildOnefileRelease, isOnefilePayloadPath } from './build-onefile-release.ts';
import { createTempWorkspace } from './temp-root.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const budget = {
  maxBytes: readBudgetNumber('ATM_ONEFILE_MAX_BYTES', 4_500_000),
  coldStartupMaxMs: readBudgetNumber('ATM_ONEFILE_COLD_STARTUP_MAX_MS', 4_000),
  warmStartupMaxMs: readBudgetNumber('ATM_ONEFILE_WARM_STARTUP_MAX_MS', 2_500)
};
const jsonOutput = process.argv.includes('--json');

type TimedRun = {
  exitCode: number;
  elapsedMs: number;
  stdout: string;
  stderr: string;
};

type Finding = {
  code: string;
  message: string;
  remediation: string;
};

const tempRoot = createTempWorkspace('atm-onefile-budget-');
await main();

async function main() {
try {
  const rootDrop = buildRootDropRelease({
    repositoryRoot: repoRoot,
    releaseRoot: path.join(tempRoot, 'release', 'atm-root-drop')
  });
  const release = buildOnefileRelease({
    repositoryRoot: repoRoot,
    rootDropRoot: rootDrop.releaseRoot,
    outputRoot: path.join(tempRoot, 'release', 'atm-onefile')
  });
  const manifest = JSON.parse(readFileSync(release.manifestPath, 'utf8'));
  const onefileSizeBytes = statSync(release.outputFilePath).size;
  const largestPayloadFiles = collectLargestFiles(rootDrop.releaseRoot, 8);
  const cacheBaseRoot = path.join(tempRoot, 'onefile-cache');
  const cacheRoot = path.join(cacheBaseRoot, String(manifest.payloadSha256));
  rmSync(cacheBaseRoot, { recursive: true, force: true });

  const coldStartup = runTimed(release.outputFilePath, ['--version'], {
    ATM_ONEFILE_CACHE_ROOT: cacheBaseRoot
  });
  const warmStartup = runTimed(release.outputFilePath, ['--version'], {
    ATM_ONEFILE_CACHE_ROOT: cacheBaseRoot
  });
  const lockWait = await validateExtractionLockHandoff({
    entrypointPath: release.outputFilePath,
    cacheBaseRoot,
    cacheRoot,
    payloadSha256: String(manifest.payloadSha256),
    releaseRoot: rootDrop.releaseRoot
  });
  const packageManifest = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const runnerBoundary = validateRunnerBoundary(packageManifest.scripts ?? {});
  const findings: Finding[] = [];

  if (onefileSizeBytes > budget.maxBytes) {
    findings.push({
      code: 'ONEFILE_SIZE_BUDGET_EXCEEDED',
      message: `onefile artifact is ${onefileSizeBytes} bytes, budget is ${budget.maxBytes} bytes.`,
      remediation: `Trim root-drop payload files or split dev-only files out of release/atm-root-drop. Largest payload files: ${formatLargestFiles(largestPayloadFiles)}.`
    });
  }

  if (coldStartup.exitCode !== 0 || warmStartup.exitCode !== 0) {
    findings.push({
      code: 'ONEFILE_STARTUP_FAILED',
      message: `onefile --version failed (cold=${coldStartup.exitCode}, warm=${warmStartup.exitCode}).`,
      remediation: 'Run npm run build:onefile-release, then run node release/atm-onefile/atm.mjs --version to inspect the release runner failure.'
    });
  }

  assertVersionOutput(coldStartup, findings, 'cold');
  assertVersionOutput(warmStartup, findings, 'warm');

  if (coldStartup.elapsedMs > budget.coldStartupMaxMs) {
    findings.push({
      code: 'ONEFILE_COLD_STARTUP_BUDGET_EXCEEDED',
      message: `cold startup took ${formatMs(coldStartup.elapsedMs)}, budget is ${budget.coldStartupMaxMs}ms.`,
      remediation: 'Reduce embedded payload size, avoid release-time dev fixtures, or profile extraction under the OS temp atm-onefile-cache directory.'
    });
  }

  if (warmStartup.elapsedMs > budget.warmStartupMaxMs) {
    findings.push({
      code: 'ONEFILE_WARM_STARTUP_BUDGET_EXCEEDED',
      message: `warm startup took ${formatMs(warmStartup.elapsedMs)}, budget is ${budget.warmStartupMaxMs}ms.`,
      remediation: 'Profile the extracted frozen runner path and avoid adding startup work to release CLI command dispatch.'
    });
  }

  findings.push(...runnerBoundary.findings);
  findings.push(...lockWait.findings);

  const report = {
    ok: findings.length === 0,
    budget,
    releaseRunner: 'release/atm-onefile/atm.mjs',
    devRunner: 'atm.dev.mjs',
    measuredArtifact: path.relative(repoRoot, release.outputFilePath).replace(/\\/g, '/'),
    onefileSizeBytes,
    startup: {
      coldMs: Number(coldStartup.elapsedMs.toFixed(2)),
      warmMs: Number(warmStartup.elapsedMs.toFixed(2))
    },
    extractionLock: lockWait.summary,
    fileCount: release.fileCount,
    payloadSha256: manifest.payloadSha256,
    largestPayloadFiles,
    runnerBoundary: runnerBoundary.summary,
    findings
  };

  emitReport(report);
  process.exitCode = report.ok ? 0 : 1;
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
}

function readBudgetNumber(name: string, defaultValue: number) {
  const rawValue = process.env[name];
  if (rawValue === undefined || rawValue === '') return defaultValue;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number, got ${JSON.stringify(rawValue)}`);
  }
  return Math.floor(parsed);
}

function runTimed(entrypointPath: string, args: string[], extraEnv: Record<string, string> = {}): TimedRun {
  const startedAt = process.hrtime.bigint();
  const result = spawnSync(process.execPath, [entrypointPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
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

async function validateExtractionLockHandoff(input: {
  entrypointPath: string;
  cacheBaseRoot: string;
  cacheRoot: string;
  payloadSha256: string;
  releaseRoot: string;
}) {
  const findings: Finding[] = [];
  const lockRoot = `${input.cacheRoot}.lock`;
  rmSync(input.cacheBaseRoot, { recursive: true, force: true });
  mkdirSync(lockRoot, { recursive: true });
  writeFileSync(path.join(lockRoot, 'owner.json'), JSON.stringify({
    pid: process.pid,
    fixture: 'validate-onefile-budget',
    payloadSha256: input.payloadSha256
  }, null, 2) + '\n');

  const startedAt = process.hrtime.bigint();
  const child = spawn(process.execPath, [input.entrypointPath, '--version'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      ATM_ONEFILE_CACHE_ROOT: input.cacheBaseRoot,
      ATM_ONEFILE_EXTRACT_LOCK_TIMEOUT_MS: '4000',
      ATM_ONEFILE_EXTRACT_LOCK_POLL_MS: '20'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  child.stdout.on('data', (chunk) => stdoutChunks.push(Buffer.from(chunk)));
  child.stderr.on('data', (chunk) => stderrChunks.push(Buffer.from(chunk)));

  await delay(150);
  // Mirror the real payload contents: exclude release/** so the fixture tree
  // cannot contain a same-sha nested onefile launcher that re-enters its own
  // cache dir and self-spawns forever (TASK-RFT-0015). Stage then rename so
  // the handoff is atomic instead of racing the child's 4s lock timeout.
  const handoffStagingRoot = `${input.cacheRoot}.handoff-staging`;
  cpSync(input.releaseRoot, handoffStagingRoot, {
    recursive: true,
    filter: (source) => !path.relative(input.releaseRoot, source).replace(/\\/g, '/').startsWith('release')
  });
  writeFileSync(path.join(handoffStagingRoot, '.payload-ready.json'), JSON.stringify({
    schemaVersion: 'atm.onefilePayload.v0.1',
    generatedAt: '1970-01-01T00:00:00.000Z',
    payloadSha256: input.payloadSha256
  }, null, 2) + '\n');
  renameSync(handoffStagingRoot, input.cacheRoot);
  rmSync(lockRoot, { recursive: true, force: true });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  const stderr = Buffer.concat(stderrChunks).toString('utf8');

  if (exitCode !== 0) {
    findings.push({
      code: 'ONEFILE_EXTRACTION_LOCK_WAIT_FAILED',
      message: `runner failed while waiting for an in-flight extraction handoff (exit=${exitCode}).`,
      remediation: 'Keep onefile extraction lock handoff atomic so a second process can wait for readiness instead of crashing on a partially refreshed cache.'
    });
  } else {
    try {
      const parsed = JSON.parse((stdout || stderr).trim());
      if (parsed.command !== 'version' || parsed.ok !== true) {
        findings.push({
          code: 'ONEFILE_EXTRACTION_LOCK_WAIT_OUTPUT_INVALID',
          message: 'runner returned unexpected output after extraction lock handoff.',
          remediation: 'Preserve the normal ATM JSON envelope after extraction lock wait completes.'
        });
      }
    } catch (error: any) {
      findings.push({
        code: 'ONEFILE_EXTRACTION_LOCK_WAIT_OUTPUT_NOT_JSON',
        message: `runner output after extraction lock handoff was not JSON: ${error.message}`,
        remediation: 'Keep onefile extraction wait-path output identical to the standard version command envelope.'
      });
    }
  }

  return {
    findings,
    summary: {
      cacheBaseRoot: path.relative(repoRoot, input.cacheBaseRoot).replace(/\\/g, '/'),
      handoffElapsedMs: Number(elapsedMs.toFixed(2)),
      exitCode
    }
  };
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function assertVersionOutput(run: TimedRun, findings: Finding[], phase: string) {
  if (run.exitCode !== 0) return;
  const payload = (run.stdout || run.stderr).trim();
  try {
    const parsed = JSON.parse(payload);
    if (parsed.command !== 'version' || parsed.ok !== true) {
      findings.push({
        code: 'ONEFILE_VERSION_OUTPUT_INVALID',
        message: `${phase} startup did not return the expected version command envelope.`,
        remediation: 'Keep release runner command output compatible with the frozen ATM JSON envelope before adding budget exceptions.'
      });
    }
  } catch (error: any) {
    findings.push({
      code: 'ONEFILE_VERSION_OUTPUT_NOT_JSON',
      message: `${phase} startup output was not JSON: ${error.message}`,
      remediation: 'Check release runner stdout/stderr handling and preserve JSON output for --version.'
    });
  }
}

function validateRunnerBoundary(scripts: Record<string, string>) {
  const findings: Finding[] = [];
  const buildOnefileScript = scripts['build:onefile-release'] ?? '';
  const validateBudgetScript = scripts['validate:onefile-budget'] ?? '';

  if (buildOnefileScript !== 'node --strip-types scripts/build-onefile-release.ts') {
    findings.push({
      code: 'ONEFILE_BUILD_SCRIPT_BOUNDARY_DRIFT',
      message: 'build:onefile-release must point at scripts/build-onefile-release.ts.',
      remediation: 'Keep release runner construction in scripts/build-onefile-release.ts; do not route it through atm.dev.mjs.'
    });
  }

  if (validateBudgetScript !== 'node --strip-types scripts/validate-onefile-budget.ts') {
    findings.push({
      code: 'ONEFILE_BUDGET_SCRIPT_MISSING',
      message: 'validate:onefile-budget script is missing or points at the wrong runner.',
      remediation: 'Add "validate:onefile-budget": "node --strip-types scripts/validate-onefile-budget.ts" to package.json.'
    });
  }

  for (const [scriptName, scriptValue] of Object.entries({ buildOnefileScript, validateBudgetScript })) {
    if (scriptValue.includes('atm.dev.mjs')) {
      findings.push({
        code: 'ONEFILE_DEV_RUNNER_BOUNDARY_DRIFT',
        message: `${scriptName} references atm.dev.mjs.`,
        remediation: 'Keep atm.dev.mjs for source-first framework validation only; release budget checks target the generated onefile runner.'
      });
    }
  }

  return {
    findings,
    summary: {
      buildOnefileScript,
      validateBudgetScript,
      budgetTarget: 'release runner only',
      devRunnerExcluded: true
    }
  };
}

function collectLargestFiles(root: string, limit: number) {
  return walkFiles(root)
    .map((absolutePath) => ({
      path: path.relative(root, absolutePath).replace(/\\/g, '/'),
      bytes: statSync(absolutePath).size
    }))
    .filter((file) => isOnefilePayloadPath(file.path))
    .sort((left, right) => right.bytes - left.bytes)
    .slice(0, limit);
}

function walkFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolutePath = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(absolutePath) : [absolutePath];
  });
}

function formatLargestFiles(files: Array<{ path: string; bytes: number }>) {
  return files.map((file) => `${file.path} (${file.bytes} bytes)`).join(', ');
}

function formatMs(value: number) {
  return `${value.toFixed(2)}ms`;
}

function emitReport(report: any) {
  if (jsonOutput) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const status = report.ok ? 'ok' : 'failed';
  console.log(`[onefile-budget] ${status} size=${report.onefileSizeBytes}/${report.budget.maxBytes} bytes cold=${formatMs(report.startup.coldMs)}/${report.budget.coldStartupMaxMs}ms warm=${formatMs(report.startup.warmMs)}/${report.budget.warmStartupMaxMs}ms releaseRunner=${report.releaseRunner} devRunner=${report.devRunner} devRunnerExcluded=${report.runnerBoundary.devRunnerExcluded}`);
  for (const finding of report.findings) {
    console.error(`[onefile-budget] ${finding.code}: ${finding.message} Remediation: ${finding.remediation}`);
  }
}
