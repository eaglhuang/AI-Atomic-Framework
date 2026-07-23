import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {
  buildParallelReplayEvidence,
  buildParallelReplayScenario,
  buildSemanticLifecycleReceipt,
  deriveAdmissionFromCanonicalTicket,
  deriveEventDerivedCorrectnessCounters,
  evaluateComposeQueueResidency,
  mergeAppendOnlyEvidenceWrites,
  validatePostComposeSemanticEvidence,
  validateSameFileIntentEvidence,
  validateSemanticLifecycleReceipt
} from '../../packages/core/src/broker/replay/index.ts';

const scenario = buildParallelReplayScenario({
  scenarioId: 'atm-3-fault-injection',
  generatedAt: '2026-07-21T00:00:00.000Z',
  runner: { entrypoint: 'atm.mjs', digest: `sha256:${'a'.repeat(64)}` },
  thresholds: {
    starvationThresholdMs: 30000,
    thresholdSource: 'policy',
    minimumParallelOverlapRatio: 0.3,
    maximumSerializedAdmissionRatio: 0.7
  },
  coverage: { digest: `sha256:${'b'.repeat(64)}` },
  historicalInputs: [],
  failureShapes: []
});
const evidence = buildParallelReplayEvidence({
  scenario,
  workerReceipts: [
    { workerId: 'a', actorId: 'a', processId: 1, startedAtMs: 0, finishedAtMs: 100, runner: scenario.runner, admission: 'parallel', sideEffects: [], exitCode: 0, stdoutDigest: 'sha256:ok', stderrDigest: 'sha256:ok' },
    { workerId: 'b', actorId: 'b', processId: 2, startedAtMs: 10, finishedAtMs: 110, runner: scenario.runner, admission: 'parallel', sideEffects: [], exitCode: 0, stdoutDigest: 'sha256:ok', stderrDigest: 'sha256:ok' }
  ],
  faultCounters: { duplicateSideEffectCount: 1 }
});

assert.equal(evidence.verdict, 'queue-only');
assert.equal(evidence.faultCounters.duplicateSideEffectCount, 1);
assert.equal(evidence.timeInQueueOnlyRatio, 0);

