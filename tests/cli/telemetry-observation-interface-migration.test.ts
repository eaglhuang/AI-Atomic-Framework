import assert from 'node:assert/strict';
import {
  buildTelemetryObservation,
  telemetryObservationProducerInventory
} from '../../packages/core/src/telemetry/index.ts';
import {
  normalizeCommandRunInput,
  normalizeEvidenceCommandRuns
} from '../../packages/cli/src/commands/evidence/command-runs.ts';

const stdoutSha256 = `sha256:${'1'.repeat(64)}`;
const stderrSha256 = `sha256:${'2'.repeat(64)}`;

const run = normalizeCommandRunInput({
  command: 'npm run typecheck',
  cwd: '.',
  exitCode: 0,
  stdoutSha256,
  stderrSha256,
  validators: ['npm run typecheck'],
  runnerKind: 'atm.mjs',
  generatedAt: '2026-07-20T07:00:00.000Z',
  startedAt: '2026-07-20T07:00:01.000Z',
  finishedAt: '2026-07-20T07:00:03.500Z',
  durationMs: '2500',
  cacheKey: 'sha256:cache',
  cached: true
}, 'canary');

assert.equal(run.durationMs, 2500);
assert.equal(run.runnerKind, 'frozen-runner');
assert.equal(run.canonicalObservation?.schemaId, 'atm.telemetryObservation.v1');
assert.equal(run.canonicalObservation?.producerId, 'evidence.command-runs');
assert.equal(run.canonicalObservation?.observationKind, 'command-run');
assert.equal(run.canonicalObservation?.status, 'canonical');
assert.equal(run.canonicalObservation?.storagePolicy, 'tracked-compact-digest');
assert.equal(run.canonicalObservation?.sourceAvailability, 'available');
assert.equal(run.canonicalObservation?.durationMs, 2500);
assert.equal(run.canonicalObservation?.cache?.hit, true);
assert.equal(run.canonicalObservation?.extensions?.runnerKind, 'frozen-runner');

const normalized = normalizeEvidenceCommandRuns({
  cwd: process.cwd(),
  inlineRun: run,
  fileRuns: [],
  runnerKind: 'atm.mjs',
  sourceCommit: 'abc123'
});

assert.equal(normalized.length, 1);
assert.equal(normalized[0]?.canonicalObservation?.producerId, 'evidence.command-runs');
assert.equal(normalized[0]?.canonicalObservation?.observationId, normalized[0]?.cacheKey);
assert.equal(normalized[0]?.canonicalObservation?.inputDigest?.startsWith('sha256:'), true);
assert.equal(normalized[0]?.canonicalObservation?.outputDigest?.startsWith('sha256:'), true);

const synthetic = buildTelemetryObservation({
  observationId: 'obs-test',
  producerId: 'test.producer',
  observationKind: 'unit-test',
  source: 'test',
  timing: { durationMs: 12 },
  correlation: { actorId: 'validator', taskId: 'ATM-GOV-0205' }
});

assert.equal(synthetic.schemaId, 'atm.telemetryObservation.v1');
assert.ok(synthetic.observedAt);
assert.equal(synthetic.observedAt.length > 0, true);
assert.equal(synthetic.durationMs, 12);
assert.equal(synthetic.taskId, 'ATM-GOV-0205');

const inventory = new Map(telemetryObservationProducerInventory.map((entry) => [entry.producerId, entry]));
assert.equal(inventory.get('evidence.command-runs')?.status, 'canonical');
assert.equal(inventory.get('gate.telemetry-events')?.status, 'adapter-backed');
assert.equal(inventory.get('validator.lifecycle')?.ownerTaskId, 'ATM-GOV-0200');
assert.equal(inventory.get('runner.incremental-build')?.ownerTaskId, 'ATM-GOV-0201');
assert.equal(inventory.get('broker.decision-outcome')?.ownerTaskId, 'ATM-GOV-0199');
assert.equal(inventory.get('plan-executor.phase')?.ownerTaskId, 'ATM-GOV-0198');
assert.equal(inventory.get('test-runner.timing')?.status, 'legacy-readable');

console.log('telemetry observation interface migration canary ok');
