import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  computeBuildInputsTreeHash,
  inspectBuildCache,
  planRunnerIncrementalBuild,
  writeBuildMetadataToReleaseManifests
} from '../../scripts/run-sealed-runner-build.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-sealed-build-cache-'));
execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });

for (const directory of [
  'packages/cli/src',
  'scripts',
  'templates/root-drop',
  'schemas',
  'atomic_workbench',
  'release/atm-root-drop',
  'release/atm-onefile'
]) {
  mkdirSync(path.join(repo, directory), { recursive: true });
}

writeFileSync(path.join(repo, 'packages/cli/src/index.ts'), 'export const cli = true;\n');
writeFileSync(path.join(repo, 'scripts/build.ts'), 'console.log("build");\n');
writeFileSync(path.join(repo, 'templates/root-drop/README.md'), '# template\n');
writeFileSync(path.join(repo, 'schemas/schema.json'), '{}\n');
writeFileSync(path.join(repo, 'atomic_workbench/map.json'), '{}\n');
writeFileSync(path.join(repo, 'package.json'), '{"name":"fixture"}\n');
writeFileSync(path.join(repo, 'package-lock.json'), '{"lockfileVersion":3}\n');
writeFileSync(path.join(repo, 'tsconfig.json'), '{}\n');
writeFileSync(path.join(repo, 'tsconfig.build.json'), '{}\n');
writeFileSync(path.join(repo, 'release/atm-root-drop/atm.mjs'), '// root launcher\n');
writeFileSync(path.join(repo, 'release/atm-onefile/atm.mjs'), '// onefile launcher\n');
writeManifest('release/atm-root-drop/release-manifest.json', {});
writeManifest('release/atm-onefile/release-manifest.json', {});
execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repo, stdio: 'ignore' });

const firstHash = computeBuildInputsTreeHash(repo);
assert.match(firstHash, /^sha256:[a-f0-9]{64}$/);

writeBuildMetadataToReleaseManifests({
  cwd: repo,
  sealedSourceSha: 'abc123',
  buildInputsTreeHash: firstHash,
  buildDecision: 'fullRebuild',
  timings: {
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
  }
});
execFileSync('git', ['add', 'release'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'manifest metadata'], { cwd: repo, stdio: 'ignore' });
const sealedBaselineSha = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();

assert.equal(inspectBuildCache({
  cwd: repo,
  buildTarget: 'full',
  buildInputsTreeHash: firstHash
}).decision, 'cacheHitSkip');

writeFileSync(path.join(repo, 'release/atm-onefile/atm.mjs'), '// dirty launcher\n');
assert.equal(inspectBuildCache({
  cwd: repo,
  buildTarget: 'full',
  buildInputsTreeHash: firstHash
}).decision, 'fullRebuild');
execFileSync('git', ['checkout', '--', 'release/atm-onefile/atm.mjs'], { cwd: repo, stdio: 'ignore' });

writeFileSync(path.join(repo, 'packages/cli/src/index.ts'), 'export const cli = "changed";\n');
execFileSync('git', ['add', 'packages/cli/src/index.ts'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'package source change'], { cwd: repo, stdio: 'ignore' });
const packageChangeSha = execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const packagePlan = planRunnerIncrementalBuild({
  cwd: repo,
  previousSealedSourceSha: sealedBaselineSha,
  currentSealedSourceSha: packageChangeSha
});
assert.equal(packagePlan.incrementalEligible, true);
assert.deepEqual(packagePlan.affectedPackages, ['packages/cli']);
assert.deepEqual(packagePlan.unsafeReasons, []);

writeFileSync(path.join(repo, 'scripts/build.ts'), 'console.log("changed");\n');
execFileSync('git', ['add', 'scripts/build.ts'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['commit', '-m', 'source change'], { cwd: repo, stdio: 'ignore' });
const secondHash = computeBuildInputsTreeHash(repo);
assert.notEqual(secondHash, firstHash);
assert.equal(inspectBuildCache({
  cwd: repo,
  buildTarget: 'full',
  buildInputsTreeHash: secondHash
}).decision, 'fullRebuild');

const manifest = JSON.parse(readFileSync(path.join(repo, 'release/atm-root-drop/release-manifest.json'), 'utf8'));
assert.equal(manifest.buildInputsTreeHash, firstHash);
assert.equal(manifest.sealedSourceCommit, 'abc123');
assert.equal(manifest.buildDecision, 'fullRebuild');
assert.equal(manifest.phaseTimingsMs.rootDropReleaseAssembly, 5);

const unsafePlan = planRunnerIncrementalBuild({
  cwd: repo,
  previousSealedSourceSha: packageChangeSha,
  currentSealedSourceSha: execFileSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim()
});
assert.equal(unsafePlan.incrementalEligible, false);
assert.ok(unsafePlan.unsafeReasons.includes('build-script-change'));

console.log('[sealed-runner-build-input-cache.test] ok');

function writeManifest(relativePath: string, extra: Record<string, unknown>) {
  writeFileSync(path.join(repo, relativePath), `${JSON.stringify({
    schemaVersion: 'fixture',
    generatedAt: '1970-01-01T00:00:00.000Z',
    ...extra
  }, null, 2)}\n`);
}
