// TASK-PRF-0114: paired benchmark executor. Uses only the simulated driver and
// a test-local fake driver; no paid provider is ever called.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSimulatedDriver, type ArmDriver } from '../../scripts/lib/external-benchmark/arm-driver.ts';
import { executeTrialPlan, type TrialPlan } from '../../scripts/lib/external-benchmark/executor.ts';
import { createPairedPacket, digest, verifyPacket, type PairedRun } from '../../scripts/lib/external-benchmark/paired-executor.ts';

const frameworkRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scratch = mkdtempSync(path.join(os.tmpdir(), 'atm-executor-test-'));
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const fixtureRepo = path.join(scratch, 'fixture-repo');
execFileSync('git', ['init', '--quiet', fixtureRepo]);
git(fixtureRepo, 'config', 'user.email', 'fixture@example.invalid');
git(fixtureRepo, 'config', 'user.name', 'fixture');
writeFileSync(path.join(fixtureRepo, 'README.md'), 'fixture\n');
git(fixtureRepo, 'add', 'README.md');
git(fixtureRepo, 'commit', '--quiet', '-m', 'fixture');
const commitSha = git(fixtureRepo, 'rev-parse', 'HEAD');

function plan(overrides: Partial<TrialPlan> = {}): TrialPlan {
  return {
    schemaId: 'atm.benchmarkTrialPlan.v1',
    planId: 'plan-under-test',
    stage: 'dry-run',
    provider: 'provider-under-test',
    model: 'model-under-test',
    reasoning: 'default',
    budget: { maxTokens: null, maxCostUsd: 5, maxWallClockMs: null },
    repositories: [{ name: 'fixture/repo', repositoryUrl: fixtureRepo, commitSha }],
    scenarios: [{ scenarioId: 'scenario-1', promptDigest: `sha256:${'a'.repeat(64)}` }],
    pairsPerScenario: 2,
    ...overrides,
  };
}
const dirs = (name: string) => ({ workspaceRoot: path.join(scratch, `${name}-work`), sinkDir: path.join(scratch, `${name}-sink`), frameworkRoot });

// --- test_prf_benchmark_executor_1 (ACC-1): AB/BA pairs, isolated worktrees, raw evidence outside Git.
{
  const where = dirs('acc1');
  const summary = await executeTrialPlan({ plan: plan(), driver: createSimulatedDriver(), ...where });
  assert.equal(summary.interrupted, null);
  assert.equal(summary.packets.length, 2, 'one packet per planned pair');
  const orderOf = (packetIndex: number, arm: string) => summary.packets[packetIndex].runs.find((run) => run.arm === arm)!.order;
  assert.deepEqual([orderOf(0, 'atm'), orderOf(0, 'baseline')], [1, 2], 'first replicate runs AB');
  assert.deepEqual([orderOf(1, 'atm'), orderOf(1, 'baseline')], [2, 1], 'second replicate runs BA');
  for (const packet of summary.packets) assert.deepEqual(verifyPacket(packet, 'dry-run'), []);

  assert.equal(summary.cleanup.length, 4, 'every arm gets its own worktree');
  for (const receipt of summary.cleanup) {
    assert.equal(receipt.removed, true);
    assert.equal(existsSync(receipt.workspace), false, 'worktrees are removed after the arm');
    assert.ok(path.resolve(receipt.workspace).startsWith(path.resolve(where.workspaceRoot)), 'worktrees live under the workspace root');
  }
  for (const packet of summary.packets) {
    assert.ok(!JSON.stringify(packet).includes('gitStatus'), 'packets carry refs and digests, not raw evidence');
    for (const run of packet.runs) {
      assert.ok(run.rawRef.startsWith('sink:'), 'raw refs point into the external sink');
      const raw = JSON.parse(readFileSync(path.join(where.sinkDir, run.rawRef.slice('sink:'.length)), 'utf8'));
      assert.equal(raw.headSha, commitSha, 'the arm ran on the pinned commit');
      assert.match(raw.gitStatus, /ATM_BENCHMARK_SIMULATED/, 'the arm change is captured as Git evidence');
    }
  }
  assert.ok(existsSync(path.join(where.sinkDir, summary.summaryRef.slice('sink:'.length))), 'the execution summary is written to the sink');

  await assert.rejects(
    executeTrialPlan({ plan: plan(), driver: createSimulatedDriver(), ...where, workspaceRoot: path.join(frameworkRoot, '.tmp-executor-work') }),
    /workspaceRoot must be outside the framework repository/
  );
  await assert.rejects(
    executeTrialPlan({ plan: plan(), driver: createSimulatedDriver(), ...where, sinkDir: path.join(frameworkRoot, '.tmp-executor-sink') }),
    /sinkDir must be outside the framework repository/
  );
  await assert.rejects(
    executeTrialPlan({ plan: plan({ repositories: [{ name: 'fixture/repo', repositoryUrl: fixtureRepo, commitSha: 'b'.repeat(40) }] }), driver: createSimulatedDriver(), ...dirs('badsha') }),
    /commit/
  );
}

