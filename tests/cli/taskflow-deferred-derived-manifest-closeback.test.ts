import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  deferGovernanceDirtyFiles,
  restoreDeferredGovernanceDirtyFiles,
} from '../../packages/cli/src/commands/taskflow/commit-bundle-assembly.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-gov-0418-'));
const repo = path.join(root, 'repo');
mkdirSync(repo, { recursive: true });
const manifest = '.atm/history/evidence/TASK-GOV-0418.bundle-manifest.json';
const manifestPath = path.join(repo, manifest);

function git(...args: string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
}

try {
  git('init', '-q');
  git('config', 'user.email', 'validator@example.invalid');
  git('config', 'user.name', 'ATM Validator');
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  writeFileSync(manifestPath, '{"generation":1}\n', 'utf8');
  git('add', '--', manifest);
  git('commit', '-qm', 'seed manifest');

  writeFileSync(manifestPath, '{"generation":2}\n', 'utf8');
  const deferred = deferGovernanceDirtyFiles(repo, true, 'TASK-GOV-0418');
  assert.equal(deferred.files.length, 1, 'the current task manifest must be deferred');
  assert.equal(JSON.parse(readFileSync(manifestPath, 'utf8')).generation, 1);

  // Evidence refresh during close produces a newer derived manifest.
  writeFileSync(manifestPath, '{"generation":3}\n', 'utf8');
  const restored = restoreDeferredGovernanceDirtyFiles(repo, deferred);

  assert.equal(
    JSON.parse(readFileSync(manifestPath, 'utf8')).generation,
    3,
    'closeback must not restore an older snapshot over a newer derived manifest',
  );
  assert.equal(restored.files[0]?.skipReason, 'newer-content-preserved');
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log('[taskflow-deferred-derived-manifest-closeback.test] ok');
