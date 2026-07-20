import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  adoptOrphanBrokerTicket,
  cancelBrokerTicket,
  createBrokerTicketStore,
  enqueueBrokerTicket,
  reconcileBrokerTicketSideEffect,
  transitionStoredBrokerTicket
} from '../../packages/core/src/broker/ticket-store.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-ticket-recovery-'));
const store = createBrokerTicketStore(path.join(repo, '.atm/runtime/broker-ticket-store.json'));

try {
  const orphan = enqueueBrokerTicket(store, {
    taskId: 'TASK-ORPHAN',
    actorId: 'dead-agent',
    resourceKey: 'runner-sync',
    ttlSeconds: 1,
    idempotencyKey: 'orphan-enqueue',
    now: '2026-07-20T00:00:00.000Z'
  }).ticket!;
  const adopted = adoptOrphanBrokerTicket(store, {
    ticketId: orphan.ticketId,
    taskId: 'TASK-ORPHAN',
    actorId: 'live-agent',
    reason: 'owner heartbeat expired',
    idempotencyKey: 'adopt-orphan',
    now: '2026-07-20T00:00:02.000Z'
  });
  assert.equal(adopted.status, 'committed');
  assert.equal(adopted.ticket?.actorId, 'live-agent');
  assert.equal(adopted.ticket?.state, 'ready');

  const stale = enqueueBrokerTicket(store, {
    taskId: 'TASK-STALE',
    actorId: 'agent-stale',
    resourceKey: 'build',
    idempotencyKey: 'stale-enqueue',
    now: '2026-07-20T00:00:03.000Z'
  }).ticket!;
  const cancelled = cancelBrokerTicket(store, {
    ticketId: stale.ticketId,
    taskId: 'TASK-STALE',
    actorId: 'agent-stale',
    reason: 'stale queue entry no longer needed',
    idempotencyKey: 'cancel-stale',
    now: '2026-07-20T00:00:04.000Z'
  });
  assert.equal(cancelled.ticket?.state, 'cancelled');
  assert.equal(cancelled.ticket?.terminalReason, 'cancelled');

  const executing = enqueueBrokerTicket(store, {
    taskId: 'TASK-EFFECT',
    actorId: 'agent-effect',
    resourceKey: 'projection',
    idempotencyKey: 'effect-enqueue',
    now: '2026-07-20T00:00:05.000Z'
  }).ticket!;
  transitionStoredBrokerTicket(store, {
    ticketId: executing.ticketId,
    taskId: 'TASK-EFFECT',
    actorId: 'agent-effect',
    to: 'wakeup-pending',
    reason: 'selected',
    idempotencyKey: 'effect-wake',
    now: '2026-07-20T00:00:06.000Z'
  });
  transitionStoredBrokerTicket(store, {
    ticketId: executing.ticketId,
    taskId: 'TASK-EFFECT',
    actorId: 'agent-effect',
    to: 'executing',
    reason: 'side effect began',
    idempotencyKey: 'effect-exec',
    now: '2026-07-20T00:00:07.000Z'
  });
  assert.throws(() => cancelBrokerTicket(store, {
    ticketId: executing.ticketId,
    taskId: 'TASK-EFFECT',
    actorId: 'agent-effect',
    reason: 'cannot cancel executing side effect',
    idempotencyKey: 'effect-cancel',
    now: '2026-07-20T00:00:08.000Z'
  }), /ATM_BROKER_TICKET_CANCEL_REQUIRES_RECONCILE/);
  const reconciled = reconcileBrokerTicketSideEffect(store, {
    ticketId: executing.ticketId,
    taskId: 'TASK-EFFECT',
    actorId: 'agent-effect',
    reason: 'side effect outcome unknown after crash',
    idempotencyKey: 'effect-reconcile',
    now: '2026-07-20T00:00:09.000Z'
  });
  assert.equal(reconciled.ticket?.state, 'reconcile-required');
  assert.equal(reconciled.transitionEvidence?.action, 'reconcile-side-effect');

  console.log('[broker-ticket-crash-recovery.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
