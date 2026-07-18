import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  emptyRunnerSyncStewardQueue,
  enqueueRunnerSyncStewardRequest
} from '../../packages/core/src/broker/runner-sync-steward-queue.ts';
import {
  emptyGeneratedProjectionSteward,
  enqueueGeneratedProjectionRebuild
} from '../../packages/core/src/broker/generated-projection-steward.ts';
import { inspectRunnerSyncAdmission } from '../../packages/cli/src/commands/framework-development/runner-sync-admission.ts';
import {
  appendLaneSessionEvent,
  listLaneSessionEvents
} from '../../packages/cli/src/commands/lane-session/events.ts';

const t0 = '2026-07-18T00:00:00.000Z';

function testRunnerSyncTicketEnvelope() {
  let queue = emptyRunnerSyncStewardQueue(t0);
  queue = enqueueRunnerSyncStewardRequest(queue, {
    taskId: 'TASK-A',
    actorId: 'agent-a',
    sealedSourceSha: 'sha-a',
    requestedSurfaces: ['release/atm-onefile/atm.mjs'],
    createdAt: t0,
    heartbeatAt: t0
  }).queue;
  const waiting = enqueueRunnerSyncStewardRequest(queue, {
    taskId: 'TASK-B',
    actorId: 'agent-b',
    sealedSourceSha: 'sha-b',
    requestedSurfaces: ['release/atm-root-drop'],
    createdAt: '2026-07-18T00:00:02.000Z',
    heartbeatAt: '2026-07-18T00:00:05.000Z'
  });

  assert.equal(waiting.status, 'waiting-different-source');
  assert.equal(waiting.brokerTicket.schemaId, 'atm.brokerTicket.v1');
  assert.equal(waiting.brokerTicket.position, 2);
  assert.equal(waiting.brokerTicket.headOwner, 'TASK-B');
  assert.equal(waiting.brokerTicket.sharedSurface, 'runner-sync');
  assert.deepEqual(waiting.brokerTicket.scopeClass, ['code']);
  assert.equal(waiting.brokerTicket.waitedMs, 3000);
}

function testProjectionTicketEnvelope() {
  const result = enqueueGeneratedProjectionRebuild(emptyGeneratedProjectionSteward(t0), {
    taskId: 'TASK-PROJ',
    actorId: 'agent-p',
    projectionKey: 'atm.generated-projection.governance-backlog',
    sourceItemPaths: ['docs/governance/atm-bug-and-optimization-backlog.items/ATM-BUG.json'],
    createdAt: t0,
    heartbeatAt: '2026-07-18T00:00:03.000Z'
  });

  assert.equal(result.brokerTicket.schemaId, 'atm.brokerTicket.v1');
  assert.equal(result.brokerTicket.ticketId, 'projection:atm.generated-projection.governance-backlog:TASK-PROJ');
  assert.equal(result.brokerTicket.position, 1);
  assert.equal(result.brokerTicket.headOwner, 'TASK-PROJ');
  assert.equal(result.brokerTicket.waitedMs, 3000);
}

function testRunnerSyncAdmissionTicketOnMissingQueueHead() {
  const report = inspectRunnerSyncAdmission({
    cwd: process.cwd(),
    stewardActorId: 'agent-build',
    sealedSourceSha: 'sha-missing',
    dirtyFiles: [],
    foreignClaims: []
  });

  assert.equal(report.ok, false);
  assert.equal(report.brokerTicket?.schemaId, 'atm.brokerTicket.v1');
  assert.equal(report.brokerTicket?.position, 0);
  assert.equal(report.brokerTicket?.sharedSurface, 'runner-sync');
}

function testLaneSessionTicketEvent() {
  const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-tier2-ticket-events-'));
  const brokerTicket = {
    schemaId: 'atm.brokerTicket.v1',
    ticketId: 'ticket-fixture',
    position: 2,
    headOwner: 'TASK-A',
    headHealth: 'task-active',
    batchEligible: false,
    enqueuedAt: t0,
    waitedMs: 0,
    sharedSurface: 'runner-sync',
    scopeClass: ['code']
  };
  appendLaneSessionEvent({
    cwd: repo,
    laneId: 'lane-fixture',
    action: 'broker-ticket-enqueued',
    actorId: 'agent-b',
    details: { brokerTicket }
  });
  const events = listLaneSessionEvents(repo, 'lane-fixture');
  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'broker-ticket-enqueued');
  assert.deepEqual(events[0].details.brokerTicket, brokerTicket);
}

testRunnerSyncTicketEnvelope();
testProjectionTicketEnvelope();
testRunnerSyncAdmissionTicketOnMissingQueueHead();
testLaneSessionTicketEvent();

console.log('[tier2-broker-ticket-exit.test] ok');
