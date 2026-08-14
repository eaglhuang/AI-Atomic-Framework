import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCleanup } from '../../packages/cli/src/commands/cleanup/run.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-cleanup-lifecycle-'));
try {
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  const foreign = '.atm/history/evidence/TASK-FOREIGN.runner-sync-receipt.json';
  const foreignAbsolute = path.join(root, foreign);
  mkdirSync(path.dirname(foreignAbsolute), { recursive: true });
  mkdirSync(path.join(root, '.atm/runtime/locks'), { recursive: true });
  writeFileSync(foreignAbsolute, '{"foreign":true}\n');
  writeFileSync(path.join(root, '.atm/runtime/locks/TASK-FOREIGN.lock.json'), JSON.stringify({ workItemId: 'TASK-FOREIGN', actorId: 'other-actor', status: 'active' }));

  const diagnose = runCleanup(['diagnose', '--cwd', root]) as any;
  assert.equal(diagnose.ok, true);
  assert.equal(diagnose.evidence.report.entries.some((entry: any) => entry.path === foreign && entry.recommendedAction === 'keep-active-owner'), true);

  const applied = runCleanup(['apply', '--cwd', root]) as any;
  assert.equal(applied.ok, true);
  assert.equal(existsSync(foreignAbsolute), true, 'cleanup apply must never remove foreign active-owner bytes');
  console.log('[transient-artifact-lifecycle] ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
