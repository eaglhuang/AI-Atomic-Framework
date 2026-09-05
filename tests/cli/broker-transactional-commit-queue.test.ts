import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  createBrokerTicketStore,
  enqueueBrokerTicket,
  readBrokerTicketStoreSnapshot,
  transitionStoredBrokerTicket,
  wakeNextBrokerTicket
} from '../../packages/core/src/broker/ticket-store.ts';

// test_broker_transactional_commit_queue_6d2a9f41
// The broker owns one durable queue: CAS rejection and idempotent replay must
// be explicit, and waking a successor must be single-flight and FIFO.
const root = mkdtempSync(path.join(os.tmpdir(), 'atm-broker-transactional-queue-'));
const storePath = path.join(root, 'broker-tickets.json');
const store = createBrokerTicketStore(storePath);
const actor = 'queue-test-actor';
const resourceKey = 'git-index';

try {
  const first = enqueueBrokerTicket(store, {
    taskId: 'TASK-QUEUE-A', actorId: actor, resourceKey, idempotencyKey: 'enqueue-a',
    now: '2026-09-05T10:00:00.000Z'
  });
  const second = enqueueBrokerTicket(store, {
    taskId: 'TASK-QUEUE-B', actorId: actor, resourceKey, idempotencyKey: 'enqueue-b',
    now: '2026-09-05T10:00:01.000Z'
  });
  assert.equal(first.status, 'committed');
  assert.equal(second.status, 'committed');
  assert.equal(first.ticket?.state, 'queued');
  assert.equal(second.ticket?.state, 'queued');

  const stale = readBrokerTicketStoreSnapshot(storePath);
  const wake = wakeNextBrokerTicket(store, {
    taskId: 'TASK-QUEUE-A', actorId: actor, resourceKey,
    idempotencyKey: 'wake-a', now: '2026-09-05T10:00:02.000Z'
  });
  assert.equal(wake.ticket?.taskId, 'TASK-QUEUE-A');
  assert.equal(wake.ticket?.state, 'wakeup-pending');

  const staleCommit = store.commit({
    base: stale,
    action: 'transition',
    taskId: 'TASK-QUEUE-B',
    actorId: actor,
    laneId: null,
    idempotencyKey: 'stale-transition',
    now: '2026-09-05T10:00:03.000Z',
    mutate: (document) => ({ document })
  });
  assert.equal(staleCommit.status, 'revalidation-required');
  assert.match(staleCommit.recoveryCommand ?? '', /Refresh.*snapshot.*retry/i);

  const executing = transitionStoredBrokerTicket(store, {
    ticketId: wake.ticket!.ticketId,
    to: 'executing',
    taskId: 'TASK-QUEUE-A', actorId: actor,
    reason: 'single-flight execution', idempotencyKey: 'execute-a',
    now: '2026-09-05T10:00:04.000Z'
  });
  const released = transitionStoredBrokerTicket(store, {
    ticketId: executing.ticket!.ticketId,
    to: 'released',
    taskId: 'TASK-QUEUE-A', actorId: actor,
    reason: 'commit delivered', idempotencyKey: 'release-a',
    now: '2026-09-05T10:00:05.000Z'
  });
  assert.equal(released.ticket?.state, 'released');

  const replay = transitionStoredBrokerTicket(store, {
    ticketId: executing.ticket!.ticketId,
    to: 'released',
    taskId: 'TASK-QUEUE-A', actorId: actor,
    reason: 'commit delivered', idempotencyKey: 'release-a',
    now: '2026-09-05T10:00:06.000Z'
  });
  assert.equal(replay.status, 'idempotent-replay');

  const successor = wakeNextBrokerTicket(store, {
    taskId: 'TASK-QUEUE-B', actorId: actor, resourceKey,
    idempotencyKey: 'wake-b', now: '2026-09-05T10:00:07.000Z'
  });
  assert.equal(successor.ticket?.taskId, 'TASK-QUEUE-B');
  assert.equal(successor.ticket?.state, 'wakeup-pending');
  const final = readBrokerTicketStoreSnapshot(storePath);
  assert.equal(final.document.tickets.filter((ticket) => ticket.state === 'wakeup-pending').length, 1);
  assert.equal(final.document.transitions.length, 6);
  console.log('[broker-transactional-commit-queue.test] ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
