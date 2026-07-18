import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-lane-concurrency-'));
const script = path.join(process.cwd(), 'scripts/analyze-captain-parallel-ledger.ts');

function writeJson(relativePath: string, value: unknown): void {
  const absolutePath = path.join(repo, relativePath);
  mkdirSync(path.dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

try {
  writeJson('.atm/history/session-events/lane-a/2026-07-18T00-00-00-000Z-mint.json', {
    schemaId: 'atm.laneSessionEvent.v1',
    eventId: '2026-07-18T00-00-00-000Z-mint-aaaaaaaaaaaa',
    laneId: 'lane-a',
    sequence: 1,
    action: 'mint',
    actorId: 'agent-a',
    createdAt: '2026-07-18T00:00:00.000Z',
    details: { taskId: 'T1' }
  });
  writeJson('.atm/history/session-events/lane-a/2026-07-18T00-00-30-000Z-heartbeat.json', {
    schemaId: 'atm.laneSessionEvent.v1',
    eventId: '2026-07-18T00-00-30-000Z-heartbeat-bbbbbbbbbbbb',
    laneId: 'lane-a',
    sequence: 2,
    action: 'heartbeat',
    actorId: 'agent-a',
    createdAt: '2026-07-18T00:00:30.000Z',
    details: {}
  });
  writeJson('.atm/history/session-events/lane-b/2026-07-18T00-00-10-000Z-mint.json', {
    schemaId: 'atm.laneSessionEvent.v1',
    eventId: '2026-07-18T00-00-10-000Z-mint-cccccccccccc',
    laneId: 'lane-b',
    sequence: 1,
    action: 'mint',
    actorId: 'agent-a',
    createdAt: '2026-07-18T00:00:10.000Z',
    details: { taskId: 'T2' }
  });
  writeJson('.atm/history/session-events/lane-b/2026-07-18T00-00-40-000Z-heartbeat.json', {
    schemaId: 'atm.laneSessionEvent.v1',
    eventId: '2026-07-18T00-00-40-000Z-heartbeat-dddddddddddd',
    laneId: 'lane-b',
    sequence: 2,
    action: 'heartbeat',
    actorId: 'agent-a',
    createdAt: '2026-07-18T00:00:40.000Z',
    details: {}
  });

  const result = spawnSync(process.execPath, [
    '--strip-types',
    script,
    '--event-root', path.join(repo, '.atm/history/task-events'),
    '--session-event-root', path.join(repo, '.atm/history/session-events'),
    '--lock-root', path.join(repo, '.atm/runtime/locks')
  ], {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const parsed = JSON.parse(result.stdout) as {
    laneEvidence: { maxConcurrency: number; overlapMs: number; laneCount: number };
  };
  assert.equal(parsed.laneEvidence.laneCount, 2);
  assert.equal(parsed.laneEvidence.maxConcurrency, 2);
  assert.ok(parsed.laneEvidence.overlapMs > 0);

  console.log('[analyze-captain-parallel-ledger-lane-concurrency] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
