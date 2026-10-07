import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { calculateBrokerDecision } from '../../packages/core/src/broker/decision.ts';
import { evaluateBrokerAdmission } from '../../packages/core/src/broker/admission/evaluate-broker-admission.ts';
import { createEmptyBrokerRegistryDocument } from '../../packages/core/src/broker/registry-store.ts';
import { registerIntent } from '../../packages/core/src/broker/registry.ts';
import { createBrokerTransactionAuthority } from '../../packages/core/src/broker/transaction-authority.ts';
import { buildTeamWriteIntent, resolveTeamBrokerLane } from '../../packages/core/src/broker/team-lane.ts';
import { evaluateTeamFileHeat } from '../../packages/core/src/broker/team-lane/file-heat-admission.ts';
import { ownsExactActiveSerialScope } from '../../packages/core/src/broker/serial-queue/policy.ts';
import type { WriteIntent } from '../../packages/core/src/broker/types.ts';

function intent(taskId: string, start = 1, end = 10): WriteIntent {
  return {
    schemaId: 'atm.writeIntent.v1', specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'native hot queue fixture' },
    taskId, actorId: `actor-${taskId}`, baseCommit: 'base-1', targetFiles: ['src/broker.ts'],
    atomRefs: [{ atomId: taskId, atomCid: `cid:${taskId}`, operation: 'modify' }],
    sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: [] },
    requestedLane: 'auto', proposalAdmission: { trigger: 'hot-file', summarySubmitted: true,
      hotFiles: ['src/broker.ts'], boundedRegions: [{ filePath: 'src/broker.ts', lineStart: start, lineEnd: end }] }
  };
}
const first = intent('A');
const empty = createEmptyBrokerRegistryDocument();
const initial = calculateBrokerDecision(first, empty);
const registry = registerIntent(empty, first, initial.lane, 1800, initial.admission);
const second = intent('B');
const preview = evaluateBrokerAdmission({ intent: second }, registry, {});
assert.equal(preview.disposition, 'queue', 'proven hot overlap must park natively instead of terminal true-conflict');
assert.equal(preview.ticket.queue, undefined, 'pure preview must not invent a durable ticket');
assert.equal(resolveTeamBrokerLane(preview.decision).safeToStart, false);
assert.equal(evaluateBrokerAdmission({ intent: intent('DISJOINT', 20, 25) }, registry, {}).disposition, 'compose');
const laterConflict = registerIntent(registry, intent('LATER', 20, 25), 'direct-brokered', 1800,
  calculateBrokerDecision(intent('LATER', 20, 25), empty).admission);
assert.equal(evaluateBrokerAdmission({ intent: intent('C', 20, 25) }, laterConflict, {}).disposition, 'queue',
  'an earlier disjoint writer cannot hide a later conflicting writer');
const shared = { ...first, sharedSurfaces: { ...first.sharedSurfaces, registries: ['catalog'] } };
const sharedRegistry = registerIntent(empty, shared, 'direct-brokered', 1800, initial.admission);
assert.equal(evaluateBrokerAdmission({ intent: { ...second, sharedSurfaces: shared.sharedSurfaces } }, sharedRegistry, {}).disposition, 'true-conflict');
assert.equal(evaluateBrokerAdmission({ intent: { ...second, readAtoms: first.atomRefs } }, registry, {}).disposition, 'true-conflict');
assert.equal(evaluateBrokerAdmission({ intent: second }, { ...registry,
  activeIntents: registry.activeIntents.map((active) => ({ ...active, leaseEpoch: 0 })) }, {}).disposition, 'revalidate');
