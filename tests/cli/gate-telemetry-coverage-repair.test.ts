import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { canonicalGateTelemetryRequiredNodes, emitGateTelemetryEvent } from '../../packages/core/src/telemetry/index.ts';
import { assessObservedNodeCoverage, selectEligibleRuntimeEvents } from '../../packages/core/src/telemetry/observed-coverage.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = mkdtempSync(path.join(os.tmpdir(), 'atm-gate-telemetry-coverage-'));
const completeTmp = mkdtempSync(path.join(os.tmpdir(), 'atm-gate-telemetry-complete-'));

try {
  const coverage = runAtm(['telemetry', '--cwd', tmp, '--coverage-report', '--json']);
  assert.equal(coverage.status, 0, coverage.combined);
  const coverageJson = JSON.parse(coverage.stdout);
  assert.equal(coverageJson.evidence.schemaId, 'atm.gateTelemetryRegistryCoverageReport.v1');
  assert.equal(coverageJson.evidence.rawDataPolicy.runtimeStorage, '.atm/runtime/telemetry/**');
  assert.equal(coverageJson.evidence.rawDataPolicy.rawTelemetryCommitted, false);
  assert.equal(coverageJson.evidence.m2PreflightVerdict, 'inconclusive');
  const unobservedRoute = coverageJson.evidence.requiredNodes.find((node: { nodeId: string }) => node.nodeId === 'next-preflight-guard-doctor');
  assert.equal(unobservedRoute.m2Comparable, false);
  assert.ok(unobservedRoute.missingTelemetry.includes('observedEvents'));

  const families = coverageJson.evidence.requiredNodes.map((node: { nodeFamily: string }) => node.nodeFamily);
  assert.ok(families.includes('claim/reservation/lane presence'));
  assert.ok(families.includes('validator queue/execution/cache/fan-out'));
  assert.ok(families.includes('git governance/pre-commit/pre-push/branch queue'));
  assert.ok(families.includes('telemetry seal/report/self-health'));

  const validator = coverageJson.evidence.requiredNodes.find((node: { nodeFamily: string }) => node.nodeFamily === 'validator queue/execution/cache/fan-out');
  assert.equal(validator.coverageStatus, 'not-yet-covered');
  assert.equal(validator.sourceAvailability, 'partial');
  assert.ok(validator.missingTelemetry.includes('validatorId'));

  const deficientEvent = emitGateTelemetryEvent(tmp, {
    gate: 'next',
    checkId: 'next.route-resolution',
    result: 'block',
    reasonClass: 'block',
    actorId: 'unknown',
    taskId: null,
    laneSessionId: null,
    errorCode: null,
    failureEnvelopeRef: null,
    command: 'next --prompt <redacted>'
  });
  if (!deficientEvent.ok) throw new Error('failed to emit deficient runtime event');
  const deficient = runAtm(['telemetry', '--cwd', tmp, '--coverage-report', '--json']);
  assert.equal(deficient.status, 0, deficient.combined);
  const deficientJson = JSON.parse(deficient.stdout);
  const deficientRoute = deficientJson.evidence.requiredNodes.find((node: { nodeId: string }) => node.nodeId === 'next-preflight-guard-doctor');
  assert.equal(deficientRoute.m2Comparable, false);
  assert.ok(deficientRoute.missingCorrelationKeys.includes('actorId'));
  assert.ok(deficientRoute.missingCorrelationKeys.includes('taskId'));
  assert.ok(deficientRoute.missingCorrelationKeys.includes('laneSessionId'));
  assert.ok(deficientRoute.missingTelemetry.includes('blockReason'));
  assert.ok(deficientRoute.missingTelemetry.includes('blockErrorCode'));
  assert.ok(deficientRoute.missingTelemetry.includes('failureEnvelopeRef'));

  appendFileSync(deficientEvent.path, 'not-json\n', 'utf8');
  emitGateTelemetryEvent(tmp, {
    gate: 'next', checkId: 'next.route-resolution', result: 'pass', source: 'fixture',
    actorId: 'fixture-actor', taskId: 'fixture-task', laneSessionId: 'fixture-lane', command: 'fixture'
  });
  emitGateTelemetryEvent(tmp, {
    gate: 'next', checkId: 'next.route-resolution', result: 'pass', source: 'classification',
    actorId: 'classification-actor', taskId: 'classification-task', laneSessionId: 'classification-lane', command: 'classification'
  });
  emitGateTelemetryEvent(tmp, {
    gate: 'next', checkId: 'next.route-resolution', result: 'pass', eventId: 'duplicate-runtime-event',
    actorId: 'runtime-actor', taskId: 'runtime-task', laneSessionId: 'runtime-lane', command: 'runtime'
  });
  emitGateTelemetryEvent(tmp, {
    gate: 'next', checkId: 'next.route-resolution', result: 'pass', eventId: 'duplicate-runtime-event',
    actorId: 'runtime-actor', taskId: 'runtime-task', laneSessionId: 'runtime-lane', command: 'runtime'
  });
  const audited = runAtm(['telemetry', '--cwd', tmp, '--coverage-report', '--json']);
  assert.equal(audited.status, 0, audited.combined);
  const auditedJson = JSON.parse(audited.stdout);
  assert.equal(auditedJson.evidence.eventSelection.excludedBySource.fixture, 1);
  assert.equal(auditedJson.evidence.eventSelection.excludedBySource.classification, 1);
  assert.equal(auditedJson.evidence.eventSelection.duplicateEventIds, 1);
  assert.equal(auditedJson.evidence.eventSelection.eligibleRuntimeEvents, 2);
  assert.equal(auditedJson.evidence.malformedEvents, 1);
  assert.equal(auditedJson.evidence.m2Comparable, false);
  const malformedRoute = auditedJson.evidence.requiredNodes.find((node: { nodeId: string }) => node.nodeId === 'next-preflight-guard-doctor');
  assert.equal(malformedRoute.m2Comparable, false);
  assert.ok(malformedRoute.missingTelemetry.includes('malformedEvents'));

  const completeRouteEvent = emitGateTelemetryEvent(completeTmp, {
    gate: 'next',
    checkId: 'next.route-resolution',
    result: 'block',
    reasonClass: 'wip-intersection',
    errorCode: 'ATM_NEXT_DIRTY_WIP_INTERSECTION',
    actorId: 'adjudication-fixture-actor',
    taskId: 'TASK-TELEMETRY-FIXTURE-0001',
    laneSessionId: 'telemetry-fixture-lane',
    runId: 'telemetry-fixture-run',
    failureEnvelopeRef: 'fixture:failure-envelope-1',
    command: 'next --prompt <redacted>'
  });
  if (!completeRouteEvent.ok) throw new Error('failed to emit complete runtime event');
  const fixtureEvent = emitGateTelemetryEvent(completeTmp, {
    gate: 'next', checkId: 'next.route-resolution', result: 'pass',
    reasonClass: 'pass', actorId: 'fixture-actor', taskId: 'fixture-task', laneSessionId: 'fixture-lane', command: 'fixture',
    source: 'fixture'
  });
  if (!fixtureEvent.ok) throw new Error('failed to emit fixture event');
  const routeNode = canonicalGateTelemetryRequiredNodes.find((node) => node.nodeId === 'next-preflight-guard-doctor');
  const claimNode = canonicalGateTelemetryRequiredNodes.find((node) => node.nodeId === 'claim-reservation-lane-presence');
  assert.ok(routeNode && claimNode);
  assert.equal(assessObservedNodeCoverage(routeNode, []).m2Comparable, false);
  const selected = selectEligibleRuntimeEvents([
    completeRouteEvent.event,
    fixtureEvent.event,
    { ...completeRouteEvent.event, sequence: completeRouteEvent.event.sequence + 1 },
    { ...completeRouteEvent.event, eventId: '', sequence: completeRouteEvent.event.sequence + 2 }
  ]);
  assert.equal(selected.events.length, 1);
  assert.equal(selected.excludedBySource.fixture, 1);
  assert.equal(selected.duplicateEventIdCount, 1);
  assert.equal(selected.invalidEventIdCount, 1);
  const singleProducerEvent = emitGateTelemetryEvent(completeTmp, {
    gate: 'tasks', checkId: 'tasks.claim-admission', result: 'pass', reasonClass: 'pass',
    actorId: 'adjudication-fixture-actor', taskId: 'TASK-TELEMETRY-FIXTURE-0001', laneSessionId: 'telemetry-fixture-lane',
    runId: 'telemetry-fixture-claim-run', command: 'tasks claim'
  });
  if (!singleProducerEvent.ok) throw new Error('failed to emit single-producer event');
  const completeSingleProducer = assessObservedNodeCoverage(claimNode, [singleProducerEvent.event]);
  assert.equal(completeSingleProducer.m2Comparable, true);
  assert.equal(assessObservedNodeCoverage(claimNode, [singleProducerEvent.event], 1).m2Comparable, false);
  assert.ok(assessObservedNodeCoverage(claimNode, [singleProducerEvent.event], 1).missingTelemetry.includes('malformedEvents'));
  const complete = runAtm(['telemetry', '--cwd', completeTmp, '--coverage-report', '--json']);
  assert.equal(complete.status, 0, complete.combined);
  const completeJson = JSON.parse(complete.stdout);
  const completeRoute = completeJson.evidence.requiredNodes.find((node: { nodeId: string }) => node.nodeId === 'next-preflight-guard-doctor');
  assert.equal(completeRoute.m2Comparable, false);
  assert.deepEqual(completeRoute.observedProducerCheckIds, ['next.route-resolution']);
  assert.deepEqual(completeRoute.missingProducerCheckIds, ['doctor.readiness', 'guard.framework-mode']);
  assert.ok(completeRoute.missingTelemetry.includes('observedProducer:doctor.readiness'));
  const singleProducerNode = completeJson.evidence.requiredNodes.find((node: { nodeId: string }) => node.nodeId === 'claim-reservation-lane-presence');
  assert.equal(singleProducerNode.m2Comparable, true);
  assert.deepEqual(singleProducerNode.observedProducerCheckIds, ['tasks.claim-admission']);
  assert.equal(completeJson.evidence.m2Comparable, false);

  emitGateTelemetryEvent(completeTmp, {
    gate: 'doctor', checkId: 'doctor.readiness', result: 'pass', reasonClass: 'pass',
    actorId: 'adjudication-fixture-actor', taskId: 'TASK-TELEMETRY-FIXTURE-0001', laneSessionId: 'telemetry-fixture-lane',
    runId: 'telemetry-fixture-doctor-run', command: 'doctor'
  });
  emitGateTelemetryEvent(completeTmp, {
    gate: 'guard', checkId: 'guard.framework-mode', result: 'pass', reasonClass: 'pass',
    actorId: 'adjudication-fixture-actor', taskId: 'TASK-TELEMETRY-FIXTURE-0001', laneSessionId: 'telemetry-fixture-lane',
    runId: 'telemetry-fixture-guard-run', command: 'guard'
  });
  const producerComplete = runAtm(['telemetry', '--cwd', completeTmp, '--coverage-report', '--json']);
  assert.equal(producerComplete.status, 0, producerComplete.combined);
  const producerCompleteJson = JSON.parse(producerComplete.stdout);
  const producerCompleteRoute = producerCompleteJson.evidence.requiredNodes.find((node: { nodeId: string }) => node.nodeId === 'next-preflight-guard-doctor');
  assert.equal(producerCompleteRoute.m2Comparable, true);
  assert.deepEqual(completeRoute.missingCorrelationKeys, []);
  assert.deepEqual(producerCompleteRoute.missingTelemetry, []);

  const preflight = runAtm(['telemetry', '--cwd', tmp, '--m2-preflight', '--json']);
  assert.equal(preflight.status, 0, preflight.combined);
  const preflightJson = JSON.parse(preflight.stdout);
  assert.equal(preflightJson.evidence.schemaId, 'atm.gateTelemetryRegistryCoverageReport.v1');
  assert.equal(preflightJson.evidence.m2PreflightVerdict, 'inconclusive');

  const taskSummary = runAtm(['telemetry', '--cwd', tmp, '--task-summary', '--task', 'ATM-GOV-0195', '--role', 'm2-preflight', '--json']);
  assert.equal(taskSummary.status, 0, taskSummary.combined);
  const taskSummaryJson = JSON.parse(taskSummary.stdout);
  assert.equal(taskSummaryJson.evidence.schemaId, 'atm.gateTelemetryTaskSummary.v1');
  assert.equal(taskSummaryJson.evidence.taskId, 'ATM-GOV-0195');
  assert.equal(taskSummaryJson.evidence.baselineOrTreatmentRole, 'm2-preflight');
  assert.equal(taskSummaryJson.evidence.sourceAvailability, 'partial');
  assert.ok(taskSummaryJson.evidence.configDigest.startsWith('sha256:'));
  assert.ok(taskSummaryJson.evidence.historyDigest.startsWith('sha256:'));
} finally {
  rmSync(tmp, { recursive: true, force: true });
  rmSync(completeTmp, { recursive: true, force: true });
}

console.log('ok - tests/cli/gate-telemetry-coverage-repair.test.ts');

function runAtm(args: readonly string[]): { status: number | null; stdout: string; stderr: string; combined: string } {
  const result = spawnSync(process.execPath, ['--strip-types', path.join(root, 'packages', 'cli', 'src', 'atm.ts'), ...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    shell: false,
    env: { ...process.env, NO_COLOR: '1' }
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    combined: `${result.stdout ?? ''}\n--- STDERR ---\n${result.stderr ?? ''}`
  };
}
