import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runCleanup } from '../../packages/cli/src/commands/cleanup/run.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-push-residue-'));
try {
  execFileSync('git', ['init', '-q'], { cwd: root });
  const directory = path.join(root, '.atm/runtime/git-push-attempts');
  mkdirSync(directory, { recursive: true });
  const cases = [
    { name: 'running', status: 'in-progress', phase: 'admission', keep: true },
    { name: 'failed', status: 'failed', phase: 'host-push', keep: true },
    { name: 'blocked', status: 'blocked', phase: 'admission', keep: true },
    { name: 'success', status: 'pushed', phase: 'complete', keep: false },
    { name: 'retry', status: 'no-op', phase: 'complete', keep: false },
    { name: 'preview', status: 'dry-run', phase: 'complete', keep: false },
    { name: 'incomplete', status: 'pushed', phase: 'host-push', keep: true },
    { name: 'unknown', status: 'unknown', phase: 'complete', keep: true },
  ];
  for (const item of cases) {
    writeFileSync(path.join(directory, `${item.name}.json`), JSON.stringify({
      schemaId: 'atm.gitPushAttemptStatus.v1', actorId: 'fixture',
      status: item.status, phase: item.phase,
    }));
  }
  writeFileSync(path.join(directory, 'malformed.json'), '{');
  const preview = runCleanup(['diagnose', '--cwd', root]);
  assert.equal(preview.ok, true);
  for (const item of cases) assert.equal(existsSync(path.join(directory, `${item.name}.json`)), true);
  assert.equal(runCleanup(['apply', '--cwd', root]).ok, true);
  for (const item of cases) {
    assert.equal(existsSync(path.join(directory, `${item.name}.json`)), item.keep, item.name);
  }
  assert.equal(existsSync(path.join(directory, 'malformed.json')), true);
  assert.equal(runCleanup(['apply', '--cwd', root]).ok, true, 'cleanup retry remains safe');
  console.log('[push-residue-lifecycle] ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