// --- test_prf_benchmark_executor_2 (ACC-2): synthetic packets are only admissible for the dry-run stage.
{
  const summary = await executeTrialPlan({ plan: plan(), driver: createSimulatedDriver(), ...dirs('acc2') });
  const synthetic = summary.packets[0];
  for (const stage of ['pilot', 'formal', 'replication', 'product'] as const) {
    assert.ok(verifyPacket({ ...synthetic, stage }, stage).some((error) => error.includes('synthetic runs are not admissible')), `${stage} must reject synthetic runs`);
  }
  const stripped = { ...synthetic, stage: 'pilot' as const, runs: synthetic.runs.map(({ synthetic: _flag, ...run }) => run) };
  const { packetDigest: _old, ...unsigned } = stripped;
  assert.ok(verifyPacket({ ...stripped, packetDigest: digest(unsigned) }, 'pilot').some((error) => error.includes('synthetic runs are not admissible')),
    'dropping the flag and re-signing must not launder a simulated run');

  const realRun = (arm: 'atm' | 'baseline', order: number): PairedRun => ({
    pairId: 'real-pair', runId: `real-${arm}`, arm, order, seed: 'seed', provider: 'provider-under-test', model: 'model-under-test',
    reasoning: 'default', budget: 5, promptDigest: `sha256:${'a'.repeat(64)}`, repoDigest: `sha256:${'b'.repeat(64)}`,
    sessionId: `session-${arm}`, command: 'run', rawRef: `sink:real/${arm}.json`, status: 'completed',
  });
  const real = createPairedPacket('pilot', [realRun('atm', 1), realRun('baseline', 2)]);
  assert.deepEqual(verifyPacket(real, 'pilot'), []);
  assert.ok(verifyPacket({ ...real, stage: 'dry-run' }, 'dry-run').some((error) => error.includes('dry-run packets must be synthetic')),
    'a real run cannot be filed under the dry-run stage');
}

// --- test_prf_benchmark_executor_3 (ACC-3): a real driver needs every budget cap and stops when one is exceeded.
{
  const fakeReal = (tokens: number | null): ArmDriver & { calls: number } => {
    const driver = {
      id: 'fake-real', synthetic: false, calls: 0,
      async runArm(request: Parameters<ArmDriver['runArm']>[0]) {
        driver.calls += 1;
        writeFileSync(path.join(request.workspaceDir, 'change.txt'), request.arm);
        return { status: 'completed' as const, sessionId: `s-${request.pairId}-${request.arm}`, command: 'fake', tokens, costUsd: 0.1, rawEvidence: {} };
      },
    };
    return driver;
  };
  const realPlan = (budget: TrialPlan['budget']) => plan({ stage: 'pilot', budget });

  const uncapped = fakeReal(100);
  await assert.rejects(
    executeTrialPlan({ plan: realPlan({ maxTokens: null, maxCostUsd: 10, maxWallClockMs: 600_000 }), driver: uncapped, ...dirs('acc3a') }),
    /requires maxTokens, maxCostUsd and maxWallClockMs/
  );
  assert.equal(uncapped.calls, 0, 'no arm may start before every cap is set');

  const capped = fakeReal(100);
  const stopped = await executeTrialPlan({ plan: realPlan({ maxTokens: 150, maxCostUsd: 10, maxWallClockMs: 600_000 }), driver: capped, ...dirs('acc3b') });
  assert.equal(capped.calls, 2, 'execution stops once the token cap is exceeded');
  assert.equal(stopped.interrupted?.reason, 'budget-exceeded:tokens');
  assert.equal(stopped.usage.tokens, 200, 'recorded usage is the measured total, not an estimate');
  assert.equal(stopped.packets.length, 1, 'only the completed pair produces a packet');
  assert.deepEqual(verifyPacket(stopped.packets[0], 'pilot'), []);

  const unmeasured = fakeReal(null);
  const blind = await executeTrialPlan({ plan: realPlan({ maxTokens: 150, maxCostUsd: 10, maxWallClockMs: 600_000 }), driver: unmeasured, ...dirs('acc3c') });
  assert.equal(unmeasured.calls, 1);
  assert.equal(blind.interrupted?.reason, 'usage-unmeasured', 'a real arm that reports no usage cannot be budget-checked');
  assert.equal(blind.packets.length, 0);
}

rmSync(scratch, { recursive: true, force: true });
console.log('[external-benchmark-executor.test] ok');
