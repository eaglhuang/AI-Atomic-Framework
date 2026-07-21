import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  atomicWriteBrokerProjection,
  authorityFromTicketStore,
  buildBrokerProjection,
  isBrokerProjectionFresh,
  readBrokerProjection,
  recordBrokerQueueOnlyTrip
} from '../../packages/core/src/broker/projections/atomic-broker-projection.ts';
import { reconcileBrokerProjection } from '../../packages/core/src/broker/reconcile/broker-projection-reconcile.ts';
import {
  createBrokerTicketStore,
  enqueueBrokerTicket,
  transitionStoredBrokerTicket
} from '../../packages/core/src/broker/ticket-store.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-broker-projection-'));
const store = createBrokerTicketStore(path.join(repo, '.atm/runtime/broker-ticket-store.json'));
const projectionPath = path.join(repo, '.atm/runtime/broker-projections/main.json');

try {
  const first = enqueueBrokerTicket(store, {
    taskId: 'TASK-A',
    actorId: 'agent-a',
    resourceKey: 'commit:core',
    idempotencyKey: 'enqueue-a',
    now: '2026-07-21T00:00:00.000Z'
  }).ticket!;
  const authority1 = authorityFromTicketStore(store.read().document, first.ticketId);
  const projection1 = buildBrokerProjection(authority1, { generatedAt: '2026-07-21T00:00:01.000Z' });
  const write1 = atomicWriteBrokerProjection({ projectionPath, projection: projection1, expectedPublisherGeneration: null });
  assert.equal(write1.status, 'committed');
  assert.equal(readBrokerProjection(projectionPath)?.authorityGeneration, authority1.generation);

  writeFileSync(`${projectionPath}.tmp-crash`, '{"partial":true}', 'utf8');
  const duplicate = reconcileBrokerProjection({ projectionPath, authority: authority1, now: '2026-07-21T00:00:02.000Z' });
  assert.equal(duplicate.status, 'fresh');
  assert.equal(existsSync(`${projectionPath}.tmp-crash`), true);

  const staleBaseProjection = readBrokerProjection(projectionPath)!;
  transitionStoredBrokerTicket(store, {
    ticketId: first.ticketId,
    taskId: 'TASK-A',
    actorId: 'agent-a',
    to: 'wakeup-pending',
    reason: 'publisher won',
    idempotencyKey: 'wake-a',
    now: '2026-07-21T00:00:03.000Z'
  });
  const authority2 = authorityFromTicketStore(store.read().document, first.ticketId);
  assert.equal(isBrokerProjectionFresh(staleBaseProjection, authority2), false);
  const staleWrite = atomicWriteBrokerProjection({
    projectionPath,
    projection: buildBrokerProjection(authority2, { generatedAt: '2026-07-21T00:00:04.000Z' }),
    expectedPublisherGeneration: staleBaseProjection.publisherGeneration + 99
  });
  assert.equal(staleWrite.status, 'stale-generation');
  assert.equal(staleWrite.errorCode, 'ATM_BROKER_TICKET_STALE_GENERATION');

  const sharingRetry = atomicWriteBrokerProjection({
    projectionPath,
    projection: buildBrokerProjection(authority2, { generatedAt: '2026-07-21T00:00:05.000Z' }),
    expectedPublisherGeneration: staleBaseProjection.publisherGeneration,
    simulateSharingViolations: 1,
    maxRetries: 2
  });
  assert.equal(sharingRetry.status, 'committed');
  assert.equal(sharingRetry.attempts, 2);

  const sharingFail = atomicWriteBrokerProjection({
    projectionPath,
    projection: buildBrokerProjection(authority2, { generatedAt: '2026-07-21T00:00:06.000Z' }),
    expectedPublisherGeneration: authority2.generation,
    simulateSharingViolations: 2,
    maxRetries: 2
  });
  assert.equal(sharingFail.status, 'retry-exhausted');
  assert.equal(sharingFail.errorCode, 'ATM_ATOMIC_WRITE_RETRY_EXHAUSTED');

  const afterRace = readBrokerProjection(projectionPath)!;
  assert.equal(afterRace.publisherGeneration, authority2.generation);
  assert.equal(isBrokerProjectionFresh(afterRace, authority2), true);

  const queueOnly = reconcileBrokerProjection({
    projectionPath,
    authority: { ...authority2, generation: authority2.generation + 1, state: { divergent: true }, watermark: 'split-brain' },
    quarantineDivergence: true,
    preserve: { ticket: first, proposal: { proposalId: 'proposal-a' }, evidence: { receipt: 'receipt-a' } }
  });
  assert.equal(queueOnly.status, 'queue-only');
  assert.equal(queueOnly.staleProjectionAuthorizes, false);
  assert.equal(queueOnly.queueOnlyTrip?.errorCode, 'ATM_BROKER_STATE_DIVERGENCE');
  assert.deepEqual(queueOnly.queueOnlyTrip?.preserved.proposal, { proposalId: 'proposal-a' });

  const explicitTrip = recordBrokerQueueOnlyTrip({
    ticketId: first.ticketId,
    reason: 'manual circuit breaker',
    ticket: first,
    proposal: { proposalId: 'proposal-b' },
    evidence: { validator: 'kept' }
  });
  assert.deepEqual(explicitTrip.preserved.evidence, { validator: 'kept' });

  console.log('[atomic-projection-reconcile.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