const schema = JSON.parse(readFileSync('schemas/atm.parallel-replay-evidence.v1.schema.json', 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
assert.equal(ajv.validateSchema(schema), true, ajv.errorsText());
assert.equal(ajv.validate(schema, evidence), true, ajv.errorsText());

const acceptedReceipt = buildSemanticLifecycleReceipt({
  step: 'compose',
  commandPurpose: 'compose batch membership',
  taskId: 'TASK-GENERIC-0001',
  actorId: 'actor-a',
  ticketGeneration: 'gen-1',
  sharedSurface: 'packages/example/shared.ts',
  timeWindow: { startedAtMs: 1, finishedAtMs: 2 },
  command: 'node atm.mjs broker compose --json',
  exitCode: 0,
  canonicalEventRef: 'event:compose:1'
});
assert.equal(validateSemanticLifecycleReceipt(acceptedReceipt).verdict, 'accepted');

const malformed = validateSemanticLifecycleReceipt({ schemaId: 'atm.parallelReplayLifecycleReceipt.v1' });
assert.equal(malformed.verdict, 'rejected');
assert.ok(malformed.reasons.includes('unknown-or-missing-lifecycle-step'));

const unrelated = validateSemanticLifecycleReceipt(buildSemanticLifecycleReceipt({
  step: 'admission',
  commandPurpose: 'parallel admission',
  taskId: 'TASK-GENERIC-0001',
  actorId: 'actor-a',
  ticketGeneration: 'gen-1',
  sharedSurface: 'packages/example/shared.ts',
  timeWindow: { startedAtMs: 1, finishedAtMs: 2 },
  command: 'node atm.mjs --version',
  exitCode: 0,
  canonicalEventRef: 'event:weak'
}));
assert.equal(unrelated.verdict, 'rejected');
assert.ok(unrelated.reasons.includes('unrelated-or-weak-command-shape'));
assert.ok(unrelated.invariantCodes.includes('INV-ATM-009'));

const labelOnly = validateSemanticLifecycleReceipt({
  schemaId: 'atm.parallelReplayLifecycleReceipt.v1',
  step: 'close',
  commandPurpose: 'taskflow close',
  taskId: 'TASK-GENERIC-0001',
  actorId: 'actor-a',
  ticketGeneration: null,
  sharedSurface: null,
  digest: `sha256:${'c'.repeat(64)}`,
  timeWindow: { startedAtMs: 1, finishedAtMs: 2 },
  command: '',
  exitCode: 0,
  producerLabel: 'lifecycle-complete'
});
assert.equal(labelOnly.verdict, 'rejected');
assert.ok(labelOnly.reasons.includes('missing-command'));

const contradictoryAdmission = deriveAdmissionFromCanonicalTicket({
  canonicalTicketState: 'not-required',
  callerRequestedParallel: true,
  intersectionNonEmpty: true
});
assert.equal(contradictoryAdmission.admission, 'invalid');
assert.ok(contradictoryAdmission.invariantCodes.includes('INV-ATM-008'));

const pathOnly = validateSameFileIntentEvidence({
  atomOrContentAnchors: [],
  boundedSourceRanges: [],
  adapterIdentity: null,
  adapterDecision: null,
  selectedRequestIds: [],
  queuedRequestIds: [],
  composeBatchMembership: [],
  serializabilityProofDigest: null,
  stewardBeforeHash: null,
  stewardAfterHash: null,
  sharedCommitMemberAttribution: [],
  pathOnlyFileLock: true,
  workerDirectWrite: false,
  detachedWorktreeIsolation: false
});
assert.equal(pathOnly.verdict, 'rejected');
assert.ok(pathOnly.invariantCodes.includes('INV-ATM-010'));

const postComposeFail = validatePostComposeSemanticEvidence({
  candidateOutputDigest: `sha256:${'d'.repeat(64)}`,
  validatorReferences: ['typecheck'],
  sealedSelectionSourceDigest: `sha256:${'e'.repeat(64)}`,
  executable: 'node',
  argv: ['--strip-types', 'tests/example.test.ts'],
  cwd: '.',
  runnerOrBuildDigest: `sha256:${'f'.repeat(64)}`,
  startedAtMs: 1,
  finishedAtMs: 2,
  exitStatus: 1,
  derivedResult: 'fail',
  serializabilityProofPresent: true,
  canonicalWriteAuthorized: true
});
assert.equal(postComposeFail.verdict, 'rejected');
assert.ok(postComposeFail.reasons.includes('canonical-write-without-passing-semantic-validation'));

const safeComposeZeroWait = evaluateComposeQueueResidency({
  disposition: 'compose-selected',
  waitedMs: 0,
  hasCanonicalQueueTransitionEvent: false
});
assert.equal(safeComposeZeroWait.verdict, 'accepted');

const queuedWithoutEvent = evaluateComposeQueueResidency({
  disposition: 'queued',
  waitedMs: 0,
  hasCanonicalQueueTransitionEvent: false
});
assert.equal(queuedWithoutEvent.verdict, 'rejected');

const missingCounters = deriveEventDerivedCorrectnessCounters({});
assert.equal(missingCounters.escapedConflict.status, 'unavailable');
assert.equal(missingCounters.silentOverwrite.status, 'unavailable');
assert.notEqual(missingCounters.escapedConflict.status, 'observed');

const merge = mergeAppendOnlyEvidenceWrites(
  [{ writerId: 'w1', recordId: 'r1', payloadDigest: 'sha256:one', observedAtMs: 1 }],
  [{ writerId: 'w2', recordId: 'r1', payloadDigest: 'sha256:two', observedAtMs: 2 }]
);
assert.equal(merge.verdict, 'accepted');
assert.equal(merge.lostUpdateCount, 0);
assert.equal(merge.records.length, 2);

console.log('[atm-3-parallel-replay-faults.test] ok');
