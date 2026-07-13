import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runStatus } from '../../packages/cli/src/commands/status.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-status-workers-'));
mkdirSync(path.join(repo, '.atm', 'runtime', 'locks'), { recursive: true });
mkdirSync(path.join(repo, '.atm'), { recursive: true });

writeFileSync(path.join(repo, '.atm', 'config.json'), JSON.stringify({
  schemaVersion: 'atm.config.v0.1',
  adapter: { mode: 'standalone', implemented: false },
  adoption: { profile: 'test' }
}, null, 2));

writeFileSync(path.join(repo, '.atm', 'runtime', 'locks', 'TASK-ACTIVE.lock.json'), JSON.stringify({
  schemaId: 'atm.governanceScopeLock',
  workItemId: 'TASK-ACTIVE',
  actorId: 'captain-a',
  heartbeatAt: '2026-07-13T09:00:00.000Z',
  ttlSeconds: 1800,
  status: 'active',
  files: [
    'packages/cli/src/commands/tasks/import-orchestrator.ts'
  ]
}, null, 2));

writeFileSync(path.join(repo, '.atm', 'runtime', 'locks', 'TASK-RELEASED.lock.json'), JSON.stringify({
  schemaId: 'atm.governanceScopeLock',
  workItemId: 'TASK-RELEASED',
  actorId: 'captain-b',
  heartbeatAt: '2026-07-13T08:00:00.000Z',
  ttlSeconds: 1800,
  status: 'released',
  files: ['docs/governance/backlog.md']
}, null, 2));

const result = runStatus(['--cwd', repo, '--json']) as any;
assert.equal(result.ok, true);

const dashboard = result.evidence.workerDashboard;
assert.equal(dashboard.schemaId, 'atm.activeWorkerDashboard.v1');
assert.equal(dashboard.activeCount, 1);
assert.equal(dashboard.workers[0].taskId, 'TASK-ACTIVE');
assert.equal(dashboard.workers[0].actorId, 'captain-a');
assert.equal(dashboard.workers[0].teamBrokerLevel, 'L5');
assert.match(dashboard.workers[0].teamBrokerReason, /framework runtime|task lifecycle|governance internals/i);
assert.equal(dashboard.workers.some((worker: any) => worker.taskId === 'TASK-RELEASED'), false);

console.log('[status-active-workers:test] ok');
