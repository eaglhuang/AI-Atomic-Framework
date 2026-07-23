import assert from 'node:assert/strict';
import { buildCommandManifest, renderCommandManifest } from '../../packages/cli/src/commands/shared/command-manifest.ts';
import { buildRunnerSyncRecoveryManifests } from '../../packages/cli/src/commands/framework-development/runner-sync-admission.ts';
import { resolveSharedWriteActorAuthority } from '../../packages/cli/src/commands/shared/identity-normalization.ts';

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
  sealedSourceSha: '2'.repeat(40),
  laneSessionId: 'lane-recovery-fixture',
  actorAuthority: resolveSharedWriteActorAuthority({
    explicitActorId: 'actor with space',
    envActorId: 'actor with space',
    legacyEnvActorId: 'stale.legacy',
    laneSessionId: 'lane-recovery-fixture',
    buildCommand: 'npm run build'
  })
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
  assert.ok(step.actorAuthority);
  assert.equal(step.actorAuthority?.actorId, 'actor with space');
  assert.equal(step.actorAuthority?.laneSessionId, 'lane-recovery-fixture');
  assert.equal(step.actorAuthority?.copyableCommand, step.display);
  assert.ok(step.actorAuthority?.resolutionSource);
}

const buildStep = chain.find((entry) => entry.id === 'runner-sync-build');
assert.equal(buildStep?.manifest.env?.ATM_ACTOR_ID, 'actor with space');
assert.doesNotMatch(buildStep?.display ?? '', /AGENT_IDENTITY/);

console.log('[command-manifest-recovery-chain.test] ok');
