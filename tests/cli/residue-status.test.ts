import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runResidue } from '../../packages/cli/src/commands/residue.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-residue-status-'));
execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' });
execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: repo });
execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: repo });

mkdirSync(path.join(repo, '.atm', 'history', 'evidence'), { recursive: true });
mkdirSync(path.join(repo, '.atm', 'history', 'tasks'), { recursive: true });
mkdirSync(path.join(repo, '.atm', 'runtime', 'locks'), { recursive: true });
mkdirSync(path.join(repo, '.atm', 'runtime'), { recursive: true });

writeFileSync(path.join(repo, '.atm', 'history', 'evidence', 'TASK-A.bundle-manifest.json'), '{}\n');
writeFileSync(path.join(repo, '.atm', 'history', 'tasks', 'TASK-B.json'), '{}\n');
writeFileSync(path.join(repo, '.atm', 'runtime', 'tmp-status-1234.json'), '{}\n');
writeFileSync(path.join(repo, '.atm', 'runtime', 'locks', 'TASK-A.lock.json'), JSON.stringify({
  workItemId: 'TASK-A',
  actorId: 'worker-a',
  status: 'active',
  heartbeatAt: '2026-07-13T09:00:00.000Z',
  ttlSeconds: 1800,
  files: ['.atm/history/evidence/TASK-A.bundle-manifest.json']
}, null, 2));
writeFileSync(path.join(repo, '.atm', 'runtime', 'locks', 'TASK-B.lock.json'), JSON.stringify({
  workItemId: 'TASK-B',
  actorId: 'worker-b',
  status: 'released',
  heartbeatAt: '2026-07-13T08:00:00.000Z',
  ttlSeconds: 1800,
  files: ['.atm/history/tasks/TASK-B.json']
}, null, 2));

const result = runResidue(['status', '--cwd', repo, '--json']) as any;
assert.equal(result.ok, true);
assert.equal(result.evidence.report.schemaId, 'atm.residueStatusReport.v1');
assert.equal(result.evidence.report.dryRun, true);

const entries = result.evidence.report.entries as any[];
const active = entries.find((entry) => entry.path === '.atm/history/evidence/TASK-A.bundle-manifest.json');
assert(active, 'active owner residue entry must be present');
assert.equal(active.ownerTaskId, 'TASK-A');
assert.equal(active.ownerState, 'active');
assert.equal(active.ownerActorId, 'worker-a');
assert.equal(active.recommendedAction, 'keep-active-owner');

const released = entries.find((entry) => entry.path === '.atm/history/tasks/TASK-B.json');
assert(released, 'released owner residue entry must be present');
assert.equal(released.ownerTaskId, 'TASK-B');
assert.equal(released.ownerState, 'released');
assert.equal(released.recommendedAction, 'manual-review');

const runtimeTmp = entries.find((entry) => entry.path === '.atm/runtime/tmp-status-1234.json');
assert(runtimeTmp, 'runtime tmp residue entry must be present');
assert.equal(runtimeTmp.verdict, 'auto-clean-safe');
assert.equal(runtimeTmp.cleanupAction, 'remove');
assert.equal(runtimeTmp.recommendedAction, 'safe-auto-clean');

console.log('[residue-status:test] ok');
