import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-parallel-analyzer-v2-'));
const script = path.join(process.cwd(), 'scripts/analyze-captain-parallel-ledger.ts');

function writeJson(relativePath: string, value: unknown): void {
  const absolutePath = path.join(repo, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

try {
  writeJson('.atm/history/session-events/lane-a/ticket-commit.json', laneEvent('lane-a', 'commit', true, 10));
  writeJson('.atm/history/session-events/lane-b/ticket-build.json', laneEvent('lane-b', 'build', true, 30));
  writeJson('.atm/history/session-events/lane-c/ticket-projection.json', laneEvent('lane-c', 'projection', false, 50));
  writeJson('.atm/history/session-events/lane-c/adopt.json', {
    schemaId: 'atm.laneSessionEvent.v1',
    eventId: 'adopt',
    laneId: 'lane-c',
    sequence: 2,
    action: 'adopt',
    actorId: 'agent-c',
    createdAt: '2026-07-18T00:01:00.000Z',
    details: {}
  });

  const result = spawnSync(process.execPath, [
    '--strip-types',
    script,
    '--event-root', path.join(repo, '.atm/history/task-events'),
    '--session-event-root', path.join(repo, '.atm/history/session-events'),
    '--lock-root', path.join(repo, '.atm/runtime/locks')
  ], { cwd: process.cwd(), encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.autoBatchPipeline.schemaId, 'atm.autoBatchPipelineAnalysis.v1');
  assert.equal(parsed.autoBatchPipeline.evidenceSources.brokerTickets, 3);
  assert.equal(parsed.autoBatchPipeline.metrics.waitedMs.p50, 30);
  assert.equal(parsed.autoBatchPipeline.metrics.waitedMs.p95, 50);
  assert.equal(parsed.autoBatchPipeline.metrics.batchRate, 2 / 3);
  assert.equal(parsed.autoBatchPipeline.metrics.buildsPerWave, 1);
  assert.equal(parsed.autoBatchPipeline.metrics.projectionsPerWave, 1);
  assert.equal(parsed.autoBatchPipeline.metrics.commitsPerWave, 1);
  assert.equal(parsed.autoBatchPipeline.metrics.laneInterventionCount, 1);
  assert.equal(parsed.autoBatchPipeline.failureMatrix.length, 11);
  assert.ok(parsed.autoBatchPipeline.failureMatrix.every((entry: { status: string }) => entry.status === 'observable'));

  console.log('[parallel-analyzer-v2-failure-matrix] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

function laneEvent(laneId: string, surface: string, batchEligible: boolean, waitedMs: number) {
  return {
    schemaId: 'atm.laneSessionEvent.v1',
    eventId: `${laneId}-${surface}`,
    laneId,
    sequence: 1,
    action: 'broker-ticket-enqueued',
    actorId: `agent-${laneId}`,
    createdAt: `2026-07-18T00:00:${String(waitedMs).padStart(2, '0')}.000Z`,
    details: {
      brokerTicket: {
        schemaId: 'atm.brokerTicket.v1',
        ticketId: `${laneId}-${surface}`,
        waveId: 'wave-v2',
        sharedSurface: surface,
        surfaceFamily: `${surface}:cli`,
        batchEligible,
        waitedMs
      }
    }
  };
}
