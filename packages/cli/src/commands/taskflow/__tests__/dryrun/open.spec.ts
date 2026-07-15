import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { runTaskflow } from '../../../taskflow.ts';
import { makeDualRepoOpenFixture, rootDir } from './fixtures.ts';

const res1 = await runTaskflow(['open', '--dry-run']) as any;
assert.equal(res1.ok, true);
assert.equal(res1.mode, 'dry-run');
assert.equal(res1.schemaId, 'atm.taskflowOpenResult.v1');
assert.equal(res1.writeEnabled, false);
assert.equal(res1.evidence.openerMode, 'template-only-fallback');
assert.equal(res1.evidence.delegationContract.hostOpenerAvailable, false);
assert.equal(res1.evidence.delegationContract.generationSurface, 'tasks-new');
assert.equal(res1.evidence.orchestrationPlan.wouldInvokeTasksNew, true);
assert.ok(res1.evidence.diagnostics.codes.includes('ATM_TASKFLOW_TEMPLATE_ONLY_FALLBACK'));
// TASK-CID-0073: writeReadinessHint surfaces fallback-mode prerequisites at top level
assert.equal(res1.writeReadinessHint.schemaId, 'atm.taskflowOpenWriteReadinessHint.v1', 'top-level writeReadinessHint must use atm.taskflowOpenWriteReadinessHint.v1 schemaId');
assert.equal(res1.writeReadinessHint.status, 'fallback', 'no-profile dry-run must report writeReadinessHint.status = fallback');
assert.equal(res1.writeReadinessHint.operatorLane, 'taskflow open');
assert.equal(res1.writeReadinessHint.fallbackSurface, 'tasks new (low-level generator)', 'fallback hint must label tasks new as low-level generator surface');
assert.ok(res1.writeReadinessHint.missingPrerequisites.length > 0, 'fallback hint must list at least one missing prerequisite');
assert.ok(res1.writeReadinessHint.summary.includes('fail closed'), 'fallback hint summary must explain that --write will fail closed');
assert.equal(res1.evidence.writeReadinessHint.status, 'fallback', 'writeReadinessHint must also appear inside evidence for backwards-compat consumers');

const validProfilePath = path.join(rootDir, 'fixtures/taskflow-profile/valid.profile.json');
const res2 = await runTaskflow(['open', '--dry-run', '--profile', validProfilePath]) as any;
assert.equal(res2.ok, true);
assert.equal(res2.mode, 'dry-run');
assert.equal(res2.evidence.profile.schemaId, 'taskflow.profile.v1');
assert.equal(res2.evidence.profile.id, 'adopter-profile-v1');
assert.equal(res2.evidence.openerMode, 'template-only-fallback');
assert.equal(res2.evidence.delegationContract.hostOpenerAvailable, true);
assert.equal(res2.evidence.delegationContract.describeOnly, true);
assert.equal(res2.evidence.delegationContract.openerPath, 'tools/task-card-opener.js');
assert.equal(res2.evidence.delegationContract.policy.allocateTaskId.mode, 'fallback');
assert.equal(res2.evidence.delegationContract.policy.rosterSyncPolicy, 'follow-up-command');
assert.equal(res2.evidence.orchestrationPlan.generationSurface, 'tasks-new');
assert.ok(res2.evidence.diagnostics.messages.some((entry: string) => entry.includes('describe-only')));

const governedProfilePath = path.join(rootDir, 'fixtures/taskflow-profile/governed-invocable.profile.json');
const res3 = await runTaskflow(['open', '--dry-run', '--profile', governedProfilePath]) as any;
assert.equal(res3.evidence.openerMode, 'delegated-governed');
assert.equal(res3.evidence.delegationContract.invocable, true);
assert.equal(res3.evidence.writeSupport.allowed, false);
// TASK-CID-0073: delegated-governed dry-run reports writeReadinessHint.status = ready
assert.equal(res3.writeReadinessHint.status, 'ready', 'delegated-governed dry-run must report writeReadinessHint.status = ready');
assert.equal(res3.writeReadinessHint.missingPrerequisites.length, 0, 'ready hint must not list any missing prerequisites');
assert.equal(res3.writeReadinessHint.nextCommand, 'node atm.mjs taskflow open --write --json');
assert.equal(res3.writeReadinessHint.fallbackSurface, null);
assert.equal(res3.evidence.hostPolicyDecision.taskId, 'TASK-GOVERNED-0001');
assert.equal(res3.evidence.hostPolicyDecision.outputPath, 'docs/tasks/TASK-GOVERNED-0001.task.md');
assert.equal(res3.evidence.orchestrationPlan.policyDecision.allocateTaskId.mode, 'host-opener');
assert.equal(res3.evidence.orchestrationPlan.policyDecision.resolveCanonicalOutputPath.mode, 'host-opener');
assert.equal(res3.evidence.orchestrationPlan.policyDecision.rosterSyncPolicy, 'follow-up-command');
assert.equal(res3.evidence.fallbackBehavior.mode, 'template-only-fallback');


const openFixture = await makeDualRepoOpenFixture();
const openWrite = await runTaskflow([
  'open',
  '--cwd', openFixture.targetRepo,
  '--profile', openFixture.profilePath,
  '--write',
  '--title', 'Dual repo open write fixture',
  '--json'
]) as any;
assert.equal(openWrite.ok, true);
assert.equal(openWrite.writeEnabled, true);
assert.equal(openWrite.evidence.openerMode, 'delegated-governed');
assert.equal(openWrite.evidence.hostPolicyDecision.taskId, 'TASK-OPEN-0001');
assert.equal(openWrite.evidence.hostPolicyDecision.outputPath, 'docs/tasks/TASK-OPEN-0001.task.md');
assert.ok(openWrite.evidence.runtimeImport, 'taskflow open write must import into target runtime');
assert.ok(
  readFileSync(path.join(openFixture.planningRepo, 'docs/tasks/TASK-OPEN-0001.task.md'), 'utf8').includes('TASK-OPEN-0001'),
  'taskflow open write must create the planning repo task card'
);
assert.ok(
  readFileSync(path.join(openFixture.targetRepo, '.atm/history/tasks/TASK-OPEN-0001.json'), 'utf8').includes('TASK-OPEN-0001'),
  'taskflow open write must import the task into the target runtime ledger'
);

await assert.rejects(
  () => runTaskflow(['open', '--write']),
  (err: any) => err.code === 'ATM_TASKFLOW_TEMPLATE_ONLY_FALLBACK'
);

const invalidProfilePath = path.join(rootDir, 'fixtures/taskflow-profile/invalid-missing-schema-id.profile.json');
await assert.rejects(
  () => runTaskflow(['open', '--dry-run', '--profile', invalidProfilePath]),
  (err: any) => err.code === 'ATM_TASKFLOW_PROFILE_INVALID_SCHEMA_ID'
);

console.log('[taskflow-dryrun:open] ok');
