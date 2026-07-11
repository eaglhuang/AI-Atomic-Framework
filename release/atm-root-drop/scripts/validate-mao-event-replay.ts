import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  advanceBrokerConflictResolution,
  createBrokerConflictResolutionArtifact,
  decideBrokerConflictResolutionAdmission,
  type BrokerConflictDecisionClass,
  type BrokerConflictResolutionArtifact,
  type BrokerConflictViolationStatus
} from '../packages/core/src/team-runtime/permission-broker.ts';

type ReplayTask = {
  readonly taskId: string;
  readonly actorId: string;
  readonly atomId: string;
  readonly sharedPaths: readonly string[];
};

type ReplayFixture = {
  readonly schemaId: 'atm.maoBrokerConflictReplayFixture.v1';
  readonly scenarioId: string;
  readonly sharedVocabulary: readonly string[];
  readonly entryGates: readonly string[];
  readonly tasks: readonly ReplayTask[];
  readonly resolution: {
    readonly decisionClass: BrokerConflictDecisionClass;
    readonly decisionReason: string;
    readonly violationStatus: BrokerConflictViolationStatus;
    readonly releaseOrder: readonly string[];
  };
  readonly expected: {
    readonly initialStatusCode: 'broker-conflict-blocked';
    readonly missingArtifactFailureCode: 'missing-atm.brokerConflictResolution.v1';
    readonly wrongOrderFailureCode: 'resolution-order-ignored';
    readonly finalState: 'green';
  };
};

type ReplayGateResult = {
  readonly entryGate: string;
  readonly taskId: string;
  readonly decisionClass: BrokerConflictDecisionClass;
  readonly decisionReason: string;
  readonly violationStatus: BrokerConflictViolationStatus;
  readonly statusCode: 'broker-conflict-blocked';
};

type ReplayFailure = {
  readonly ok: false;
  readonly failureCode: string;
  readonly finalState: 'red';
};

export type BrokerConflictResolutionReplayResult = {
  readonly ok: true;
  readonly scenarioId: string;
  readonly artifactType: 'atm.brokerConflictResolution.v1';
  readonly initialGates: readonly ReplayGateResult[];
  readonly firstAdmission: ReturnType<typeof decideBrokerConflictResolutionAdmission>;
  readonly prematureSecondAdmission: ReturnType<typeof decideBrokerConflictResolutionAdmission>;
  readonly secondAdmissionAfterFirstRelease: ReturnType<typeof decideBrokerConflictResolutionAdmission>;
  readonly resolvedAdmission: ReturnType<typeof decideBrokerConflictResolutionAdmission>;
  readonly sharedVocabulary: readonly string[];
  readonly finalState: 'green';
};

const FIXTURE_PATH = path.join(
  'scripts',
  'fixtures',
  'mao-event-replay',
  'broker-conflict-resolution.fixture.json'
);

const REQUIRED_SHARED_VOCABULARY = [
  'decisionClass',
  'decisionReason',
  'violationStatus',
  'broker-conflict-blocked'
] as const;

export function loadBrokerConflictResolutionReplayFixture(root = process.cwd()): ReplayFixture {
  const fixturePath = path.join(root, FIXTURE_PATH);
  if (!existsSync(fixturePath)) {
    throw new Error(`missing replay fixture: ${FIXTURE_PATH}`);
  }
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as ReplayFixture;
}

export function runBrokerConflictResolutionReplayFixture(root = process.cwd()): BrokerConflictResolutionReplayResult {
  const fixture = loadBrokerConflictResolutionReplayFixture(root);
  assert.equal(fixture.schemaId, 'atm.maoBrokerConflictReplayFixture.v1');
  assert.equal(fixture.tasks.length, 2, 'replay fixture must model exactly two colliding agents');
  assert.equal(new Set(fixture.tasks.map((task) => task.actorId)).size, 2, 'replay fixture must use two distinct agents');
  assert.equal(new Set(fixture.tasks.map((task) => task.atomId)).size, 1, 'replay fixture must collide on one atom');
  assert.equal(fixture.entryGates.length, 4, 'M8E replay must cover four entry gates');
  assert.deepEqual([...fixture.sharedVocabulary].sort(), [...REQUIRED_SHARED_VOCABULARY].sort());
  assertNoRuntimeResidue(fixture);

  const missingArtifact = replayBrokerConflictResolution(fixture, null);
  assert.equal(missingArtifact.ok, false);
  assert.equal(missingArtifact.failureCode, fixture.expected.missingArtifactFailureCode);

  const primaryTask = fixture.tasks[0]!;
  const conflictingTask = fixture.tasks[1]!;
  const wrongOrderArtifact = createBrokerConflictResolutionArtifact({
    primaryTaskId: primaryTask.taskId,
    conflictingTaskIds: [conflictingTask.taskId],
    sharedPaths: sharedPaths(fixture),
    decisionClass: fixture.resolution.decisionClass,
    decisionReason: fixture.resolution.decisionReason,
    violationStatus: fixture.resolution.violationStatus,
    releaseOrder: [...fixture.resolution.releaseOrder].reverse(),
    createdAt: '2026-07-10T00:00:00.000Z'
  });
  const wrongOrder = replayBrokerConflictResolution(fixture, wrongOrderArtifact);
  assert.equal(wrongOrder.ok, false);
  assert.equal(wrongOrder.failureCode, fixture.expected.wrongOrderFailureCode);

  const artifact = createBrokerConflictResolutionArtifact({
    primaryTaskId: primaryTask.taskId,
    conflictingTaskIds: [conflictingTask.taskId],
    sharedPaths: sharedPaths(fixture),
    decisionClass: fixture.resolution.decisionClass,
    decisionReason: fixture.resolution.decisionReason,
    violationStatus: fixture.resolution.violationStatus,
    releaseOrder: fixture.resolution.releaseOrder,
    createdAt: '2026-07-10T00:00:00.000Z'
  });
  const replay = replayBrokerConflictResolution(fixture, artifact);
  assert.equal(replay.ok, true);
  assert.equal(replay.finalState, fixture.expected.finalState);
  return replay;
}

