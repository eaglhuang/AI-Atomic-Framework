import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
const childObservations = new Map<unknown, { exitCode: number | null; signal: string | null; elapsedMs: number }>();

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;
const fixtureTask = (value: unknown) => typeof value === 'string' && /^PROCESS-[0-7]$/.test(value) ? value : 'unknown';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const publicDiagnosticCodes = new Set([
  'ATM_CLI_UNHANDLED', 'ATM_BROKER_REGISTRY_CAS_CONFLICT',
  'ATM_BROKER_REGISTRY_INVALID_JSON', 'ATM_BROKER_REGISTRY_INVALID_SHAPE'
]);

function submissionDiagnostic(value: unknown, task: string) {
  const response = record(value), evidence = record(response.evidence), admission = record(evidence.admission);
  const receipt = record(evidence.transactionReceipt);
  const messages = Array.isArray(response.messages) ? response.messages.map(record) : [];
  const text = messages.map(message => typeof message.text === 'string' ? message.text : '').join('\n');
  const observedCodes = [...new Set(messages.flatMap(message => [
    ...String(message.code ?? '').matchAll(/\bATM_[A-Z0-9_]+\b/g),
    ...String(message.text ?? '').matchAll(/\bATM_[A-Z0-9_]+\b/g)
  ]).map(match => match[0]))];
  const codes = observedCodes.filter(code => publicDiagnosticCodes.has(code));
  return {
    task: fixtureTask(task), child: childObservations.get(value) ?? null, ok: response.ok === true,
    codes, unknownCodeObserved: observedCodes.some(code => !publicDiagnosticCodes.has(code)), storeFailure: text.includes('active compare/write operation') ? 'write-lock-busy'
      : text.includes('CAS rejected stale generation') ? 'stale-generation' : 'unclassified',
    disposition: ['queue', 'direct', 'proposal-required', 'compose', 'revalidate', 'blocked'].includes(String(admission.disposition)) ? admission.disposition : null,
    committed: receipt.status === 'committed' || receipt.status === 'idempotent-replay',
    baseGeneration: finite(receipt.baseGeneration), nextGeneration: finite(receipt.nextGeneration)
  };
}

function registryDiagnostic() {
  // Read only this test's owned synthetic registry. Never dump raw messages,
  // environment, stdout/stderr, paths, lock tokens or private governance data.
  const registryPath = path.join(root, '.atm/runtime/write-broker.registry.json');
  let snapshot: Record<string, unknown> = { readable: false };
  try {
    const raw = readFileSync(registryPath, 'utf8'), doc = record(JSON.parse(raw));
    const queue = record(doc.serialQueue);
    snapshot = { readable: true, sha256: hash(raw), generation: finite(doc.currentEpoch),
      active: (Array.isArray(doc.activeIntents) ? doc.activeIntents : []).map(value => {
        const active = record(value);
        return { task: fixtureTask(active.taskId), leaseEpoch: finite(active.leaseEpoch), expiresAtMs: Number.isFinite(Date.parse(String(active.expiresAt))) ? Date.parse(String(active.expiresAt)) : null };
      }),
      tickets: (Array.isArray(queue.tickets) ? queue.tickets : []).map(value => {
        const ticket = record(value);
        return { task: fixtureTask(ticket.taskId), ticketDigest: typeof ticket.ticketId === 'string' ? hash(ticket.ticketId) : null,
          sequence: finite(ticket.sequence), state: ['queued', 'eligible', 'granted', 'expired', 'cancelled', 'released'].includes(String(ticket.state)) ? ticket.state : null };
      }) };
  } catch { /* Diagnostics must not replace the original queue assertion. */ }
  let lock: Record<string, unknown> = { readable: false };
  try {
    const raw = readFileSync(`${registryPath}.write-lock`, 'utf8'), value = record(JSON.parse(raw));
    lock = { readable: true, sha256: hash(raw), pid: finite(value.pid) };
  } catch { /* A completed writer normally already removed its lock. */ }
  return { registry: snapshot, lock };
}

// The failure summary is an allowlisted projection, never arbitrary child text.
const redactionCanary = 'synthetic-sensitive-value-must-not-appear';
const codeShapedCanary = 'ATM_SECRET_CANARY';
const sanitized = submissionDiagnostic({ messages: [{ code: 'ATM_CLI_UNHANDLED', text: `ATM_BROKER_REGISTRY_CAS_CONFLICT: active compare/write operation ${redactionCanary}`, data: { token: redactionCanary } }, { code: codeShapedCanary, text: codeShapedCanary }] }, 'PROCESS-1');
assert.equal(JSON.stringify(sanitized).includes(redactionCanary), false);
assert.equal(JSON.stringify(sanitized).includes(codeShapedCanary), false);
assert.equal(sanitized.unknownCodeObserved, true);
assert.deepEqual(sanitized.codes, ['ATM_CLI_UNHANDLED', 'ATM_BROKER_REGISTRY_CAS_CONFLICT']);

async function broker(...args: string[]) {
  commands++;
  const childStartedAt = Date.now();
  try {
    const result = await run(process.execPath, ['--strip-types', cli, 'broker', '--cwd', root, ...args, '--json'],
      { cwd: sourceRoot, env: childEnv, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
    const response = JSON.parse(result.stdout);
    childObservations.set(response, { exitCode: 0, signal: null, elapsedMs: Date.now() - childStartedAt });
    return response;
  } catch (error) {
    const output = error as { stdout?: string; stderr?: string; code?: unknown; signal?: unknown };
    const json = output.stdout?.trim() || output.stderr?.trim();
    if (!json) throw error;
    const result = JSON.parse(json);
    childObservations.set(result, { exitCode: finite(output.code), signal: ['SIGTERM', 'SIGKILL', 'SIGABRT'].includes(String(output.signal)) ? String(output.signal) : null, elapsedMs: Date.now() - childStartedAt });
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
  const allQueued = submitted.every((result) => result.evidence.admission?.disposition === 'queue');
  assert.ok(allQueued, allQueued ? 'every concurrent hot contender must receive native queue admission'
    : `every concurrent hot contender must receive native queue admission: ${JSON.stringify({ submissions: submitted.map((value, index) => submissionDiagnostic(value, intents[index + 1].taskId)), ...registryDiagnostic() })}`);
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
