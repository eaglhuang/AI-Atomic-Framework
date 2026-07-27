import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildRunnerProbeReceipt,
  deriveProbeCounters,
  evaluateRedGreenDiscrimination,
  sealDiscriminationScenario,
  sealRunnerIdentity,
  digestRunnerContent,
  validateRedGreenDiscriminationSummary
} from '../../packages/core/src/schemas/parallel-replay-scenario.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const harnessScript = path.join(repoRoot, 'scripts', 'run-plan3-red-green-discrimination.ts');
const artifactSummary = path.join(repoRoot, 'artifacts', 'generated', 'atm-plan3-red-green', 'summary.json');

const scenario = sealDiscriminationScenario({
  scenarioId: 'discrimination-contract',
  probeArgv: ['--probe'],
  assertion: { expectedHistorical: 'red', expectedCurrent: 'green' },
  thresholds: { starvationThresholdMs: 30000, thresholdSource: 'paired-baseline-evidence' },
  coverage: { surface: 'runner-discrimination' },
  workload: { probe: 'json-verdict' }
});

const historicalRunnerSource = `export default 'historical-red-runner';\n`;
const currentRunnerSource = `export default 'current-green-runner';\n`;

const historicalSeal = sealRunnerIdentity({
  role: 'historical',
  entrypoint: 'fixtures/historical-runner.mjs',
  contentDigest: digestRunnerContent(historicalRunnerSource),
  commitSha: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  available: true
});
const currentSeal = sealRunnerIdentity({
  role: 'current',
  entrypoint: 'fixtures/current-runner.mjs',
  contentDigest: digestRunnerContent(currentRunnerSource),
  commitSha: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  available: true
});

const redStdout = JSON.stringify({
  ok: false,
  evidence: {
    verdict: 'remain-open',
    blockers: ['stale-authorization'],
    faultCounters: { staleAuthorizationCount: 1 }
  }
});
const greenStdout = JSON.stringify({
  ok: true,
  evidence: {
    verdict: 'ready-to-close',
    blockers: [],
    faultCounters: { staleAuthorizationCount: 0 }
  }
});

const historicalCounters = deriveProbeCounters({
  exitCode: 1,
  stdout: redStdout,
  stderr: '',
  eventStateDiff: { closurePacketDivergenceCount: 1 }
});
assert.equal(historicalCounters.failureExitCount, 1);
assert.equal(historicalCounters.remainOpenCount, 1);
assert.equal(historicalCounters.blockerCount, 1);
assert.equal(historicalCounters.staleAuthorizationCount, 1);
assert.equal(historicalCounters.closurePacketDivergenceCount, 1);
assert.equal('failureShapes' in historicalCounters, false);

const historical = buildRunnerProbeReceipt({
  role: 'historical',
  runner: historicalSeal,
  scenarioDigest: scenario.scenarioDigest,
  command: 'node fixtures/historical-runner.mjs --probe',
  exitCode: 1,
  stdout: redStdout,
  stderr: '',
  executed: true,
  eventStateDiff: { closurePacketDivergenceCount: 1 }
});
const current = buildRunnerProbeReceipt({
  role: 'current',
  runner: currentSeal,
  scenarioDigest: scenario.scenarioDigest,
  command: 'node fixtures/current-runner.mjs --probe',
  exitCode: 0,
  stdout: greenStdout,
  stderr: '',
  executed: true
});

assert.equal(historical.verdict, 'red');
assert.equal(current.verdict, 'green');
assert.equal(historical.scenarioDigest, current.scenarioDigest);

const discriminating = evaluateRedGreenDiscrimination({
  scenario,
  historical,
  current,
  generatedAt: '2026-07-26T00:00:00.000Z'
});
assert.equal(discriminating.discrimination, 'red-green');
assert.equal(validateRedGreenDiscriminationSummary(discriminating).length, 0);

const sameVerdict = evaluateRedGreenDiscrimination({
  scenario,
  historical,
  current: buildRunnerProbeReceipt({
    role: 'current',
    runner: currentSeal,
    scenarioDigest: scenario.scenarioDigest,
    command: 'node fixtures/current-runner.mjs --probe',
    exitCode: 1,
    stdout: redStdout,
    stderr: '',
    executed: true
  }),
  generatedAt: '2026-07-26T00:00:00.000Z'
});
assert.equal(sameVerdict.discrimination, 'inconclusive');

