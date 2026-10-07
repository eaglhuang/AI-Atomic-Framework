// Product CI discovers tests/cli/*.test.ts; include the core safety contract in that sweep.
import '../core/broker-native-hot-queue.test.ts';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBroker } from '../../packages/cli/src/commands/broker.ts';
import { evaluateBrokerQueueAdmission } from '../../packages/cli/src/commands/next/broker-queue-admission.ts';
import { evaluateTaskflowBrokerConflictGate } from '../../packages/cli/src/commands/taskflow/broker-gate.ts';
import type { WriteIntent } from '../../packages/core/src/broker/types.ts';
import type { BrokerAdmissionResult } from '../../packages/core/src/broker/admission/contracts.ts';
import type { SerialQueueObservation } from '../../packages/core/src/broker/serial-queue/contracts.ts';

type Result = { ok: boolean; evidence: { admission: BrokerAdmissionResult; writeAuthorized: boolean;
  writeAuthorizedFiles: string[]; serialQueue: SerialQueueObservation; serialQueueTickets: SerialQueueObservation[]; resumeCommand?: string } };
const broker = async (args: string[]) => await runBroker(args) as unknown as Result;
const root = mkdtempSync(path.join(os.tmpdir(), 'atm-native-hot-cli-'));
try {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  git('commit', '--allow-empty', '-m', 'synthetic hot base');
  const baseCommit = git('rev-parse', 'HEAD');
  const make = (taskId: string): WriteIntent => ({
    schemaId: 'atm.writeIntent.v1', specVersion: '0.1.0', migration: { strategy: 'none', fromVersion: null, notes: 'hot CLI fixture' },
    taskId, actorId: `actor-${taskId}`, baseCommit, targetFiles: ['broker.ts'],
    atomRefs: [{ atomId: taskId, atomCid: taskId, operation: 'modify' }],
    sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: [] }, requestedLane: 'auto',
    proposalAdmission: { trigger: 'hot-file', summarySubmitted: true, hotFiles: ['broker.ts'],
      boundedRegions: [{ filePath: 'broker.ts', lineStart: 1, lineEnd: 10 }] }
  });
  const register = async (intent: WriteIntent, ticket?: string) => {
    const file = path.join(root, `${intent.taskId}.json`); writeFileSync(file, JSON.stringify(intent));
    return broker(['register', '--cwd', root, '--task', intent.taskId, '--actor', intent.actorId, '--intent-file', file,
      ...(ticket ? ['--queue-ticket', ticket] : [])]);
  };
  const a = make('HOT-A'); const b = make('HOT-B');
  assert.equal((await register(a)).ok, true);
  const registryPath = path.join(root, '.atm/runtime/write-broker.registry.json');
  const intentPath = path.join(root, 'preview.json'); writeFileSync(intentPath, JSON.stringify(b));
  const beforePreview = readFileSync(registryPath, 'utf8');
  const preview = await broker(['decision', '--cwd', root, '--intent-file', intentPath]);
  assert.equal(preview.evidence.admission.disposition, 'queue');
  assert.equal(preview.evidence.admission.ticket.queue, undefined);
  assert.equal(readFileSync(registryPath, 'utf8'), beforePreview, 'decision is not enqueue');
  const parked = await register(b);
  assert.equal(parked.ok, false);
  assert.equal(parked.evidence.writeAuthorized, false);
  assert.deepEqual(parked.evidence.writeAuthorizedFiles, []);
  assert.equal(parked.evidence.serialQueue.reason, 'provisional-overlap');
  assert.deepEqual(parked.evidence.serialQueue.blockerTaskIds, [a.taskId]);
  assert.equal(parked.evidence.serialQueue.position, 1);
  const ticket = parked.evidence.admission.ticket.ticketId;
  assert.ok(parked.evidence.resumeCommand?.includes(`--queue-ticket ${ticket}`));
  const beforeStatus = readFileSync(registryPath, 'utf8');
  const status = await broker(['status', '--cwd', root]);
  assert.equal(status.evidence.serialQueueTickets[0].ticketId, ticket);
  assert.equal(readFileSync(registryPath, 'utf8'), beforeStatus, 'status is read-only');
  assert.equal(evaluateBrokerQueueAdmission({ cwd: root, taskId: b.taskId, allowedFiles: ['broker.ts'], overlappingFiles: ['broker.ts'] }).status,
    'queued-blocked');
  assert.notEqual(evaluateTaskflowBrokerConflictGate({ cwd: root, taskId: b.taskId, actorId: b.actorId, declaredFiles: ['broker.ts'] }).verdict,
    'noConflict');
  await broker(['release', '--cwd', root, '--task', a.taskId, '--actor', a.actorId]);
  assert.equal((await broker(['status', '--cwd', root])).evidence.serialQueueTickets[0].state, 'eligible');
  assert.equal((await register(b)).evidence.admission.disposition, 'revalidate');
  git('commit', '--allow-empty', '-m', 'new current base');
  const stale = await register(b, ticket);
  assert.equal(stale.evidence.admission.disposition, 'revalidate');
  assert.equal(stale.evidence.writeAuthorized, false);
  const refreshed = { ...b, baseCommit: git('rev-parse', 'HEAD') };
  const resumed = await register(refreshed, ticket);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.evidence.admission.disposition, 'proposal-required');
  assert.equal(resumed.evidence.admission.decision.admission?.state, 'provisional-write-lease');
  assert.equal(resumed.evidence.serialQueue.state, 'granted');
  await broker(['release', '--cwd', root, '--task', b.taskId, '--actor', b.actorId]);
  assert.equal((await broker(['status', '--cwd', root])).evidence.serialQueueTickets[0].state, 'released');
  const unready = { ...make('UNREADY-LEGACY'), baseCommit: git('rev-parse', 'HEAD'),
    proposalAdmission: { ...b.proposalAdmission!, summarySubmitted: false } };
  writeFileSync(path.join(root, '.atm/runtime/broker-shared-surface-queues.json'), JSON.stringify({
    schemaId: 'atm.brokerSharedSurfaceQueues.v1', queues: [{ schemaId: 'atm.brokerSharedSurfaceQueue.v1', surfacePath: 'broker.ts',
      entries: [{ taskId: unready.taskId, actorId: unready.actorId, surfacePath: 'broker.ts', leaseEpoch: Date.now(),
        baseHash: unready.baseCommit, reason: 'retained legacy fixture', releaseCondition: 'governed release', queuedAt: new Date().toISOString() }] }]
  }));
  const legacy = await register(unready);
  assert.equal(legacy.ok, true, 'initial proposal-only metadata registration remains accepted');
  assert.equal(legacy.evidence.writeAuthorized, false);
  assert.deepEqual(legacy.evidence.writeAuthorizedFiles, []);
  const unreadyMetadata = JSON.parse(readFileSync(registryPath, 'utf8')).activeIntents.find((entry: { taskId: string }) => entry.taskId === unready.taskId);
  assert.equal(unreadyMetadata.admission.state, 'proposal-submitted', 'legacy queue state must not promote metadata into a writer');
  assert.equal(unreadyMetadata.admission.summarySubmitted, false);
  const legacyCold = (taskId: string, files: string[]) => ({ ...make(taskId), baseCommit: git('rev-parse', 'HEAD'),
    targetFiles: files, atomRefs: [], proposalAdmission: undefined });
  await register(legacyCold('COLD-OWNER', ['shared.ts', 'owner-private.ts']));
  const privateProgress = await register(legacyCold('COLD-WAITER', ['shared.ts', 'waiter-private.ts']));
  assert.equal(privateProgress.ok, true, 'legacy composer work retains explicitly bounded private progress');
  assert.equal(privateProgress.evidence.writeAuthorized, true);
  assert.deepEqual(privateProgress.evidence.writeAuthorizedFiles, ['waiter-private.ts']);
  const privateRegistry = JSON.parse(readFileSync(registryPath, 'utf8'));
  assert.equal(privateRegistry.activeIntents.find((entry: { taskId: string }) => entry.taskId === 'COLD-WAITER').lane, 'deterministic-composer',
    'private progress must not promote the whole shared/composer intent to direct write');
} finally {
  rmSync(root, { recursive: true, force: true });
}
console.log('test_broker_native_hot_queue_cli_contract: passed');
