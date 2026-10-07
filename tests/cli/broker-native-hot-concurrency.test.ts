import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { SerialQueueDocument } from '../../packages/core/src/broker/serial-queue/contracts.ts';
import type { WriteIntent } from '../../packages/core/src/broker/types.ts';

const run = promisify(execFile);
const sourceRoot = path.resolve(import.meta.dirname, '../..');
const cli = path.join(sourceRoot, 'packages/cli/src/atm.ts');
const root = mkdtempSync(path.join(os.tmpdir(), 'atm-native-hot-queue-processes-'));
const childEnv = { ...process.env, ATM_ACTOR_ID: '', ATM_LANE_SESSION_ID: '', ATM_PLANNING_REPO_ROOT: '', AGENT_IDENTITY: '' };
let commands = 0;
const startedAt = Date.now();
async function broker(...args: string[]) {
  commands++;
  try {
    const result = await run(process.execPath, ['--strip-types', cli, 'broker', '--cwd', root, ...args, '--json'],
      { cwd: sourceRoot, env: childEnv, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(result.stdout);
  } catch (error) {
    const output = error as { stdout?: string; stderr?: string; code?: unknown };
    const json = output.stdout?.trim() || output.stderr?.trim();
    if (!json) throw error;
    const result = JSON.parse(json);
    return result;
  }
}

try {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  git('commit', '--allow-empty', '-m', 'synthetic fixture');
  const baseCommit = git('rev-parse', 'HEAD');
  const count = 7;
  const intents: WriteIntent[] = Array.from({ length: count + 1 }, (_, index) => ({
    schemaId: 'atm.writeIntent.v1', specVersion: '0.1.0', migration: { strategy: 'none', fromVersion: null, notes: 'bounded native hot queue bench' },
    taskId: `PROCESS-${index}`, actorId: `actor-${index}`, baseCommit, targetFiles: ['counter.txt'],
    atomRefs: [{ atomId: 'counter', atomCid: 'counter-v1', operation: 'modify', sourceRange: { filePath: 'counter.txt', lineStart: 1, lineEnd: 1 } }],
    sharedSurfaces: { generators: [], projections: [], registries: [], validators: [], artifacts: [] }, requestedLane: 'auto',
    proposalAdmission: { trigger: 'hot-file', summarySubmitted: true, hotFiles: ['counter.txt'],
      boundedRegions: [{ filePath: 'counter.txt', lineStart: 1, lineEnd: 1 }] }
  }));
  const files = intents.map((intent) => {
    const file = path.join(root, `${intent.taskId}.json`); writeFileSync(file, JSON.stringify(intent)); return file;
  });
  const register = (index: number, ticket?: string) => broker('register', '--task', intents[index].taskId, '--actor', intents[index].actorId,
    '--intent-file', files[index], ...(ticket ? ['--queue-ticket', ticket] : []));
  const first = await register(0);
  assert.equal(first.ok, true);
  writeFileSync(path.join(root, 'counter.txt'), '1');
  // Seven separate real CLI processes perform one submission each. The only
  // retry is the registry's own CAS implementation, never a harness overlay.
  const submitted = await Promise.all(intents.slice(1).map((_, index) => register(index + 1)));
  assert.ok(submitted.every((result) => result.evidence.admission?.disposition === 'queue'), 'every concurrent hot contender must receive native queue admission');
  const registryPath = path.join(root, '.atm/runtime/write-broker.registry.json');
  const read = () => JSON.parse(readFileSync(registryPath, 'utf8')) as { activeIntents: { taskId: string }[]; serialQueue: SerialQueueDocument };
  const state = read();
  assert.equal(state.activeIntents.length, 1);
  assert.equal(state.serialQueue.tickets.length, count, 'every acknowledged process must retain its ticket');
  const ordered = [...state.serialQueue.tickets].sort((a, b) => a.sequence - b.sequence);
  assert.equal(new Set(ordered.map((ticket) => ticket.sequence)).size, count);
  await broker('release', '--task', intents[0].taskId, '--actor', intents[0].actorId);
  assert.equal(read().activeIntents.length, 0, 'release does not grant any old intent');
  const headIndex = intents.findIndex((intent) => intent.taskId === ordered[0].taskId);
  const tailIndex = intents.findIndex((intent) => intent.taskId === ordered[1].taskId);
  const [headReply, duplicateReply, tailReply] = await Promise.all([
    register(headIndex, ordered[0].ticketId), register(headIndex, ordered[0].ticketId), register(tailIndex, ordered[1].ticketId)
  ]);
  assert.equal(headReply.evidence.admission?.disposition, 'proposal-required');
  assert.equal(duplicateReply.evidence.admission?.disposition, 'proposal-required');
  assert.equal(tailReply.evidence.admission?.disposition, 'queue');
  assert.equal(read().serialQueue.events.filter((event) => event.state === 'granted').length, 1, 'concurrent duplicate resume must grant exactly once');
  assert.deepEqual(read().activeIntents.map((entry) => entry.taskId), [ordered[0].taskId]);
  const waits: number[] = [];
  for (const ticket of ordered) {
    const index = intents.findIndex((intent) => intent.taskId === ticket.taskId);
    const admitted = ticket.ticketId === ordered[0].ticketId ? headReply : await register(index, ticket.ticketId);
    assert.equal(admitted.evidence.admission.disposition, 'proposal-required');
    waits.push(admitted.evidence.admission.metrics.queueWaitMs);
    assert.deepEqual(read().activeIntents.map((entry) => entry.taskId), [ticket.taskId]);
    const counter = path.join(root, 'counter.txt');
    writeFileSync(counter, String(Number(readFileSync(counter, 'utf8')) + 1));
    await broker('release', '--task', ticket.taskId, '--actor', ticket.actorId);
  }
  const final = read();
  assert.equal(Number(readFileSync(path.join(root, 'counter.txt'), 'utf8')), count + 1);
  assert.deepEqual(final.serialQueue.events.filter((event) => event.state === 'granted').map((event) => event.taskId), ordered.map((ticket) => ticket.taskId));
  assert.ok(waits.every((wait) => Number.isFinite(wait) && wait > 0));
  console.log(JSON.stringify({ caseId: 'test_broker_native_hot_queue_multiprocess_cas', passed: true,
    nativeQueueDecisions: count, overlayRetries: 0, cliProcesses: commands, lostWrites: 0,
    completedWriters: count + 1, totalWriters: count + 1, wallMs: Date.now() - startedAt,
    waitP50Ms: [...waits].sort((a, b) => a - b)[Math.floor(waits.length / 2)],
    waitMs: waits, waitP95Ms: [...waits].sort((a, b) => a - b)[Math.ceil(waits.length * 0.95) - 1],
    grantOrder: ordered.map((ticket) => ticket.taskId) }));
} finally { rmSync(root, { recursive: true, force: true }); }