function replayBrokerConflictResolution(
  fixture: ReplayFixture,
  artifact: BrokerConflictResolutionArtifact | null
): BrokerConflictResolutionReplayResult | ReplayFailure {
  if (!artifact) {
    return {
      ok: false,
      failureCode: 'missing-atm.brokerConflictResolution.v1',
      finalState: 'red'
    };
  }

  const [primaryTask, conflictingTask] = fixture.tasks;
  if (!primaryTask || !conflictingTask) {
    return {
      ok: false,
      failureCode: 'fixture-task-cardinality',
      finalState: 'red'
    };
  }

  if (artifact.schemaId !== 'atm.brokerConflictResolution.v1') {
    return {
      ok: false,
      failureCode: 'wrong-resolution-artifact',
      finalState: 'red'
    };
  }

  if (artifact.releaseOrder.join('|') !== fixture.resolution.releaseOrder.join('|')) {
    return {
      ok: false,
      failureCode: 'resolution-order-ignored',
      finalState: 'red'
    };
  }

  const initialGates = fixture.entryGates.map((entryGate) => ({
    entryGate,
    taskId: conflictingTask.taskId,
    decisionClass: artifact.decisionClass,
    decisionReason: artifact.decisionReason,
    violationStatus: artifact.violationStatus,
    statusCode: artifact.statusCode
  }));
  if (initialGates.some((gate) => gate.statusCode !== fixture.expected.initialStatusCode)) {
    return {
      ok: false,
      failureCode: 'entry-gate-not-blocked',
      finalState: 'red'
    };
  }

  const firstAdmission = decideBrokerConflictResolutionAdmission(artifact, primaryTask.taskId);
  const prematureSecondAdmission = decideBrokerConflictResolutionAdmission(artifact, conflictingTask.taskId);
  if (!firstAdmission.ok || prematureSecondAdmission.ok) {
    return {
      ok: false,
      failureCode: 'initial-release-order-not-enforced',
      finalState: 'red'
    };
  }

  const afterFirstRelease = advanceBrokerConflictResolution(artifact, primaryTask.taskId);
  const secondAdmissionAfterFirstRelease = decideBrokerConflictResolutionAdmission(afterFirstRelease, conflictingTask.taskId);
  if (!secondAdmissionAfterFirstRelease.ok) {
    return {
      ok: false,
      failureCode: 'second-task-not-released',
      finalState: 'red'
    };
  }

  const resolved = advanceBrokerConflictResolution(afterFirstRelease, conflictingTask.taskId);
  const resolvedAdmission = decideBrokerConflictResolutionAdmission(resolved, primaryTask.taskId);
  if (resolved.violationStatus !== 'resolved' || resolvedAdmission.statusCode !== 'resolved') {
    return {
      ok: false,
      failureCode: 'final-state-not-green',
      finalState: 'red'
    };
  }

  return {
    ok: true,
    scenarioId: fixture.scenarioId,
    artifactType: artifact.artifactType,
    initialGates,
    firstAdmission,
    prematureSecondAdmission,
    secondAdmissionAfterFirstRelease,
    resolvedAdmission,
    sharedVocabulary: fixture.sharedVocabulary,
    finalState: 'green'
  };
}

function sharedPaths(fixture: ReplayFixture): string[] {
  return [...new Set(fixture.tasks.flatMap((task) => task.sharedPaths))].sort();
}

function assertNoRuntimeResidue(fixture: ReplayFixture): void {
  const text = JSON.stringify(fixture);
  assert.equal(text.includes('.atm/runtime'), false, 'replay fixture must not depend on live .atm/runtime residue');
}

function getArg(flag: string, argv = process.argv): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function main(argv = process.argv): void {
  const taskCase = getArg('--case', argv) ?? 'broker-conflict-resolution';
  if (taskCase !== 'broker-conflict-resolution') {
    throw new Error(`unsupported or missing --case value: ${taskCase}`);
  }

  const result = runBrokerConflictResolutionReplayFixture(process.cwd());
  assert.equal(result.ok, true);
  process.stdout.write(`[validate-mao-event-replay] ok (${result.scenarioId} ${result.finalState})\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
