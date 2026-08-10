import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};

for (const scriptName of ['build', 'build:packages', 'build:root-drop-release', 'build:onefile-release']) {
  assert.ok(
    packageJson.scripts[scriptName]?.startsWith('node --strip-types scripts/run-sealed-runner-build.ts '),
    `${scriptName} must route through sealed-SHA runner sync build steward before generating runner artifacts`
  );
}

const source = readFileSync('scripts/run-sealed-runner-build.ts', 'utf8');
const candidateBuild = source.indexOf('runTimedInnerBuild(worktreeRoot');
const publicationAdmission = source.indexOf('const publication = resolveSealedRunnerPublication({', candidateBuild);
const publicationSync = source.indexOf('syncGeneratedArtifacts(worktreeRoot, repoRoot', publicationAdmission);

assert.ok(candidateBuild >= 0, 'sealed runner build must still construct its candidate in the detached worktree');
assert.ok(publicationAdmission > candidateBuild, 'runner-sync admission must occur after isolated candidate construction, never before the long build');
assert.ok(publicationSync > publicationAdmission, 'canonical artifact sync must occur only after queue-head publication admission succeeds');
assert.match(source, /The detached worktree build is intentionally queue-free/);

console.log('[runner-sync-build-script-admission] ok');
