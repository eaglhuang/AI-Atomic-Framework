import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};
const gate = 'node --strip-types scripts/assert-runner-sync-admission.ts && ';

for (const scriptName of ['build', 'build:packages', 'build:root-drop-release', 'build:onefile-release']) {
  assert.ok(
    packageJson.scripts[scriptName]?.startsWith(gate),
    `${scriptName} must fail closed through runner-sync admission before generating runner artifacts`
  );
}

const gateRun = spawnSync(process.execPath, ['--strip-types', 'scripts/assert-runner-sync-admission.ts'], {
  cwd: process.cwd(),
  encoding: 'utf8',
  env: {
    ...process.env,
    ATM_ACTOR_ID: 'runner-sync-build-script-test'
  }
});

assert.notEqual(gateRun.status, 0, 'build admission must fail without queue-head ownership');
assert.match(gateRun.stderr, /ATM_RUNNER_SYNC_QUEUE_HEAD_REQUIRED|ATM_RUNNER_SYNC_FOREIGN_WIP_BLOCKED/);
assert.match(gateRun.stderr, /broker runner-sync enqueue/);

console.log('[runner-sync-build-script-admission] ok');
