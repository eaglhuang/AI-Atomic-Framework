import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { runBroker } from '../../../packages/cli/src/commands/broker.ts';
import { runTeam } from '../../../packages/cli/src/commands/team.ts';
import { evaluateBrokerQueueAdmission } from '../../../packages/cli/src/commands/next/broker-queue-admission.ts';
import { composeBrokerProposals } from '../../../packages/core/src/broker/compose.ts';
import { createTempWorkspace } from '../../temp-root.ts';

export async function runBrokerSharedSurfaceValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase === 'broker-shared-surface-queue') {
    const cwd = createTempWorkspace('atm-broker-shared-queue-');
    mkdirSync(path.join(cwd, '.atm', 'runtime'), { recursive: true });
    const firstIntentPath = path.join(cwd, 'first.intent.json');
    const secondIntentPath = path.join(cwd, 'second.intent.json');
    const makeIntent = (taskId: string, actorId: string, atomId: string, atomCid: string, baseCommit = 'same-base') => ({
      schemaId: 'atm.writeIntent.v1', specVersion: '0.1.0', migration: { strategy: 'none', fromVersion: null, notes: 'shared queue fixture' },
      taskId, actorId, baseCommit, targetFiles: ['docs/governance/atm-bug-and-optimization-backlog.md', `src/${taskId}.ts`],
      atomRefs: [{ atomId, atomCid, operation: 'modify', sourceRange: { filePath: 'docs/governance/atm-bug-and-optimization-backlog.md', lineStart: 10, lineEnd: 12 } }],
      sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: [] }, requestedLane: 'auto'
    });
    writeFileSync(firstIntentPath, `${JSON.stringify(makeIntent('TASK-QUEUE-ONE', 'agent-one', 'atom-one', 'cid-one'), null, 2)}\n`, 'utf8');
    writeFileSync(secondIntentPath, `${JSON.stringify(makeIntent('TASK-QUEUE-TWO', 'agent-two', 'atom-two', 'cid-two'), null, 2)}\n`, 'utf8');
    const first = await runBroker(['register', '--cwd', cwd, '--task', 'TASK-QUEUE-ONE', '--actor', 'agent-one', '--intent-file', firstIntentPath]);
    assert.equal(first.ok, true);
    const second = await runBroker(['register', '--cwd', cwd, '--task', 'TASK-QUEUE-TWO', '--actor', 'agent-two', '--intent-file', secondIntentPath]);
    assert.equal(second.ok, true, 'shared path must preserve private-path progress instead of globally blocking the task');
    const status = await runBroker(['status', '--cwd', cwd]);
    const queues = (status.evidence as { sharedSurfaceQueues?: Array<{ surfacePath: string; entries: Array<{ taskId: string }> }> }).sharedSurfaceQueues ?? [];
    assert.equal(queues.length, 1);
    assert.deepEqual(queues[0]?.entries.map((entry) => entry.taskId), ['TASK-QUEUE-ONE', 'TASK-QUEUE-TWO']);
    const teamStatus = await runTeam(['status', '--cwd', cwd]);
    assert.equal(((teamStatus.evidence as { sharedSurfaceQueues?: unknown[] }).sharedSurfaceQueues ?? []).length, 1);
    await runBroker(['release', '--cwd', cwd, '--task', 'TASK-QUEUE-ONE']);
    const afterRelease = await runBroker(['status', '--cwd', cwd]);
    const afterQueues = (afterRelease.evidence as { sharedSurfaceQueues?: Array<{ entries: Array<{ taskId: string }> }> }).sharedSurfaceQueues ?? [];
    assert.deepEqual(afterQueues[0]?.entries.map((entry) => entry.taskId), ['TASK-QUEUE-TWO']);
    rmSync(cwd, { recursive: true, force: true });
    console.log('[validate-team-agents] ok (broker-shared-surface-queue)');
    return true;
  }

  if (taskCase === 'next-claim-shared-surface-queue') {
    const cwd = createTempWorkspace('atm-next-queue-admission-');
    const runtime = path.join(cwd, '.atm', 'runtime');
    mkdirSync(runtime, { recursive: true });
    writeFileSync(path.join(runtime, 'broker-shared-surface-queues.json'), `${JSON.stringify({
      schemaId: 'atm.brokerSharedSurfaceQueues.v1',
      queues: [
        { schemaId: 'atm.brokerSharedSurfaceQueue.v1', surfacePath: 'docs/governance/atm-bug-and-optimization-backlog.md', entries: [
          { taskId: 'TASK-OWNER', actorId: 'owner', surfacePath: 'docs/governance/atm-bug-and-optimization-backlog.md', leaseEpoch: 1, baseHash: 'same', reason: 'shared', releaseCondition: 'owner release', queuedAt: '2026-07-12T00:00:00.000Z' },
          { taskId: 'TASK-WAITER', actorId: 'waiter', surfacePath: 'docs/governance/atm-bug-and-optimization-backlog.md', leaseEpoch: 2, baseHash: 'same', reason: 'shared', releaseCondition: 'owner release', queuedAt: '2026-07-12T00:01:00.000Z' }
        ] },
        { schemaId: 'atm.brokerSharedSurfaceQueue.v1', surfacePath: 'atomic_workbench/atomization-coverage/path-to-atom-map.json', entries: [
          { taskId: 'TASK-OWNER', actorId: 'owner', surfacePath: 'atomic_workbench/atomization-coverage/path-to-atom-map.json', leaseEpoch: 1, baseHash: 'same', reason: 'shared', releaseCondition: 'owner release', queuedAt: '2026-07-12T00:00:00.000Z' },
          { taskId: 'TASK-WAITER', actorId: 'waiter', surfacePath: 'atomic_workbench/atomization-coverage/path-to-atom-map.json', leaseEpoch: 2, baseHash: 'same', reason: 'shared', releaseCondition: 'owner release', queuedAt: '2026-07-12T00:01:00.000Z' }
        ] }
      ]
    }, null, 2)}\n`, 'utf8');
    const privateWork = evaluateBrokerQueueAdmission({ cwd, taskId: 'TASK-WAITER', allowedFiles: ['docs/governance/atm-bug-and-optimization-backlog.md', 'atomic_workbench/atomization-coverage/path-to-atom-map.json', 'packages/cli/src/commands/next.ts'], overlappingFiles: ['docs/governance/atm-bug-and-optimization-backlog.md', 'atomic_workbench/atomization-coverage/path-to-atom-map.json'] });
    assert.equal(privateWork.status, 'queued-private-work');
    assert.deepEqual(privateWork.allowedFiles, ['packages/cli/src/commands/next.ts']);
    assert.equal(privateWork.waitingOn.length, 2);
    const blocked = evaluateBrokerQueueAdmission({ cwd, taskId: 'TASK-WAITER', allowedFiles: ['docs/governance/atm-bug-and-optimization-backlog.md'], overlappingFiles: ['docs/governance/atm-bug-and-optimization-backlog.md'] });
    assert.equal(blocked.status, 'queued-blocked');
    rmSync(cwd, { recursive: true, force: true });
    console.log('[validate-team-agents] ok (next-claim-shared-surface-queue)');
    return true;
  }

  if (taskCase === 'broker-shared-surface-compose') {
    const base = {
      schemaId: 'atm.patchProposal.v1' as const, specVersion: '0.1.0' as const, migration: { strategy: 'none' as const, fromVersion: null, notes: 'shared compose fixture' },
      taskId: 'TASK-COMPOSE', actorId: 'steward-fixture', baseCommit: 'base-1', fileBeforeHash: 'sha256:file-1', targetFile: 'docs/governance/atm-bug-and-optimization-backlog.md',
      validators: ['npm run typecheck'], rollback: 'revert fixture'
    };
    const first = { ...base, proposalId: 'proposal-one', atomRefs: [{ atomId: 'atom-one', atomCid: 'cid-one' }], anchors: [{ kind: 'line', hint: 'row-one' }], intent: 'bounded first row', patch: '@@ -1,1 +1,1 @@\n-one\n+one-a\n' };
    const second = { ...base, proposalId: 'proposal-two', atomRefs: [{ atomId: 'atom-two', atomCid: 'cid-two' }], anchors: [{ kind: 'line', hint: 'row-two' }], intent: 'bounded second row', patch: '@@ -4,1 +4,1 @@\n-two\n+two-b\n' };
    const compatible = composeBrokerProposals([second, first]);
    assert.equal(compatible.ok, true);
    assert.equal(compatible.mergePlan.verdict, 'parallel-safe');
    assert.deepEqual(compatible.mergePlan.inputProposals, ['proposal-one', 'proposal-two']);
    const semanticConflict = composeBrokerProposals([{ ...first, proposalId: 'proposal-three', atomRefs: [{ atomId: 'atom-three', atomCid: 'cid-three' }], anchors: [{ kind: 'markdown-heading', hint: 'same-row' }] }, { ...second, proposalId: 'proposal-four', atomRefs: [{ atomId: 'atom-four', atomCid: 'cid-four' }], anchors: [{ kind: 'markdown-heading', hint: 'same-row' }] }]);
    assert.equal(semanticConflict.mergePlan.verdict, 'needs-steward', 'Semantic Markdown anchors must never be auto-applied.');
    console.log('[validate-team-agents] ok (broker-shared-surface-compose)');
    return true;
  }

  return false;
}