const notRequired = { ...first, proposalAdmission: { ...first.proposalAdmission!, trigger: 'not-required' as const, summarySubmitted: false, hotFiles: [] } };
const notRequiredActive = registerIntent(empty, notRequired, 'direct-brokered', 1800, calculateBrokerDecision(notRequired, empty).admission).activeIntents[0];
assert.equal(ownsExactActiveSerialScope({ ...notRequired, proposalAdmission: { ...notRequired.proposalAdmission,
  boundedRegions: [{ filePath: 'src/broker.ts', lineStart: 20, lineEnd: 30 }] } }, notRequiredActive), false,
  'effective bounds remain scope even for not-required proposal metadata');

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-native-hot-core-'));
try {
  const authority = createBrokerTransactionAuthority(path.join(root, 'registry.json'));
  const submit = (value: WriteIntent, ticketId?: string) => {
    const decision = calculateBrokerDecision(value, authority.read().document);
    return authority.register({ intent: value, lane: decision.lane, admissionOverride: decision.admission,
      ...(ticketId ? { queueTicketId: ticketId, currentBaseCommit: value.baseCommit } : {}) });
  };
  assert.equal(submit(first).admission?.disposition, 'proposal-required');
  assert.throws(() => submit({ ...second, leaseBounds: { requestedSeconds: 0, maxSeconds: 10 } }), /Invalid serial queue lease bounds/);
  assert.equal(authority.read().document.serialQueue?.tickets.length ?? 0, 0, 'invalid queue lifetime is rejected before persistence');
  const parked = submit(second);
  assert.equal(parked.admission?.disposition, 'queue');
  const ticket = parked.admission!.ticket.ticketId;
  assert.equal(parked.admission?.ticket.queue?.writeAuthorized, false);
  assert.equal(authority.read().document.activeIntents.length, 1);
  assert.equal(submit(second).admission!.ticket.ticketId, ticket);
  const third = intent('C');
  const thirdTicket = submit(third).admission!.ticket.ticketId;
  const unready = { ...intent('UNREADY'), proposalAdmission: { ...second.proposalAdmission!, summarySubmitted: false } };
  assert.notEqual(submit(unready).admission?.disposition, 'queue', 'FIFO cannot bypass proposal readiness');
  assert.equal(authority.read().document.serialQueue!.tickets.some((entry) => entry.taskId === unready.taskId), false);
  assert.equal(authority.read().document.activeIntents.some((entry) => entry.taskId === unready.taskId), false);
  assert.throws(() => submit({ ...second, actorId: 'another-actor' }, ticket), /ATM_BROKER_SAME_TASK_LANE_FENCE/);
  assert.equal(submit({ ...second, proposalAdmission: { ...second.proposalAdmission!, boundedRegions: [
    { filePath: 'src/broker.ts', lineStart: 20, lineEnd: 25 }
  ] } }, ticket).admission?.disposition, 'revalidate');
  authority.release({ taskId: first.taskId, actorId: first.actorId });
  assert.equal(authority.read().document.activeIntents.length, 0, 'wakeup never installs a writer');
  assert.equal(submit(third, thirdTicket).admission?.disposition, 'queue', 'later writer cannot jump FIFO');
  assert.equal(submit(second).admission?.disposition, 'revalidate', 'eligible needs explicit native resume');
  const resumed = submit(second, ticket);
  assert.equal(resumed.admission?.disposition, 'proposal-required');
  assert.equal(resumed.admission?.decision.admission?.state, 'provisional-write-lease');
  assert.equal(resumed.admission?.ticket.queue?.state, 'granted', 'receipt must agree with committed grant');
  assert.equal(authority.read().document.activeIntents.length, 1);
  const epoch = authority.read().document.activeIntents[0].leaseEpoch;
  assert.equal(submit(second, ticket).status, 'idempotent-replay');
  assert.equal(authority.read().document.activeIntents[0].leaseEpoch, epoch, 'lost-response replay cannot renew');
  authority.release({ taskId: second.taskId, actorId: second.actorId });
  assert.equal(submit(third, thirdTicket).admission?.disposition, 'proposal-required');

  const normalized = createBrokerTransactionAuthority(path.join(root, 'normalized.json'));
  const duplicateHot = { ...second, proposalAdmission: { ...second.proposalAdmission!, hotFiles: ['src/broker.ts', ' src/broker.ts ', 'src/broker.ts'] } };
  normalized.register({ intent: first, lane: initial.lane, admissionOverride: initial.admission });
  const normalizedTicket = normalized.register({ intent: duplicateHot, lane: 'serial' }).admission!.ticket.ticketId;
  normalized.release({ taskId: first.taskId, actorId: first.actorId });
  assert.equal(normalized.register({ intent: duplicateHot, lane: 'serial', queueTicketId: normalizedTicket,
    currentBaseCommit: duplicateHot.baseCommit }).admission?.ticket.queue?.state, 'granted', 'normalized proposal metadata must match its own lease');

  const disjointAuthority = createBrokerTransactionAuthority(path.join(root, 'disjoint.json'));
  disjointAuthority.register({ intent: first, lane: initial.lane, admissionOverride: initial.admission });
  const disjointTicket = disjointAuthority.register({ intent: second, lane: 'serial' }).admission!.ticket.ticketId;
  const compatible = intent('COMPATIBLE', 20, 25);
  const compatibleDecision = calculateBrokerDecision(compatible, disjointAuthority.read().document);
  assert.equal(compatibleDecision.lane, 'deterministic-composer');
  disjointAuthority.register({ intent: compatible, lane: compatibleDecision.lane, admissionOverride: compatibleDecision.admission });
  disjointAuthority.release({ taskId: first.taskId, actorId: first.actorId });
  assert.equal(disjointAuthority.read().document.serialQueue!.tickets.find((entry) => entry.ticketId === disjointTicket)!.state, 'eligible',
    'proven-disjoint composer work must not hold a hot ticket');
  const composerGrant = disjointAuthority.register({ intent: second, lane: 'serial', queueTicketId: disjointTicket, currentBaseCommit: second.baseCommit });
  assert.equal(composerGrant.admission?.disposition, 'compose');
  assert.equal(composerGrant.admission?.ticket.queue?.state, 'granted');
  assert.equal(composerGrant.admission?.ticket.queue?.writeAuthorized, false);
  assert.equal(disjointAuthority.read().document.activeIntents.find((entry) => entry.taskId === second.taskId)!.lane, 'deterministic-composer');
  assert.equal(calculateBrokerDecision(second, disjointAuthority.read().document).lane, 'deterministic-composer',
    'ordinary composer/runtime recheck must not self-park an already handed-off ticket');
  disjointAuthority.release({ taskId: second.taskId, actorId: second.actorId });
  assert.equal(disjointAuthority.read().document.serialQueue!.tickets.find((entry) => entry.ticketId === disjointTicket)!.state, 'released');

  const mixed = createBrokerTransactionAuthority(path.join(root, 'mixed.json'));
  mixed.register({ intent: first, lane: initial.lane, admissionOverride: initial.admission });
  const cold = { ...second, proposalAdmission: undefined, atomRefs: second.atomRefs.map((ref) => ({ ...ref,
    sourceRange: { filePath: 'src/broker.ts', lineStart: 1, lineEnd: 10 } })) };
  const coldTicket = mixed.register({ intent: cold, lane: 'serial' }).admission!.ticket.ticketId;
  const mixedHotTicket = mixed.register({ intent: third, lane: 'serial' }).admission!.ticket.ticketId;
  mixed.release({ taskId: first.taskId, actorId: first.actorId });
  assert.equal(mixed.register({ intent: third, lane: 'serial', queueTicketId: mixedHotTicket, currentBaseCommit: third.baseCommit }).admission?.disposition, 'queue');
  assert.equal(mixed.register({ intent: cold, lane: 'serial', queueTicketId: coldTicket, currentBaseCommit: cold.baseCommit }).admission?.disposition, 'direct');
  mixed.release({ taskId: cold.taskId, actorId: cold.actorId });
  assert.equal(mixed.register({ intent: third, lane: 'serial', queueTicketId: mixedHotTicket, currentBaseCommit: third.baseCommit }).admission?.disposition, 'proposal-required');

  const multi = createBrokerTransactionAuthority(path.join(root, 'multi.json'));
  multi.register({ intent: first, lane: initial.lane, admissionOverride: initial.admission });
  const partlyUnknown = { ...intent('UNKNOWN', 20, 25), targetFiles: ['src/broker.ts', 'src/second.ts'] };
  const unknownDecision = calculateBrokerDecision(partlyUnknown, multi.read().document);
  multi.register({ intent: partlyUnknown, lane: unknownDecision.lane, admissionOverride: unknownDecision.admission });
  const multiWaiter = { ...second, targetFiles: ['src/broker.ts', 'src/second.ts'], proposalAdmission: { ...second.proposalAdmission!,
    boundedRegions: [...second.proposalAdmission!.boundedRegions!, { filePath: 'src/second.ts', lineStart: 1, lineEnd: 10 }] } };
  const multiTicket = multi.register({ intent: multiWaiter, lane: 'serial' }).admission!.ticket.ticketId;
  multi.release({ taskId: first.taskId, actorId: first.actorId });
  assert.equal(multi.read().document.serialQueue!.tickets.find((entry) => entry.ticketId === multiTicket)!.state, 'queued',
    'one disjoint file does not exempt another file with unknown bounds');

  const heatPath = path.join(root, 'heat.json');
  const heatNow = new Date('2026-01-01T00:00:00.000Z');
  const heat = JSON.stringify({ schemaId: 'atm.fileHeatLedger.v1', specVersion: '0.1.0', entries: {
    'src/broker.ts': { temperature: 100, lastTouchAt: heatNow.toISOString(), lastActorId: 'seed', lastTaskId: 'seed' }
  } });
  for (const mode of ['static', 'hybrid', 'learned'] as const) {
    writeFileSync(heatPath, heat);
    const heatReceipt = evaluateTeamFileHeat({ cwd: root, taskId: `HEAT-${mode}`, actorId: 'heat-writer', writePaths: ['src/broker.ts'],
      fileHeatPath: heatPath, fileHeatMode: mode, fileHeatFrozen: true, readOnly: true, now: heatNow });
    assert.equal(heatReceipt.files[0].hot, true);
    const heatIntent = { ...buildTeamWriteIntent({ cwd: root, taskId: `HEAT-${mode}`, actorId: 'heat-writer',
      task: { proposalAdmission: { summarySubmitted: true, boundedRegions: second.proposalAdmission!.boundedRegions } },
      writePaths: ['src/broker.ts'], fileHeat: heatReceipt }), baseCommit: first.baseCommit };
    const heatAuthority = createBrokerTransactionAuthority(path.join(root, `heat-${mode}.json`));
    heatAuthority.register({ intent: first, lane: initial.lane, admissionOverride: initial.admission });
    const heatTicket = heatAuthority.register({ intent: heatIntent, lane: 'serial' }).admission!.ticket.ticketId;
    assert.equal(readFileSync(heatPath, 'utf8'), heat, 'frozen heat selection must not record touches');
    const persistedIntent = heatAuthority.read().document.serialQueue!.tickets[0].intent;
    heatAuthority.release({ taskId: first.taskId, actorId: first.actorId });
    writeFileSync(heatPath, JSON.stringify({ schemaId: 'atm.fileHeatLedger.v1', specVersion: '0.1.0', entries: {} }));
    assert.equal(heatAuthority.register({ intent: persistedIntent, lane: 'serial', queueTicketId: heatTicket,
      currentBaseCommit: persistedIntent.baseCommit }).admission?.disposition, 'proposal-required', 'resume reuses the selected heat/proposal scope');
  }

  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    const expired = createBrokerTransactionAuthority(path.join(root, 'expired.json'));
    expired.register({ intent: first, lane: initial.lane, ttlSeconds: 1, admissionOverride: initial.admission });
    const expiryTicket = expired.register({ intent: second, lane: 'serial' }).admission!.ticket.ticketId;
    now += 2000;
    const afterExpiry = expired.register({ intent: second, lane: 'serial', queueTicketId: expiryTicket, currentBaseCommit: second.baseCommit });
    assert.equal(afterExpiry.admission?.ticket.queue?.state, 'granted', 'lease expiry wakes and revalidates inside the original CAS');
    assert.deepEqual(expired.read().document.activeIntents.map((entry) => entry.taskId), [second.taskId]);

    const replayExpired = createBrokerTransactionAuthority(path.join(root, 'replay-expired.json'));
    const originalInput = { intent: first, lane: initial.lane, ttlSeconds: 1, admissionOverride: initial.admission };
    replayExpired.register(originalInput);
    now += 2000;
    const expiredReplay = replayExpired.register(originalInput);
    assert.equal(expiredReplay.status, 'idempotent-replay');
    assert.equal(expiredReplay.admission?.disposition, 'revalidate');
    assert.equal(replayExpired.read().document.activeIntents.length, 0, 'lost-response replay must not resurrect an expired writer');

    const unrelatedReplay = createBrokerTransactionAuthority(path.join(root, 'unrelated-replay.json'));
    const other = { ...intent('OTHER'), targetFiles: ['other.ts'], proposalAdmission: undefined };
    unrelatedReplay.register({ intent: other, lane: 'direct-brokered', ttlSeconds: 1 });
    unrelatedReplay.register({ intent: first, lane: initial.lane, admissionOverride: initial.admission });
    const liveEpoch = unrelatedReplay.read().document.activeIntents.find((entry) => entry.taskId === first.taskId)!.leaseEpoch;
    now += 2000;
    assert.equal(unrelatedReplay.register({ intent: first, lane: initial.lane, admissionOverride: initial.admission }).status, 'idempotent-replay');
    assert.equal(unrelatedReplay.read().document.activeIntents[0].leaseEpoch, liveEpoch, 'unrelated cleanup must not renew a replayed writer');
    unrelatedReplay.register({ intent: other, lane: 'direct-brokered', ttlSeconds: 1 });
    unrelatedReplay.heartbeat({ taskId: first.taskId, actorId: first.actorId });
    const heartbeatEpoch = unrelatedReplay.read().document.activeIntents.find((entry) => entry.taskId === first.taskId)!.leaseEpoch;
    now += 2000;
    assert.equal(unrelatedReplay.heartbeat({ taskId: first.taskId, actorId: first.actorId }).status, 'idempotent-replay');
    assert.equal(unrelatedReplay.read().document.activeIntents[0].leaseEpoch, heartbeatEpoch, 'cleanup must not replay heartbeat mutation');

    const expiringHead = createBrokerTransactionAuthority(path.join(root, 'expiring-head.json'));
    expiringHead.register({ intent: first, lane: initial.lane, admissionOverride: initial.admission });
    expiringHead.register({ intent: second, lane: 'serial', ttlSeconds: 1 });
    const tail = expiringHead.register({ intent: third, lane: 'serial' }).admission!.ticket.ticketId;
    now += 2000;
    expiringHead.release({ taskId: first.taskId, actorId: first.actorId });
    assert.equal(expiringHead.read().document.serialQueue!.tickets.find((entry) => entry.taskId === second.taskId)!.state, 'expired');
    assert.equal(expiringHead.read().document.serialQueue!.tickets.find((entry) => entry.ticketId === tail)!.state, 'eligible');
    expiringHead.release({ taskId: third.taskId, actorId: third.actorId });
    assert.equal(expiringHead.read().document.serialQueue!.tickets.find((entry) => entry.ticketId === tail)!.state, 'cancelled');
  } finally {
    Date.now = originalNow;
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log('test_broker_native_hot_queue_core_contract: passed');
