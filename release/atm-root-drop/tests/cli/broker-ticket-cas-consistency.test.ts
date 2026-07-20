import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createBrokerTicketStore,
  enqueueBrokerTicket,
  transitionStoredBrokerTicket
} from '../../packages/core/src/broker/ticket-store.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-ticket-cas-'));
const storePath = path.join(repo, '.atm/runtime/broker-ticket-store.json');

try {
  const store = createBrokerTicketStore(storePath);
  const first = enqueueBrokerTicket(store, {
    taskId: 'TASK-A',
    actorId: 'agent-a',
    resourceKey: 'commit:core',
    idempotencyKey: 'enqueue-a',
    now: '2026-07-20T00:00:00.000Z'
  });
  assert.equal(first.status, 'committed');
  assert.match(first.nextDigest, /^sha256:[a-f0-9]{64}$/);
  assert.equal(first.transitionEvidence?.previousDigest, first.baseDigest);
  assert.equal(first.transitionEvidence?.idempotencyKey, 'enqueue-a');

  const replay = enqueueBrokerTicket(store, {
    taskId: 'TASK-A',
    actorId: 'agent-a',
    resourceKey: 'commit:core',
    idempotencyKey: 'enqueue-a',
    now: '2026-07-20T00:00:01.000Z'
  });
  assert.equal(replay.status, 'idempotent-replay');
  assert.equal(replay.nextDigest, first.nextDigest);

  const staleBase = store.read();
  const winner = transitionStoredBrokerTicket(store, {
    ticketId: first.ticket!.ticketId,
    taskId: 'TASK-A',
    actorId: 'agent-a',
    to: 'wakeup-pending',
    reason: 'winner transition',
    idempotencyKey: 'wake-a',
    now: '2026-07-20T00:00:02.000Z'
  });
  assert.equal(winner.status, 'committed');

  const staleAttempt = store.commit({
    base: staleBase,
    action: 'transition',
    taskId: 'TASK-A',
    actorId: 'agent-a',
    idempotencyKey: 'stale-transition',
    now: '2026-07-20T00:00:03.000Z',
    mutate: (document) => ({ document })
  });
  assert.equal(staleAttempt.status, 'revalidation-required');
  assert.equal(staleAttempt.revalidationTicket?.resourceKey.includes('revalidation'), true);
  assert.equal(staleAttempt.baseDigest, staleBase.digest);
  assert.equal(staleAttempt.nextDigest, store.read().digest);

  const contendedBase = store.read();
  const many = Array.from({ length: 100 }, (_, index) => {
    return store.commit({
      base: contendedBase,
      action: 'enqueue',
      taskId: `TASK-${index}`,
      actorId: `agent-${index}`,
      idempotencyKey: `bulk-${index}`,
      now: `2026-07-20T00:01:${String(index % 60).padStart(2, '0')}.000Z`,
      mutate: (document, context) => {
        const ticket = {
          ...document.tickets[0]!,
          taskId: `TASK-NESTED-${index}`,
          actorId: `agent-${index}`,
          idempotencyKey: `nested-${index}`,
          ticketId: `ticket-nested-${index}`,
          resourceKey: 'commit:bulk',
          arrivalIndex: document.tickets.length + index,
          state: 'queued' as const,
          enqueuedAt: context.now,
          updatedAt: context.now,
          heartbeatAt: context.now,
          transitions: []
        };
        return { document: { ...document, tickets: [...document.tickets, ticket] }, ticket };
      }
    });
  });
  assert.equal(many.filter((receipt) => receipt.status === 'committed').length, 1);
  assert.equal(many.filter((receipt) => receipt.status === 'revalidation-required').length, 99);
  assert.equal(store.read().document.tickets.length, 2);

  console.log('[broker-ticket-cas-consistency.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
