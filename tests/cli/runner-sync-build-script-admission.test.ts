import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

const gateRun = spawnSync(process.execPath, ['--strip-types', 'scripts/run-sealed-runner-build.ts', 'packages'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    ATM_ACTOR_ID: 'runner-sync-build-script-test'
  }
});

assert.notEqual(gateRun.status, 0, 'build admission must fail without queue-head ownership');
assert.match(gateRun.stderr, /ATM_RUNNER_SYNC_QUEUE_HEAD_REQUIRED|ATM_RUNNER_SYNC_FOREIGN_WIP_BLOCKED/);
assert.match(gateRun.stderr, /runner-sync queue-head reservation|foreign non-release WIP|broker runner-sync enqueue/);

console.log('[runner-sync-build-script-admission] ok');
