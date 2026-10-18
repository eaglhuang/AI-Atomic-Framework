import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { stageTaskCloseArtifacts } from '../../packages/cli/src/commands/tasks/close-helpers/close-artifact-staging.ts';

const cwd = mkdtempSync(path.join(os.tmpdir(), 'atm-close-artifact-isolation-'));
try {
  execFileSync('git', ['init', '--quiet'], { cwd });
  const runtime = '.atm/runtime/evidence-ledger/bundles/TASK-TEST.json';
  const manifest = '.atm/history/evidence/TASK-TEST.bundle-manifest.json';
  const task = '.atm/history/tasks/TASK-TEST.json';
  for (const file of [runtime, manifest, task]) {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    writeFileSync(path.join(cwd, file), '{}\n');
  }
  writeFileSync(path.join(cwd, '.gitignore'), '.atm/runtime/\n');
  stageTaskCloseArtifacts(cwd, [task, runtime, manifest]);
  const staged = execFileSync('git', ['diff', '--cached', '--name-only'], { cwd, encoding: 'utf8' }).trim().split(/\r?\n/);
  assert.deepEqual(staged.sort(), [manifest, task].sort());
  stageTaskCloseArtifacts(cwd, [path.join(cwd, runtime)]);
  assert.equal(execFileSync('git', ['diff', '--cached', '--name-only'], { cwd, encoding: 'utf8' }).includes(runtime), false);
  rmSync(path.join(cwd, manifest));
  assert.throws(() => stageTaskCloseArtifacts(cwd, [runtime]), /without its durable bundle manifest/);
  console.log('close-artifact-runtime-isolation: 3 cases passed');
} finally {
  rmSync(cwd, { recursive: true, force: true, maxRetries: 3 });
}
