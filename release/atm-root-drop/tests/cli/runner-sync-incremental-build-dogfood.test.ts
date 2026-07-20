import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildRunnerSyncReceipt,
  computeBuildInputsTreeHash,
  inspectBuildCache
} from '../../scripts/run-sealed-runner-build.ts';
import {
  buildRunnerSyncBuildObservation,
  planRunnerIncrementalBuild,
  summarizeDominantPhase
} from '../../scripts/runner-sync-incremental-build.ts';

const liveIsolated = process.argv.includes('--mode') && process.argv.includes('live-isolated');
const requireRealCacheMiss = process.argv.includes('--require-real-cache-miss');
assert.equal(liveIsolated, true, 'dogfood test must run in live-isolated mode');
assert.equal(requireRealCacheMiss, true, 'dogfood test must require a real cache miss');

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-runner-dogfood-'));
execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'dogfood@example.com'], { cwd: repo });
execFileSync('git', ['config', 'user.name', 'Dogfood Test'], { cwd: repo });

for (const directory of [
  'packages/cli/src',
  'packages/core/src',
  'scripts',
  'release/atm-root-drop',
  'release/atm-onefile'
]) {
  mkdirSync(path.join(repo, directory), { recursive: true });
}

writeFileSync(path.join(repo, 'packages/cli/src/index.ts'), 'export const cli = "baseline";\n');
writeFileSync(path.join(repo, 'packages/core/src/index.ts'), 'export const core = "baseline";\n');
writeFileSync(path.join(repo, 'scripts/build-package-dist.ts'), 'console.log("builder");\n');
writeFileSync(path.join(repo, 'package.json'), '{"name":"fixture"}\n');
writeFileSync(path.join(repo, 'package-lock.json'), '{"lockfileVersion":3}\n');
writeFileSync(path.join(repo, 'tsconfig.json'), '{}\n');
writeFileSync(path.join(repo, 'tsconfig.build.json'), '{}\n');
execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'baseline'], { cwd: repo, stdio: 'ignore' });
const baselineSha = gitHead(repo);
const baselineTreeHash = computeBuildInputsTreeHash(repo, baselineSha);
writeManifest('release/atm-root-drop/release-manifest.json', baselineSha, baselineTreeHash);
writeManifest('release/atm-onefile/release-manifest.json', baselineSha, baselineTreeHash);
execFileSync('git', ['add', 'release'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'release baseline'], { cwd: repo, stdio: 'ignore' });
const releaseBaselineSha = gitHead(repo);

writeFileSync(path.join(repo, 'packages/cli/src/index.ts'), 'export const cli = "package-only";\n');
execFileSync('git', ['add', 'packages/cli/src/index.ts'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'package-only'], { cwd: repo, stdio: 'ignore' });
const packageOnlySha = gitHead(repo);
const packageOnlyTreeHash = computeBuildInputsTreeHash(repo, packageOnlySha);
const cacheMiss = inspectBuildCache({ cwd: repo, buildTarget: 'full', buildInputsTreeHash: packageOnlyTreeHash });
assert.equal(cacheMiss.decision, 'fullRebuild');
assert.match(cacheMiss.reason, /buildInputsTreeHash mismatch/);

const incrementalPlan = planRunnerIncrementalBuild({
  cwd: repo,
  previousSealedSourceSha: releaseBaselineSha,
  currentSealedSourceSha: packageOnlySha
});
assert.equal(incrementalPlan.incrementalEligible, true);
assert.deepEqual(incrementalPlan.affectedPackages, ['packages/cli']);

writeFileSync(path.join(repo, 'tsconfig.build.json'), '{"compilerOptions":{"incremental":true}}\n');
execFileSync('git', ['add', 'tsconfig.build.json'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'root config'], { cwd: repo, stdio: 'ignore' });
const unsafePlan = planRunnerIncrementalBuild({
  cwd: repo,
  previousSealedSourceSha: packageOnlySha,
  currentSealedSourceSha: gitHead(repo)
});
assert.equal(unsafePlan.incrementalEligible, false);
assert.ok(unsafePlan.unsafeReasons.includes('root-config-change'));

const brokerTicket = {
  ticketId: 'runner-sync-dogfood:ATM-GOV-0201',
  waitedMs: 1234,
  position: 1,
  headOwner: 'ATM-GOV-0201'
};
const timings = {
  startedAt: Date.now(),
  inputHashCalculationMs: 5,
  skipDecisionMs: 6,
  worktreeSetupMs: 7,
  typescriptBuildMs: 50,
  rootDropAssemblyMs: 30,
  onefileAssemblyMs: 20,
  artifactSyncMs: 10,
  cleanupMs: 5,
  totalElapsedMs: 133
};
const receipt = buildRunnerSyncReceipt({
  admission: {
    brokerTicket,
    queueHeadOwnership: {
      waitingTasks: ['ATM-GOV-0201'],
      stewardWorkId: 'runner-sync-dogfood'
    },
    runnerSyncSteward: {
      requestedSurfaces: ['release/atm-onefile/atm.mjs']
    }
  } as any,
  actorId: 'codex-captain-0201',
  sealedSourceSha: packageOnlySha,
  buildTarget: 'full',
  buildInputsTreeHash: packageOnlyTreeHash,
  buildDecision: 'incrementalBuild',
  decisionReason: 'dogfood package-only cache miss',
  incrementalPlan,
  timings
});
assert.equal(receipt.buildDecision, 'incrementalBuild');
assert.equal(receipt.brokerTicket?.waitedMs, 1234);
assert.equal(receipt.dominantPhaseSummary.dominantPhase, 'typescriptBuild');
assert.equal(receipt.buildObservation.changedPathCount > 0, true);

const fullRebuildObservation = buildRunnerSyncBuildObservation({
  buildDecision: 'fullRebuild',
  decisionReason: unsafePlan.unsafeReasons[0] ?? 'unsafe',
  incrementalPlan: unsafePlan,
  timings,
  brokerTicket
});
assert.equal(fullRebuildObservation.unsafeReasons.includes('root-config-change'), true);

const abba = Array.from({ length: 10 }, (_, index) => summarizeDominantPhase({
  ...timings,
  typescriptBuildMs: index % 2 === 0 ? 40 : 45,
  totalElapsedMs: index % 2 === 0 ? 120 : 125
}, 'ab-ba'));
assert.equal(abba.length, 10);
assert.equal(abba.filter((entry) => entry.optimizationVerdict === 'improved').length, 10);

console.log('[runner-sync-incremental-build-dogfood.test] ok');

function writeManifest(relativePath: string, sealedSourceCommit: string, buildInputsTreeHash: string): void {
  writeFileSync(path.join(repo, relativePath), `${JSON.stringify({
    schemaVersion: 'fixture',
    sealedSourceCommit,
    buildInputsTreeHash
  }, null, 2)}\n`);
}

function gitHead(cwd: string): string {
  return execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
}
