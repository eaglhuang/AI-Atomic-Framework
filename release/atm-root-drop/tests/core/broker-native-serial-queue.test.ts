import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { evaluateBrokerAdmission } from '../../packages/core/src/broker/admission/evaluate-broker-admission.ts';
import { cleanupStale, registerIntent } from '../../packages/core/src/broker/registry.ts';
import { createEmptyBrokerRegistryDocument } from '../../packages/core/src/broker/registry-store.ts';
import { createBrokerTransactionAuthority } from '../../packages/core/src/broker/transaction-authority.ts';
import { resolveTeamBrokerLane } from '../../packages/core/src/broker/team-lane.ts';
import type { WriteIntent } from '../../packages/core/src/broker/types.ts';

function intent(taskId: string, files = ['src/cold.ts']): WriteIntent {
  return {
    schemaId: 'atm.writeIntent.v1', specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'native queue fixture' },
    taskId, actorId: `actor-${taskId}`, baseCommit: 'base-1', targetFiles: files,
    atomRefs: files.map((filePath) => ({ atomId: filePath, atomCid: `cid:${filePath}`, operation: 'modify',
      sourceRange: { filePath, lineStart: 1, lineEnd: 10 } })),
    sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: [] },
    requestedLane: 'auto'
  };
}

const first = intent('A');
const second = intent('B');
const registry = registerIntent(createEmptyBrokerRegistryDocument(), first, 'direct-brokered');
const queued = evaluateBrokerAdmission({ intent: second }, registry, {});
assert.equal(queued.disposition, 'queue', 'a genuine cold collision must reach the native queue');
assert.equal(queued.decision.lane, 'serial');
assert.equal(resolveTeamBrokerLane(queued.decision).safeToStart, false, 'queue is never write authority');
const uniqueAtom = { ...second, atomRefs: second.atomRefs.map((ref) => ({ ...ref, atomId: 'other', atomCid: 'other' })) };
assert.equal(evaluateBrokerAdmission({ intent: uniqueAtom }, registry, {}).disposition, 'queue', 'same cold range queues even with distinct atoms');
const unbounded = { ...uniqueAtom, atomRefs: uniqueAtom.atomRefs.map(({ sourceRange, ...ref }) => ref) };
assert.equal(evaluateBrokerAdmission({ intent: unbounded }, registry, {}).disposition, 'compose', 'unknown bounds stay compose-first');
assert.equal(evaluateBrokerAdmission({ intent: { ...unbounded, requestedLane: 'serial' } }, registry, {}).disposition, 'queue');
const disjoint = { ...uniqueAtom, atomRefs: uniqueAtom.atomRefs.map((ref) => ({ ...ref, sourceRange: { filePath: 'src/cold.ts', lineStart: 20, lineEnd: 25 } })) };
assert.equal(evaluateBrokerAdmission({ intent: disjoint }, registry, {}).disposition, 'direct');
assert.equal(evaluateBrokerAdmission({ intent: { ...second, readAtoms: first.atomRefs } }, registry, {}).disposition, 'true-conflict');
const shared = { ...first, sharedSurfaces: { ...first.sharedSurfaces, registries: ['registry'] } };
assert.equal(evaluateBrokerAdmission({ intent: { ...second, sharedSurfaces: shared.sharedSurfaces } },
  registerIntent(createEmptyBrokerRegistryDocument(), shared, 'direct-brokered'), {}).disposition, 'true-conflict');
