import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBroker } from '../../packages/cli/src/commands/broker.ts';
import type { WriteIntent } from '../../packages/core/src/broker/types.ts';
import type { BrokerAdmissionResult } from '../../packages/core/src/broker/admission/contracts.ts';
import type { SerialQueueDocument, SerialQueueObservation } from '../../packages/core/src/broker/serial-queue/contracts.ts';
import { evaluateTaskflowBrokerConflictGate } from '../../packages/cli/src/commands/taskflow/broker-gate.ts';
import { evaluateBrokerQueueAdmission } from '../../packages/cli/src/commands/next/broker-queue-admission.ts';
import { registerPreClaimBrokerTransaction } from '../../packages/cli/src/commands/next/claim-helpers.ts';

type Result = { ok: boolean; evidence: { writeAuthorized: boolean; admission: BrokerAdmissionResult;
  serialQueue: SerialQueueDocument & SerialQueueObservation; serialQueueTickets: SerialQueueObservation[] } };
const broker = async (args: string[]) => await runBroker(args) as unknown as Result;

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-native-queue-cli-'));
try {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  git('commit', '--allow-empty', '-m', 'fixture base');
  const baseCommit = git('rev-parse', 'HEAD');
  const makeIntent = (taskId: string): WriteIntent => ({
    schemaId: 'atm.writeIntent.v1', specVersion: '0.1.0', migration: { strategy: 'none', fromVersion: null, notes: 'CLI native queue' },
    taskId, actorId: `actor-${taskId}`, baseCommit, targetFiles: ['cold.ts'],
    atomRefs: [{ atomId: 'cold', atomCid: 'cold-v1', operation: 'modify', sourceRange: { filePath: 'cold.ts', lineStart: 1, lineEnd: 2 } }],
    sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: [] }, requestedLane: 'auto'
  });
  const a = makeIntent('CLI-A'); const b = makeIntent('CLI-B');
  const register = async (intent: WriteIntent, ticket?: string) => {
    const file = path.join(root, `${intent.taskId}.json`); writeFileSync(file, JSON.stringify(intent));
    return await broker(['register', '--cwd', root, '--task', intent.taskId, '--actor', intent.actorId, '--intent-file', file,
      ...(ticket ? ['--queue-ticket', ticket] : [])]);
  };
  assert.equal((await register(a)).ok, true);
  const queued = await register(b);
  assert.equal(queued.evidence.admission?.disposition, 'queue');
  assert.equal(queued.evidence.writeAuthorized, false);
  assert.equal(queued.ok, false, 'legacy ok consumers must not interpret a waiting ticket as write admission');
  assert.equal(queued.evidence.serialQueue.position, 1);
  const ticket = queued.evidence.admission.ticket.ticketId;
  const registryPath = path.join(root, '.atm/runtime/write-broker.registry.json');
  const beforeStatus = readFileSync(registryPath, 'utf8');
  const status = await broker(['status', '--cwd', root]);
  assert.equal(status.evidence.serialQueueTickets[0].ticketId, ticket);
  assert.equal(readFileSync(registryPath, 'utf8'), beforeStatus, 'status remains read-only');
  assert.equal(evaluateTaskflowBrokerConflictGate({ cwd: root, taskId: a.taskId, actorId: a.actorId, declaredFiles: ['cold.ts'] }).verdict, 'noConflict',
    'an active head must be able to finish while later tickets wait');
  const privateScope = evaluateBrokerQueueAdmission({ cwd: root, taskId: b.taskId, allowedFiles: ['cold.ts', 'private.md'], overlappingFiles: ['cold.ts'] });
  assert.equal(privateScope.status, 'queued-private-work');
  assert.deepEqual(privateScope.allowedFiles, ['private.md']);
  await assert.rejects(() => runBroker(['release', '--cwd', root, '--task', a.taskId, '--actor', 'foreign']), /SAME_TASK_LANE_FENCE/);
  assert.equal(readFileSync(registryPath, 'utf8'), beforeStatus);
  await assert.rejects(() => runBroker(['release', '--cwd', root, '--task', a.taskId]), /requires --actor/);
  const released = await broker(['release', '--cwd', root, '--task', a.taskId, '--actor', a.actorId]);
  assert.equal(released.evidence.serialQueue.tickets[0].state, 'eligible');
  assert.equal(JSON.parse(readFileSync(registryPath, 'utf8')).activeIntents.length, 0);
  const privateClaim = await registerPreClaimBrokerTransaction({ cwd: root, taskId: b.taskId, actorId: b.actorId, targetFiles: ['private.md'] });
  assert.equal((privateClaim.queueAdmission as { status: string }).status, 'queued-private-work');
  const privateRegistry = JSON.parse(readFileSync(registryPath, 'utf8'));
  assert.deepEqual(privateRegistry.activeIntents[0].resourceKeys.files, ['private.md']);
  assert.deepEqual(privateRegistry.serialQueue.tickets[0].intent.targetFiles, ['cold.ts']);
  assert.equal(evaluateTaskflowBrokerConflictGate({ cwd: root, taskId: b.taskId, actorId: b.actorId, declaredFiles: ['cold.ts'] }).verdict, 'confirmedConflict');
  assert.equal(evaluateTaskflowBrokerConflictGate({ cwd: root, taskId: 'newcomer', actorId: 'newcomer', declaredFiles: ['cold.ts'] }).verdict, 'confirmedConflict');
  await assert.rejects(() => registerPreClaimBrokerTransaction({ cwd: root, taskId: b.taskId, actorId: b.actorId, targetFiles: ['cold.ts'] }),
    (error: { code?: string }) => error.code === 'ATM_NEXT_CLAIM_BLOCKED');
  assert.equal((await register(b)).evidence.admission.disposition, 'revalidate');
  git('commit', '--allow-empty', '-m', 'base advanced');
  assert.equal((await register(b, ticket)).evidence.admission.disposition, 'revalidate');
  const fresh = { ...b, baseCommit: git('rev-parse', 'HEAD') };
  const granted = await register(fresh, ticket);
  assert.equal(granted.evidence.admission.disposition, 'direct');
  assert.equal(granted.evidence.writeAuthorized, true);
  assert.ok(granted.evidence.admission.metrics.queueWaitMs! > 0);
  assert.equal(evaluateTaskflowBrokerConflictGate({ cwd: root, taskId: b.taskId, actorId: b.actorId, declaredFiles: ['cold.ts'] }).verdict, 'noConflict');
  const events = JSON.parse(readFileSync(registryPath, 'utf8')).serialQueue.events;
  assert.deepEqual(events.map((event: { state: string }) => event.state), ['queued', 'eligible', 'granted']);
  await runBroker(['release', '--cwd', root, '--task', b.taskId, '--actor', b.actorId]);
  assert.equal(JSON.parse(readFileSync(registryPath, 'utf8')).serialQueue.tickets[0].state, 'released');
} finally { rmSync(root, { recursive: true, force: true }); }
console.log('test_broker_native_serial_queue_cli_contract: passed');
