import assert from 'node:assert/strict';
import {
  buildBrokerDecisionTelemetrySummary,
  classifyBrokerOutcome,
  observeBrokerDecision
} from '../../packages/core/src/telemetry/broker/index.ts';

const baseTime = '2026-07-20T10:00:00.000Z';

const execute = observeBrokerDecision({
  decisionId: 'decision-execute',
  taskId: 'ATM-GOV-0199',
  actorId: 'captain-a',
  laneSessionId: 'lane-a',
  observedAt: baseTime,
  eligibleOpportunity: true,
  parallelAdmissionMode: 'parallel-first',
  admissionReason: 'no structured overlap',
  requestedFiles: ['packages/core/src/a.ts'],
  conflictSet: [],
  structuredOverlap: { kind: 'none', confidence: 1 },
  anchorResolutionRate: 1,
  disposition: 'execute-now',
  sideEffectAllowance: 'allowed',
  latencyMs: 12,
  readWriteSet: { revalidationResult: 'not-required' }
});

const compose = observeBrokerDecision({
  decisionId: 'decision-compose',
  taskId: 'ATM-GOV-0199',
  actorId: 'captain-b',
  laneSessionId: 'lane-b',
  observedAt: '2026-07-20T10:00:01.000Z',
  eligibleOpportunity: true,
  parallelAdmissionMode: 'parallel-first',
  admissionReason: 'content anchors are disjoint inside same file',
  requestedFiles: ['packages/core/src/shared.ts'],
  conflictSet: ['packages/core/src/shared.ts#symbol:A', 'packages/core/src/shared.ts#symbol:B'],
  structuredOverlap: { kind: 'same-file-disjoint-symbol', confidence: 0.93 },
  anchorResolutionRate: 1,
  disposition: 'batch',
  compositionDecision: 'candidate-selected',
  sideEffectAllowance: 'allowed',
  waitedMs: 4,
  latencyMs: 20,
  compose: {
    candidateCount: 2,
    selectedCount: 2,
    compositionCostMs: 8,
    savedSerializationDepth: 1,
    serializabilityVerdict: 'pass'
  },
  readWriteSet: {
    readSetDigest: 'sha256:read',
    writeSetDigest: 'sha256:write',
    intersectionKind: 'disjoint',
    revalidationResult: 'pass'
  }
});

const queue = observeBrokerDecision({
  decisionId: 'decision-queue',
  taskId: 'ATM-GOV-0199',
  actorId: 'captain-c',
  laneSessionId: 'lane-c',
  observedAt: '2026-07-20T10:00:02.000Z',
  eligibleOpportunity: true,
  parallelAdmissionMode: 'parallel-first',
  admissionReason: 'semantic revalidation is pending',
  requestedFiles: ['packages/core/src/shared.ts'],
  conflictSet: ['packages/core/src/shared.ts#same-atom'],
  structuredOverlap: { kind: 'same-atom', confidence: 0.85 },
  anchorResolutionRate: 0.9,
  disposition: 'queue',
  compositionDecision: 'candidate-skipped',
  fallbackReason: 'semantic revalidation pending',
  sideEffectAllowance: 'deferred',
  waitedMs: 90,
  queue: { depth: 3, position: 2, agingMs: 1200, bypassCount: 1, wakeupKey: 'wake-shared' },
  readWriteSet: { intersectionKind: 'same-atom', revalidationResult: 'pending' }
});

const r1 = observeBrokerDecision({
  decisionId: 'decision-r1',
  taskId: 'ATM-GOV-0199',
  actorId: 'captain-d',
  observedAt: '2026-07-20T10:00:03.000Z',
  eligibleOpportunity: false,
  parallelAdmissionMode: 'policy-pre-serialize',
  admissionReason: 'same task second lane is owner-ruled hard reject',
  conflictAxes: ['task-owner'],
  disposition: 'hard-reject',
  sideEffectAllowance: 'blocked',
  rulingClass: 'R1-same-task-owner'
});

const falsePositive = observeBrokerDecision({
  decisionId: 'decision-false-positive',
  taskId: 'ATM-GOV-0199',
  actorId: 'captain-e',
  observedAt: '2026-07-20T10:00:04.000Z',
  eligibleOpportunity: true,
  parallelAdmissionMode: 'surface-cannot-parallel',
  admissionReason: 'legacy surface reported non parallel',
  disposition: 'queue',
  sideEffectAllowance: 'deferred',
  waitedMs: 250
});

const escaped = observeBrokerDecision({
  decisionId: 'decision-escaped',
  taskId: 'ATM-GOV-0199',
  actorId: 'captain-f',
  observedAt: '2026-07-20T10:00:05.000Z',
  eligibleOpportunity: true,
  parallelAdmissionMode: 'parallel-first',
  admissionReason: 'anchors appeared disjoint',
  disposition: 'execute-now',
  sideEffectAllowance: 'allowed'
});

