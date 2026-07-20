import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createBrokerTicketStore,
  enqueueBrokerTicket,
  transitionStoredBrokerTicket,
  wakeNextBrokerTicket
} from '../../packages/core/src/broker/ticket-store.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-ticket-fairness-'));
const store = createBrokerTicketStore(path.join(repo, '.atm/runtime/broker-ticket-store.json'));

try {
  const old = enqueueBrokerTicket(store, {
    taskId: 'TASK-OLD',
    actorId: 'agent-old',
    resourceKey: 'commit:shared',
    idempotencyKey: 'old',
    now: '2026-07-20T00:00:00.000Z'
  }).ticket!;
  const young = enqueueBrokerTicket(store, {
    taskId: 'TASK-YOUNG',
    actorId: 'agent-young',
    resourceKey: 'commit:shared',
    idempotencyKey: 'young',
    now: '2026-07-20T00:00:10.000Z'
  }).ticket!;

  const firstWake = wakeNextBrokerTicket(store, {
    resourceKey: 'commit:shared',
    taskId: 'TASK-OLD',
    actorId: 'scheduler',
    idempotencyKey: 'wake-1',
    now: '2026-07-20T00:02:01.000Z',
    maxEligibleWaitMs: 120000
  });
  assert.equal(firstWake.ticket?.ticketId, old.ticketId);
  assert.equal(firstWake.ticket?.state, 'wakeup-pending');

  const duplicateWake = wakeNextBrokerTicket(store, {
    resourceKey: 'commit:shared',
    taskId: 'TASK-YOUNG',
    actorId: 'scheduler',
    idempotencyKey: 'wake-2',
    now: '2026-07-20T00:02:02.000Z'
  });
  assert.equal(duplicateWake.ticket?.ticketId, old.ticketId, 'single-flight keeps one wakeup owner');
  assert.equal(store.read().document.tickets.filter((ticket) => ticket.state === 'wakeup-pending').length, 1);

  transitionStoredBrokerTicket(store, {
    ticketId: old.ticketId,
    taskId: 'TASK-OLD',
    actorId: 'agent-old',
    to: 'executing',
    reason: 'old executes',
    idempotencyKey: 'old-exec',
    now: '2026-07-20T00:02:03.000Z'
  });
  transitionStoredBrokerTicket(store, {
    ticketId: old.ticketId,
    taskId: 'TASK-OLD',
    actorId: 'agent-old',
    to: 'released',
    reason: 'old done',
    idempotencyKey: 'old-release',
    now: '2026-07-20T00:02:04.000Z'
  });
  const secondWake = wakeNextBrokerTicket(store, {
    resourceKey: 'commit:shared',
    taskId: 'TASK-YOUNG',
    actorId: 'scheduler',
    idempotencyKey: 'wake-3',
    now: '2026-07-20T00:02:05.000Z'
  });
  assert.equal(secondWake.ticket?.ticketId, young.ticketId);
  assert.equal(secondWake.ticket?.state, 'wakeup-pending');
  assert.equal(secondWake.ticket?.bypassCount, 1);

  console.log('[broker-ticket-fairness.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
