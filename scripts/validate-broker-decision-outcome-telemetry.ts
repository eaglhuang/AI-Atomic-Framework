import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildBrokerDecisionTelemetrySummary,
  classifyBrokerOutcome,
  observeBrokerDecision
} from '../packages/core/src/telemetry/broker/index.ts';

const coreShard = JSON.parse(readFileSync('atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-core.json', 'utf8'));
const cliShard = JSON.parse(readFileSync('atomic_workbench/atomization-coverage/path-to-atom-map-shards/owner-shard-cli.json', 'utf8'));

const coreMapping = coreShard.mappings.find((entry: any) => entry.path_pattern === 'packages/core/src/telemetry/broker/**');
const cliMapping = cliShard.mappings.find((entry: any) => entry.path_pattern === 'packages/cli/src/commands/broker/broker-decision-observation.ts');
assert.equal(coreMapping?.source_task, 'ATM-GOV-0199');
assert.equal(cliMapping?.source_task, 'ATM-GOV-0199');

const dogfood = observeBrokerDecision({
  decisionId: 'dogfood-0199-decision',
  taskId: 'ATM-GOV-0199',
  actorId: 'codex-captain-0199',
  laneSessionId: process.env.ATM_LANE_SESSION_ID ?? 'lane-dogfood-0199',
  runId: process.env.ATM_RUN_ID ?? 'run-dogfood-0199',
  observedAt: '2026-07-20T10:10:00.000Z',
  eligibleOpportunity: true,
  parallelAdmissionMode: 'parallel-first',
  admissionReason: '0211 ticket and 0212 composer produced a compatible batch candidate',
  requestedFiles: ['packages/core/src/telemetry/broker/decision-outcome.ts'],
  conflictSet: ['packages/core/src/telemetry/broker/decision-outcome.ts#atm.brokerDecisionObservation.v1'],
  structuredOverlap: { kind: 'new-telemetry-module', confidence: 1 },
  anchorResolutionRate: 1,
  disposition: 'batch',
  compositionDecision: 'candidate-selected',
  sideEffectAllowance: 'allowed',
  waitedMs: 0,
  latencyMs: 15,
  compose: {
    candidateCount: 1,
    selectedCount: 1,
    skippedCount: 0,
    compositionCostMs: 3,
    savedSerializationDepth: 1,
    serializabilityVerdict: 'pass'
  },
  readWriteSet: {
    readSetDigest: 'sha256:0196-history-config',
    writeSetDigest: 'sha256:0199-broker-telemetry',
    intersectionKind: 'none',
    revalidationResult: 'pass'
  }
});

const outcome = classifyBrokerOutcome({
  decision: dogfood,
  now: '2026-07-20T10:11:00.000Z',
  outcome: {
    outcomeRef: 'dogfood-0199-outcome',
    decisionId: dogfood.decisionId,
    commitSha: 'dogfood-preview',
    fileSlices: ['packages/core/src/telemetry/broker/decision-outcome.ts'],
    validatorRefs: ['node --strip-types tests/cli/broker-decision-outcome-telemetry.test.ts'],
    semanticResult: 'pass',
    serialOracle: 'compatible',
    sideEffectActual: 'applied'
  }
});

const summary = buildBrokerDecisionTelemetrySummary({
  taskId: 'ATM-GOV-0199',
  decisions: [dogfood],
  outcomes: [outcome],
  generatedAt: '2026-07-20T10:12:00.000Z'
});

assert.equal(dogfood.observation.producerId, 'broker.decision-outcome');
assert.equal(outcome.correctness, 'correct');
assert.equal(summary.sourceAvailability, 'available');
assert.equal(summary.correctness.correct, 1);
assert.equal(summary.missingTelemetry.length, 0);
assert.equal(summary.configDigest.startsWith('sha256:'), true);
assert.equal(summary.historyDigest.startsWith('sha256:'), true);

console.log('broker decision outcome telemetry validation ok');
