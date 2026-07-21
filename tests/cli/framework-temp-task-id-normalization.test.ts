import assert from 'node:assert/strict';
import { mintFrameworkTempTaskId, normalizeIdentitySegment } from '../../packages/cli/src/commands/shared/identity-normalization.ts';
import { buildRunnerSyncRecoveryManifests } from '../../packages/cli/src/commands/framework-development/runner-sync-admission.ts';

const fixtures = [
  ['captain.with/special:id', 'captain-with-special-id'],
  ['captain with spaces', 'captain-with-spaces'],
  ['隊長.captain 01', 'captain-01'],
  ['---dotted.actor---', 'dotted-actor']
] as const;

for (const [actor, normalized] of fixtures) {
  assert.equal(normalizeIdentitySegment(actor), normalized);
  assert.equal(mintFrameworkTempTaskId(actor), `ATM-FRAMEWORK-TEMP-${normalized}`);
  const enqueue = buildRunnerSyncRecoveryManifests({
    stewardActorId: actor,
    sealedSourceSha: '1'.repeat(40)
  }).find((entry) => entry.id === 'runner-sync-enqueue');
  assert.ok(enqueue);
  assert.deepEqual(
    enqueue.manifest.argv.slice(enqueue.manifest.argv.indexOf('--task') + 1, enqueue.manifest.argv.indexOf('--task') + 2),
    [`ATM-FRAMEWORK-TEMP-${normalized}`]
  );
  assert.equal(enqueue.display.includes('&&'), false);
}

console.log('[framework-temp-task-id-normalization.test] ok');
