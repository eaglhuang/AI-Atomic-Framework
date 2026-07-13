import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  collectTrackedReleaseArtifactPaths,
  describeBuildReleaseHygienePolicy,
  restoreTrackedReleaseArtifacts,
  shouldRetainReleaseArtifacts
} from '../../scripts/build-release-hygiene.ts';

const previousRetain = process.env.ATM_RETAIN_RELEASE_ARTIFACTS;
try {
  delete process.env.ATM_RETAIN_RELEASE_ARTIFACTS;
  assert.equal(shouldRetainReleaseArtifacts(), false);

  process.env.ATM_RETAIN_RELEASE_ARTIFACTS = '1';
  assert.equal(shouldRetainReleaseArtifacts(), true);

  const policy = describeBuildReleaseHygienePolicy();
  assert.equal(policy.retainEnvVar, 'ATM_RETAIN_RELEASE_ARTIFACTS');
  assert.equal(policy.defaultBehavior, 'restore-tracked-release-outputs');
  assert.match(policy.validationSafeCommand, /build:packages/);
  assert.match(policy.runnerSyncCommand, /ATM_RETAIN_RELEASE_ARTIFACTS=1/);

  const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-release-hygiene-'));
  try {
    execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['config', 'user.name', 'ATM Test'], { cwd: repo, stdio: 'ignore' });

    const generatedPath = path.join(repo, 'release', 'atm-root-drop', 'packages', 'cli', 'dist', 'atm.js');
    const trackedMirrorPath = path.join(repo, 'release', 'atm-root-drop', 'packages', 'cli', 'src', 'commands', 'next.ts');
    const manifestPath = path.join(repo, 'release', 'atm-root-drop', 'release-manifest.json');
    mkdirSync(path.dirname(generatedPath), { recursive: true });
    mkdirSync(path.dirname(trackedMirrorPath), { recursive: true });
    writeFileSync(generatedPath, 'clean\n', 'utf8');
    writeFileSync(trackedMirrorPath, 'tracked mirror clean\n', 'utf8');
    writeFileSync(manifestPath, JSON.stringify({
      generatedFiles: [
        'release/atm-root-drop/packages/cli/dist/atm.js',
        '../outside.txt',
        'release/atm-root-drop/../outside.txt',
        'release/atm-onefile/atm.mjs'
      ]
    }, null, 2), 'utf8');
    execFileSync('git', ['add', '.'], { cwd: repo, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'fixture'], { cwd: repo, stdio: 'ignore' });

    writeFileSync(generatedPath, 'dirty\n', 'utf8');
    writeFileSync(trackedMirrorPath, 'tracked mirror dirty\n', 'utf8');
    const collected = collectTrackedReleaseArtifactPaths(repo);
    assert.ok(collected.includes('release/atm-root-drop/packages/cli/dist/atm.js'));
    assert.ok(collected.includes('release/atm-root-drop/packages/cli/src/commands/next.ts'));
    assert.ok(!collected.includes('../outside.txt'));
    assert.ok(!collected.includes('release/atm-root-drop/../outside.txt'));

    const restored = restoreTrackedReleaseArtifacts(repo);
    assert.ok(restored.includes('release/atm-root-drop/packages/cli/dist/atm.js'));
    assert.ok(restored.includes('release/atm-root-drop/packages/cli/src/commands/next.ts'));
    assert.equal(readFileSync(generatedPath, 'utf8').replaceAll('\r\n', '\n'), 'clean\n');
    assert.equal(readFileSync(trackedMirrorPath, 'utf8').replaceAll('\r\n', '\n'), 'tracked mirror clean\n');
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }

  console.log('build-release-hygiene.test: ok');
} finally {
  if (previousRetain === undefined) {
    delete process.env.ATM_RETAIN_RELEASE_ARTIFACTS;
  } else {
    process.env.ATM_RETAIN_RELEASE_ARTIFACTS = previousRetain;
  }
}
