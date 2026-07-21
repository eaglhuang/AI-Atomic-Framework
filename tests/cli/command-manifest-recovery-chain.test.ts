import assert from 'node:assert/strict';
import { buildCommandManifest, renderCommandManifest } from '../../packages/cli/src/commands/shared/command-manifest.ts';
import { buildRunnerSyncRecoveryManifests } from '../../packages/cli/src/commands/framework-development/runner-sync-admission.ts';

const manifest = buildCommandManifest({
  executable: process.execPath,
  argv: ['-e', 'console.log("ok")'],
  cwd: '.',
  env: { ATM_ACTOR_ID: 'actor.one', ATM_RETAIN_RELEASE_ARTIFACTS: '1' },
  envRefs: ['PATH'],
  timeoutMs: 30000
});

assert.equal(manifest.schemaId, 'atm.commandManifest.v1');
assert.equal('shell' in manifest, false);
assert.equal('command' in manifest, false);
assert.deepEqual(manifest.argv, ['-e', 'console.log("ok")']);
assert.match(manifest.ioDigest ?? '', /^sha256:[a-f0-9]{64}$/);
assert.match(renderCommandManifest(manifest), /ATM_ACTOR_ID=actor\.one/);

const chain = buildRunnerSyncRecoveryManifests({
  stewardActorId: 'actor with space',
  sealedSourceSha: '2'.repeat(40)
});
assert.deepEqual(chain.map((entry) => entry.id), [
  'framework-temp-claim',
  'runner-sync-enqueue',
  'runner-sync-build'
]);
for (const step of chain) {
  assert.equal(step.manifest.schemaId, 'atm.commandManifest.v1');
  assert.equal('shell' in step.manifest, false);
  assert.equal('command' in step.manifest, false);
  assert.equal(step.display.includes('&&'), false);
}

console.log('[command-manifest-recovery-chain.test] ok');
