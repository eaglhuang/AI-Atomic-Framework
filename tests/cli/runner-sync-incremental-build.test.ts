import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildRunnerSyncReceipt,
  writeBuildMetadataToReleaseManifests
} from '../../scripts/run-sealed-runner-build.ts';
import {
  persistTsBuildCache,
  planRunnerIncrementalBuild,
  prepareTsBuildCache
} from '../../scripts/runner-sync-incremental-build.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-runner-incremental-'));
execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });

for (const directory of [
  'packages/cli/src',
  'scripts',
  'release/atm-root-drop',
  'release/atm-onefile'
]) {
  mkdirSync(path.join(repo, directory), { recursive: true });
}

writeFileSync(path.join(repo, 'packages/cli/src/index.ts'), 'export const cli = true;\n');
writeFileSync(path.join(repo, 'scripts/build-package-dist.ts'), 'console.log("builder");\n');
writeFileSync(path.join(repo, 'package.json'), '{"name":"fixture"}\n');
writeFileSync(path.join(repo, 'package-lock.json'), '{"lockfileVersion":3}\n');
writeFileSync(path.join(repo, 'tsconfig.json'), '{}\n');
writeFileSync(path.join(repo, 'tsconfig.build.json'), '{}\n');
writeManifest('release/atm-root-drop/release-manifest.json');
writeManifest('release/atm-onefile/release-manifest.json');
execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'baseline'], { cwd: repo, stdio: 'ignore' });
const baselineSha = gitHead(repo);

writeFileSync(path.join(repo, 'packages/cli/src/index.ts'), 'export const cli = "changed";\n');
execFileSync('git', ['add', 'packages/cli/src/index.ts'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'package-only'], { cwd: repo, stdio: 'ignore' });
const packageOnlySha = gitHead(repo);
const packagePlan = planRunnerIncrementalBuild({
  cwd: repo,
  previousSealedSourceSha: baselineSha,
  currentSealedSourceSha: packageOnlySha
});
assert.equal(packagePlan.incrementalEligible, true);
assert.deepEqual(packagePlan.affectedPackages, ['packages/cli']);

writeFileSync(path.join(repo, 'scripts/build-package-dist.ts'), 'console.log("builder changed");\n');
execFileSync('git', ['add', 'scripts/build-package-dist.ts'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'builder-change'], { cwd: repo, stdio: 'ignore' });
const unsafePlan = planRunnerIncrementalBuild({
  cwd: repo,
  previousSealedSourceSha: packageOnlySha,
  currentSealedSourceSha: gitHead(repo)
});
assert.equal(unsafePlan.incrementalEligible, false);
assert.ok(unsafePlan.unsafeReasons.includes('build-script-change'));

const worktreeRoot = path.join(repo, 'worktree');
mkdirSync(path.join(worktreeRoot, '.atm-runtime-cache'), { recursive: true });
mkdirSync(path.join(repo, '.atm', 'runtime', 'runner-sync-build-cache', 'typescript'), { recursive: true });
const persistentCachePath = path.join(repo, '.atm', 'runtime', 'runner-sync-build-cache', 'typescript', 'tsconfig.build.tsbuildinfo');
writeFileSync(persistentCachePath, '{"version":"before"}\n');
const prepared = prepareTsBuildCache({ cwd: repo, worktreeRoot });
assert.equal(prepared.existedBefore, true);
assert.equal(prepared.restoredBeforeBuild, true);
assert.equal(existsSync(path.join(worktreeRoot, '.atm-runtime-cache', 'tsconfig.build.tsbuildinfo')), true);
writeFileSync(path.join(worktreeRoot, '.atm-runtime-cache', 'tsconfig.build.tsbuildinfo'), '{"version":"after"}\n');
const persisted = persistTsBuildCache({ cwd: repo, worktreeRoot, summary: prepared });
assert.equal(persisted?.persistedAfterBuild, true);
assert.notEqual(persisted?.digestBefore, persisted?.digestAfter);
assert.equal(persisted?.gitPolicy.rawCacheCommitted, false);

writeBuildMetadataToReleaseManifests({
  cwd: repo,
  sealedSourceSha: gitHead(repo),
  buildInputsTreeHash: 'sha256:' + '0'.repeat(64),
  buildDecision: 'incrementalBuild',
  decisionReason: 'fixture',
  incrementalPlan: packagePlan,
  tsBuildCache: persisted,
  timings: timings()
});
const manifest = JSON.parse(readFileSync(path.join(repo, 'release/atm-root-drop/release-manifest.json'), 'utf8'));
assert.match(manifest.tsBuildCacheDigest, /^sha256:[a-f0-9]{64}$/);
assert.equal(manifest.rawTelemetryPolicy, 'gitignored-runtime-only');

const receipt = buildRunnerSyncReceipt({
  admission: {
    queueHeadOwnership: {
      waitingTasks: ['ATM-GOV-0191'],
      stewardWorkId: 'runner-sync-fixture'
    },
    runnerSyncSteward: {
      requestedSurfaces: ['release/atm-onefile/atm.mjs']
    }
  } as any,
  actorId: 'test-actor',
  sealedSourceSha: gitHead(repo),
  buildTarget: 'full',
  buildInputsTreeHash: 'sha256:' + '1'.repeat(64),
  buildDecision: 'incrementalBuild',
  decisionReason: 'fixture',
  incrementalPlan: packagePlan,
  tsBuildCache: persisted,
  timings: timings()
});
assert.equal(receipt.tsBuildCache?.gitPolicy.rawCacheCommitted, false);
assert.match(receipt.treatmentTelemetry.tsBuildCacheDigest ?? '', /^sha256:[a-f0-9]{64}$/);

console.log('[runner-sync-incremental-build.test] ok');

function writeManifest(relativePath: string): void {
  writeFileSync(path.join(repo, relativePath), `${JSON.stringify({ schemaVersion: 'fixture' }, null, 2)}\n`);
}

function gitHead(cwd: string): string {
  return execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
}

function timings() {
  return {
    startedAt: Date.now(),
    inputHashCalculationMs: 1,
    skipDecisionMs: 2,
    worktreeSetupMs: 3,
    typescriptBuildMs: 4,
    rootDropAssemblyMs: 5,
    onefileAssemblyMs: 6,
    artifactSyncMs: 7,
    cleanupMs: 8,
    totalElapsedMs: 36
  };
}
