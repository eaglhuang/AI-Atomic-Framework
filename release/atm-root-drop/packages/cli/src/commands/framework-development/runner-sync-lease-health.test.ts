import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveRunnerSyncLeaseHealth } from './runner-sync-lease-health.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-runner-sync-lease-'));
const taskId = 'TASK-GOV-0001';
const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
mkdirSync(path.dirname(taskPath), { recursive: true });
writeFileSync(taskPath, JSON.stringify({ status: 'running', claim: { state: 'active', heartbeatAt: '2026-08-09T00:00:00.000Z', ttlSeconds: 60 } }), 'utf8');
assert.equal(resolveRunnerSyncLeaseHealth(cwd, taskId, Date.parse('2026-08-09T00:00:30.000Z')), 'task-active');
assert.equal(resolveRunnerSyncLeaseHealth(cwd, taskId, Date.parse('2026-08-09T00:01:01.000Z')), 'task-lease-expired');
writeFileSync(taskPath, JSON.stringify({ status: 'running' }), 'utf8');
assert.equal(resolveRunnerSyncLeaseHealth(cwd, taskId, Date.parse('2026-08-09T00:01:01.000Z')), 'task-active');
console.log('runner-sync-lease-health: ok');