const stale = { ...registry, activeIntents: registry.activeIntents.map((active) => ({ ...active, expiresAt: '2000-01-01T00:00:00.000Z' })) };
assert.equal(evaluateBrokerAdmission({ intent: second }, stale, {}).disposition, 'revalidate');

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-native-queue-core-'));
try {
  const registryPath = path.join(root, 'registry.json');
  const authority = createBrokerTransactionAuthority(registryPath);
  assert.equal(authority.register({ intent: first, lane: 'direct-brokered' }).admission?.disposition, 'direct');
  const registration = authority.register({ intent: second, lane: 'direct-brokered' });
  assert.equal(registration.admission?.disposition, 'queue');
  const ticketId = registration.admission!.ticket.ticketId;
  assert.equal(authority.read().document.activeIntents.length, 1);
  assert.equal(authority.register({ intent: second, lane: 'direct-brokered' }).admission!.ticket.ticketId, ticketId);
  authority.release({ taskId: first.taskId, actorId: first.actorId });
  const restarted = createBrokerTransactionAuthority(registryPath);
  assert.equal(restarted.read().document.activeIntents.length, 0, 'release must not auto-grant an old intent');
  assert.equal(restarted.register({ intent: second, lane: 'direct-brokered' }).admission?.disposition, 'revalidate');
  assert.equal(restarted.register({ intent: second, lane: 'direct-brokered', queueTicketId: ticketId,
    currentBaseCommit: 'base-2' }).admission?.disposition, 'revalidate', 'stale base fails closed');
  assert.equal(restarted.register({ intent: { ...second, targetFiles: ['src/other.ts'] }, lane: 'direct-brokered',
    queueTicketId: ticketId, currentBaseCommit: 'base-1' }).admission?.disposition, 'revalidate', 'scope cannot widen');
  const resumed = restarted.register({ intent: second, lane: 'direct-brokered', queueTicketId: ticketId,
    currentBaseCommit: 'base-1' });
  assert.equal(resumed.admission?.disposition, 'direct');
  assert.equal(restarted.read().document.activeIntents[0]?.taskId, second.taskId);

  const fifo = createBrokerTransactionAuthority(path.join(root, 'fifo.json'));
  const a = intent('fifo-A'); const b = intent('fifo-B'); const c = intent('fifo-C');
  fifo.register({ intent: a, lane: 'direct-brokered' });
  const bTicket = fifo.register({ intent: b, lane: 'direct-brokered' }).admission!.ticket.ticketId;
  const cTicket = fifo.register({ intent: c, lane: 'direct-brokered' }).admission!.ticket.ticketId;
  assert.equal(fifo.read().document.serialQueue!.tickets.length, 2);
  assert.throws(() => fifo.release({ taskId: a.taskId, actorId: 'foreign' }), /SAME_TASK_LANE_FENCE/);
  assert.throws(() => fifo.register({ intent: { ...b, actorId: 'foreign' }, lane: 'direct-brokered' }), /SAME_TASK_LANE_FENCE/);
  fifo.release({ taskId: a.taskId, actorId: a.actorId });
  assert.equal(fifo.read().document.serialQueue!.tickets.find((ticket) => ticket.ticketId === bTicket)!.state, 'eligible');
  const newcomer = fifo.register({ intent: intent('fifo-D'), lane: 'direct-brokered' });
  assert.equal(newcomer.admission?.disposition, 'queue', 'newcomers cannot jump an eligible waiter');
  assert.equal(fifo.register({ intent: c, lane: 'direct-brokered', queueTicketId: cTicket, currentBaseCommit: c.baseCommit }).admission?.disposition, 'queue');
  const headGrant = fifo.register({ intent: b, lane: 'direct-brokered', queueTicketId: bTicket, currentBaseCommit: b.baseCommit });
  assert.equal(headGrant.admission?.disposition, 'direct', 'later waiters never prevent the head from resuming');
  assert.equal(fifo.read().document.activeIntents.length, 1);
  const grantLease = fifo.read().document.activeIntents[0].leaseEpoch;
  assert.equal(fifo.register({ intent: b, lane: 'direct-brokered', queueTicketId: bTicket, currentBaseCommit: b.baseCommit }).admission?.disposition, 'direct');
  assert.equal(fifo.read().document.activeIntents[0].leaseEpoch, grantLease, 'lost-response replay cannot renew or create a lease');
  assert.equal(fifo.read().document.serialQueue!.events.filter((event) => event.state === 'granted').length, 1);
  fifo.release({ taskId: b.taskId, actorId: b.actorId });
  assert.equal(fifo.register({ intent: c, lane: 'direct-brokered', queueTicketId: cTicket, currentBaseCommit: c.baseCommit }).admission?.disposition, 'direct');
  assert.deepEqual(fifo.read().document.serialQueue!.events.filter((event) => event.state === 'granted').map((event) => event.taskId), [b.taskId, c.taskId]);

  const chain = createBrokerTransactionAuthority(path.join(root, 'chain.json'));
  const holderX = intent('holder-X', ['x']); const holderY = intent('holder-Y', ['y']);
  chain.register({ intent: holderX, lane: 'direct-brokered' });
  chain.register({ intent: holderY, lane: 'direct-brokered' });
  const head = intent('chain-head', ['x', 'y']); const tail = intent('chain-tail', ['y']);
  const headTicket = chain.register({ intent: head, lane: 'direct-brokered' }).admission!.ticket.ticketId;
  chain.register({ intent: tail, lane: 'direct-brokered' });
  chain.release({ taskId: holderY.taskId, actorId: holderY.actorId });
  assert.equal(chain.register({ intent: intent('unrelated', ['z']), lane: 'direct-brokered' }).admission?.disposition, 'direct');
  const expansion = chain.register({ intent: intent(holderX.taskId, ['x', 'y']), lane: 'direct-brokered' });
  assert.equal(expansion.admission?.disposition, 'revalidate', 'release the old lease before changing scope; never create a hold-and-wait cycle');
  assert.equal(chain.read().document.serialQueue!.tickets.some((ticket) => ticket.taskId === holderX.taskId), false);
  assert.deepEqual(chain.read().document.activeIntents.find((entry) => entry.taskId === holderX.taskId)!.resourceKeys.files, ['x']);
  chain.release({ taskId: holderX.taskId, actorId: holderX.actorId });
  assert.equal(chain.register({ intent: head, lane: 'direct-brokered', queueTicketId: headTicket, currentBaseCommit: head.baseCommit }).admission?.disposition, 'direct');

  const expiry = createBrokerTransactionAuthority(path.join(root, 'expiry.json'));
  expiry.register({ intent: a, lane: 'direct-brokered' });
  const expiryTicket = expiry.register({ intent: b, lane: 'direct-brokered' }).admission!.ticket.ticketId;
  expiry.register({ intent: c, lane: 'direct-brokered' });
  expiry.release({ taskId: a.taskId, actorId: a.actorId });
  expiry.register({ intent: b, lane: 'direct-brokered', queueTicketId: expiryTicket, currentBaseCommit: b.baseCommit, ttlSeconds: 1 });
  const cleaned = cleanupStale(expiry.read().document, { now: Date.now() + 2000 });
  assert.equal(cleaned.activeIntents.length, 0);
  assert.equal(cleaned.serialQueue!.tickets.find((ticket) => ticket.ticketId === expiryTicket)!.state, 'expired');
  assert.equal(cleaned.serialQueue!.tickets.find((ticket) => ticket.taskId === c.taskId)!.state, 'eligible');
  assert.ok(cleaned.serialQueue!.events.some((event) => event.ticketId === expiryTicket && event.state === 'expired'));

  const cancel = createBrokerTransactionAuthority(path.join(root, 'cancel.json'));
  cancel.register({ intent: a, lane: 'direct-brokered' });
  cancel.register({ intent: b, lane: 'direct-brokered' });
  cancel.register({ intent: c, lane: 'direct-brokered' });
  cancel.release({ taskId: a.taskId, actorId: a.actorId });
  cancel.release({ taskId: b.taskId, actorId: b.actorId });
  assert.equal(cancel.read().document.activeIntents.length, 0);
  assert.equal(cancel.read().document.serialQueue!.tickets.find((ticket) => ticket.taskId === b.taskId)!.state, 'cancelled');
  assert.equal(cancel.read().document.serialQueue!.tickets.find((ticket) => ticket.taskId === c.taskId)!.state, 'eligible');
  const reordered = createBrokerTransactionAuthority(path.join(root, 'reordered.json'));
  reordered.register({ intent: a, lane: 'direct-brokered' });
  const reorderedIntent = { ...b, atomRefs: b.atomRefs.map((ref) => ({ ...ref,
    sourceRange: { lineStart: 1, lineEnd: 10, filePath: ref.sourceRange!.filePath } })) };
  const reorderedTicket = reordered.register({ intent: reorderedIntent, lane: 'direct-brokered' }).admission!.ticket.ticketId;
  reordered.release({ taskId: a.taskId, actorId: a.actorId });
  assert.equal(reordered.register({ intent: reorderedIntent, lane: 'direct-brokered', queueTicketId: reorderedTicket,
    currentBaseCommit: b.baseCommit }).admission?.disposition, 'direct');
  assert.equal(reordered.read().document.serialQueue!.tickets[0].state, 'granted', 'JSON property order is not a scope change');
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log('test_broker_native_serial_queue_core_contract: passed');
