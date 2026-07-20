import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildGateTelemetryTaskSummary,
  emitGateTelemetryEvent,
  gateTelemetryRuntimeRelativePath,
  reportGateTelemetry,
  sealGateTelemetry
} from '../../packages/core/src/telemetry/index.ts';
import {
  inspectLaneSessionSweep,
  mintLaneSession,
  sweepLaneSessions
} from '../../packages/cli/src/commands/lane-session/store.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-runtime-telemetry-boundary-'));

try {
  const emitted = emitGateTelemetryEvent(repo, {
    gate: 'next',
    checkId: 'next.route-resolution',
    result: 'pass',
    reasonClass: 'runtime-boundary',
    durationMs: 9,
    actorId: 'boundary-actor',
    taskId: 'ATM-GOV-0197',
    runId: 'run-boundary',
    laneSessionId: 'lane-boundary',
    correlationId: 'corr-boundary',
    evidenceReadRef: '.atm/history/evidence/ATM-GOV-0196.seal-and-commit.json',
    command: 'telemetry boundary fixture'
  });
  assert.equal(emitted.ok, true);
  assert.match(emitted.path, new RegExp(`${escapeRegExp(gateTelemetryRuntimeRelativePath)}[\\\\/]gate-events`));

  const seal = sealGateTelemetry(repo, {
    taskId: 'ATM-GOV-0197',
    windowId: 'runtime-boundary',
    watermark: '2999-01-01T00:00:00.000Z'
  });
  assert.equal(seal.schemaId, 'atm.gateTelemetrySealDigest.v1');
  assert.equal(seal.storagePolicy, 'runtime-raw-tracked-digest');
  assert.equal(seal.sourceAvailability, 'available');
  assert.equal(seal.runtimeLocator.root, '.atm/runtime/telemetry/gate-events');
  assert.equal(seal.eventCount, 1);
  assert.equal(seal.aggregates['next.route-resolution'].durationP50, 9);
  assert.deepEqual(seal.correlation.runIds, ['run-boundary']);

  const compactPath = path.join(repo, seal.historyPath);
  const compactReceiptText = readFileSync(compactPath, 'utf8');
  assert.match(compactReceiptText, /"rawEventDigest": "sha256:/);
  assert.match(compactReceiptText, /"runtimeLocator":/);
  assert.doesNotMatch(compactReceiptText, /"specVersion":"atm.gateTelemetry.v1"/);
  assert.equal(existsSync(path.join(repo, '.atm/history/telemetry')), false);

  const report = reportGateTelemetry(repo);
  assert.equal(report.eventCount, 1);
  assert.equal(report.byCheckId['next.route-resolution'].resultCounts.pass, 1);
  assert.equal(report.byCheckId['next.route-resolution'].evidenceReadbacks, 1);

  const summary = buildGateTelemetryTaskSummary(repo, {
    taskId: 'ATM-GOV-0197',
    role: 'treatment'
  });
  assert.deepEqual(summary.correlation.laneSessionIds, ['lane-boundary']);
  assert.equal(summary.evidenceReadbacks, 1);

  const missingSourceRepo = mkdtempSync(path.join(os.tmpdir(), 'atm-runtime-telemetry-missing-source-'));
  const missingSourceSeal = sealGateTelemetry(missingSourceRepo, {
    taskId: 'ATM-GOV-0197',
    windowId: 'missing-runtime',
    watermark: '2999-01-01T00:00:00.000Z'
  });
  assert.equal(missingSourceSeal.sourceAvailability, 'unavailable');
  rmSync(missingSourceRepo, { recursive: true, force: true });

  mintLaneSession({
    cwd: repo,
    actorId: 'boundary-actor',
    taskId: 'ATM-GOV-0197',
    laneId: 'lane-stale-boundary',
    ttlMs: 1,
    timestamp: '2026-07-20T00:00:00.000Z',
    status: 'active'
  });
  mintLaneSession({
    cwd: repo,
    actorId: 'boundary-actor',
    taskId: 'ATM-GOV-0197',
    laneId: 'lane-closed-boundary',
    ttlMs: 1,
    timestamp: '2026-07-20T00:00:00.000Z',
    status: 'released'
  });
  const inspected = inspectLaneSessionSweep({
    cwd: repo,
    now: '2026-07-20T00:00:10.000Z'
  });
  assert.equal(inspected.staleCount, 1);
  assert.equal(inspected.entries.find((entry) => entry.laneId === 'lane-closed-boundary')?.reason, 'already-closed');
  const swept = sweepLaneSessions({
    cwd: repo,
    now: '2026-07-20T00:00:10.000Z',
    write: true
  });
  assert.equal(swept.sweptCount, 1);
  assert.equal(swept.sweptSessions[0]?.status, 'expired');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

console.log('[runtime-telemetry-boundary.test] ok');

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
