import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleBrokerReconcile } from '../../packages/cli/src/commands/broker/reconcile/implementation.ts';
import {
  createBrokerTicketStore,
  enqueueBrokerTicket
} from '../../packages/core/src/broker/ticket-store.ts';
import {
  readBrokerProjection
} from '../../packages/core/src/broker/projections/atomic-broker-projection.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-broker-projection-cli-'));
const store = createBrokerTicketStore(path.join(repo, '.atm/runtime/broker-ticket-store.json'));

try {
  const ticket = enqueueBrokerTicket(store, {
    taskId: 'TASK-CLI',
    actorId: 'agent-cli',
    resourceKey: 'projection:cli',
    idempotencyKey: 'enqueue-cli',
    now: '2026-07-21T00:00:00.000Z'
  }).ticket!;
  const result = handleBrokerReconcile({
    action: 'reconcile',
    reconcileAction: 'projection',
    cwd: repo,
    task: 'TASK-CLI',
    actorId: 'agent-cli',
    projectionKey: ticket.ticketId
  } as never)!;
  assert.equal(result.ok, true);
  assert.equal(result.command, 'broker reconcile projection');
  assert.equal(result.evidence.taskId, 'TASK-CLI');
  assert.equal((result.evidence.result as { status: string }).status, 'rebuilt');
  const projectionPath = path.join(repo, '.atm/runtime/broker-projections', `${ticket.ticketId}.json`);
  assert.equal(readBrokerProjection(projectionPath)?.ticketId, ticket.ticketId);

  const replay = handleBrokerReconcile({
    action: 'reconcile',
    reconcileAction: 'projection',
    cwd: repo,
    task: 'TASK-CLI',
    actorId: 'agent-cli',
    projectionKey: ticket.ticketId
  } as never)!;
  assert.equal((replay.evidence.result as { status: string }).status, 'fresh');

  console.log('[broker-projection-reconcile.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