const classifications = [
  classifyBrokerOutcome({
    decision: execute,
    now: '2026-07-20T10:01:00.000Z',
    outcome: {
      outcomeRef: 'outcome-execute',
      decisionId: execute.decisionId,
      commitSha: 'abc123',
      fileSlices: ['packages/core/src/a.ts'],
      validatorRefs: ['node --strip-types tests/cli/broker-decision-outcome-telemetry.test.ts'],
      semanticResult: 'pass',
      serialOracle: 'compatible',
      sideEffectActual: 'applied'
    }
  }),
  classifyBrokerOutcome({
    decision: compose,
    now: '2026-07-20T10:01:00.000Z',
    outcome: {
      outcomeRef: 'outcome-compose',
      decisionId: compose.decisionId,
      commitSha: 'def456',
      fileSlices: ['packages/core/src/shared.ts#A', 'packages/core/src/shared.ts#B'],
      validatorRefs: ['npm run typecheck'],
      semanticResult: 'pass',
      serialOracle: 'compatible',
      sideEffectActual: 'applied'
    }
  }),
  classifyBrokerOutcome({
    decision: queue,
    now: '2026-07-20T10:01:00.000Z',
    outcome: {
      outcomeRef: 'outcome-queue',
      decisionId: queue.decisionId,
      semanticResult: 'fail',
      serialOracle: 'incompatible',
      sideEffectActual: 'blocked'
    }
  }),
  classifyBrokerOutcome({
    decision: r1,
    now: '2026-07-20T10:01:00.000Z',
    outcome: {
      outcomeRef: 'outcome-r1',
      decisionId: r1.decisionId,
      semanticResult: 'unknown',
      serialOracle: 'unknown',
      sideEffectActual: 'blocked'
    }
  }),
  classifyBrokerOutcome({
    decision: falsePositive,
    now: '2026-07-20T10:01:00.000Z',
    outcome: {
      outcomeRef: 'outcome-false-positive',
      decisionId: falsePositive.decisionId,
      semanticResult: 'pass',
      serialOracle: 'compatible',
      sideEffectActual: 'deferred'
    }
  }),
  classifyBrokerOutcome({
    decision: escaped,
    now: '2026-07-20T10:01:00.000Z',
    outcome: {
      outcomeRef: 'outcome-escaped',
      decisionId: escaped.decisionId,
      commitSha: 'bad999',
      fileSlices: ['packages/core/src/shared.ts'],
      validatorRefs: ['npm run typecheck'],
      downstreamIncidentRefs: ['incident-escaped-conflict'],
      semanticResult: 'pass',
      serialOracle: 'compatible',
      sideEffectActual: 'applied'
    }
  })
];

const pending = classifyBrokerOutcome({
  decision: queue,
  now: '2026-07-22T10:00:02.000Z',
  pendingThresholdMs: 60_000,
  backlogExit: 'ATM-BUG-2026-07-19-036'
});

const summary = buildBrokerDecisionTelemetrySummary({
  taskId: 'ATM-GOV-0199',
  decisions: [execute, compose, queue, r1, falsePositive, escaped],
  outcomes: [...classifications, pending],
  generatedAt: '2026-07-20T10:02:00.000Z'
});

assert.equal(execute.observation.schemaId, 'atm.telemetryObservation.v1');
assert.equal(execute.observation.producerId, 'broker.decision-outcome');
assert.equal(execute.observation.status, 'canonical');
assert.equal(execute.observation.storagePolicy, 'runtime-raw-tracked-digest');
assert.equal(execute.redactedConflictDigest.startsWith('sha256:'), true);
assert.equal(compose.compositionDecision, 'candidate-selected');
assert.equal(queue.disposition, 'queue');
assert.equal(queue.queue.position, 2);
assert.equal(r1.rulingClass, 'R1-same-task-owner');
assert.equal(classifications[4].correctness, 'false-positive');
assert.equal(classifications[5].correctness, 'escaped');
assert.equal(pending.correctness, 'pending');
assert.equal(pending.pendingEscalation.escalated, true);
assert.equal(summary.eligibleOpportunities, 5);
assert.equal(summary.parallelAdmission['parallel-first'], 4);
assert.equal(summary.dispositions.batch, 1);
assert.equal(summary.correctness.correct, 4);
assert.equal(summary.correctness['false-positive'], 1);
assert.equal(summary.correctness.escaped, 1);
assert.equal(summary.correctness.pending, 1);
assert.equal(summary.pendingNotCountedAsSuccess, true);
assert.equal(summary.composition.savedSerializationDepth, 1);
assert.equal(summary.queue.waitedMsP95, 250);

const failOpen = observeBrokerDecision({
  decisionId: 'decision-secret',
  taskId: 'ATM-GOV-0199',
  actorId: 'captain-secret',
  eligibleOpportunity: true,
  parallelAdmissionMode: 'parallel-first',
  admissionReason: 'secret redaction canary',
  requestedFiles: ['token=secret-value'],
  disposition: 'execute-now',
  sideEffectAllowance: 'allowed'
});

assert.equal(failOpen.sourceAvailability, 'partial');
assert.equal(failOpen.warnings.length, 1);

console.log('broker decision outcome telemetry ok');