const unavailable = evaluateRedGreenDiscrimination({
  scenario,
  historical: buildRunnerProbeReceipt({
    role: 'historical',
    runner: sealRunnerIdentity({
      role: 'historical',
      entrypoint: 'missing-historical.mjs',
      contentDigest: `sha256:${'0'.repeat(64)}`,
      available: false
    }),
    scenarioDigest: scenario.scenarioDigest,
    command: 'node missing-historical.mjs --probe',
    exitCode: null,
    stdout: '',
    stderr: 'runner-missing',
    executed: false
  }),
  current,
  generatedAt: '2026-07-26T00:00:00.000Z'
});
assert.equal(unavailable.discrimination, 'inconclusive');

// Harness adapter must accept arbitrary runner pairs / scenario files and avoid
// Plan-3 task-id control-flow hardcoding.
const harnessSource = readFileSync(harnessScript, 'utf8');
assert.equal(/ATM-GOV-0240|ATM-GOV-0239|ATM-GOV-0226/.test(harnessSource), false);
assert.match(harnessSource, /--historical-runner/);
assert.match(harnessSource, /--current-runner/);
assert.match(harnessSource, /--scenario/);

const generate = spawnSync(process.execPath, ['--strip-types', harnessScript, '--mode', 'generate', '--use-fixtures'], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024
});
assert.equal(generate.status, 0, `generate failed: ${generate.stderr || generate.stdout}`);
assert.equal(existsSummary(), true);

const summary = JSON.parse(readFileSync(artifactSummary, 'utf8'));
assert.equal(summary.discrimination, 'red-green');
assert.equal(summary.historical.verdict, 'red');
assert.equal(summary.current.verdict, 'green');
assert.equal(summary.historical.scenarioDigest, summary.current.scenarioDigest);
assert.equal(summary.scenario.scenarioDigest, summary.historical.scenarioDigest);
assert.ok((summary.historical.counters.failureExitCount ?? 0) > 0);
assert.ok(!('failureShapes' in summary.historical));

const validate = spawnSync(process.execPath, ['--strip-types', harnessScript, '--mode', 'validate'], {
  cwd: repoRoot,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024
});
assert.equal(validate.status, 0, `validate failed: ${validate.stderr || validate.stdout}`);

// Temp-dir pair proves arbitrary runner paths are accepted.
const tempRoot = mkdtempSync(path.join(tmpdir(), 'atm-red-green-'));
try {
  const historicalPath = path.join(tempRoot, 'old.mjs');
  const currentPath = path.join(tempRoot, 'new.mjs');
  const scenarioFile = path.join(tempRoot, 'scenario.json');
  writeFileSync(historicalPath, `process.stdout.write(${JSON.stringify(redStdout)}); process.exit(1);\n`, 'utf8');
  writeFileSync(currentPath, `process.stdout.write(${JSON.stringify(greenStdout)}); process.exit(0);\n`, 'utf8');
  writeFileSync(scenarioFile, JSON.stringify({
    scenarioId: 'temp-pair',
    probeArgv: ['--probe'],
    assertion: { marker: 'temp' },
    thresholds: { starvationThresholdMs: 1, thresholdSource: 'policy' },
    coverage: { surface: 'temp' },
    workload: { probe: 'temp' }
  }), 'utf8');
  mkdirSync(path.dirname(artifactSummary), { recursive: true });
  const tempRun = spawnSync(process.execPath, [
    '--strip-types',
    harnessScript,
    '--mode',
    'generate',
    '--historical-runner',
    historicalPath,
    '--current-runner',
    currentPath,
    '--scenario',
    scenarioFile,
    '--historical-commit',
    '1111111111111111111111111111111111111111',
    '--current-commit',
    '2222222222222222222222222222222222222222'
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024
  });
  assert.equal(tempRun.status, 0, `temp pair generate failed: ${tempRun.stderr || tempRun.stdout}`);
  const tempSummary = JSON.parse(readFileSync(artifactSummary, 'utf8'));
  assert.equal(tempSummary.discrimination, 'red-green');
  assert.equal(tempSummary.historical.runner.commitSha, '1111111111111111111111111111111111111111');
  assert.equal(tempSummary.current.runner.commitSha, '2222222222222222222222222222222222222222');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[atm-3-red-baseline-discrimination] ok');

function existsSummary(): boolean {
  try {
    readFileSync(artifactSummary, 'utf8');
    return true;
  } catch {
    return false;
  }
}
