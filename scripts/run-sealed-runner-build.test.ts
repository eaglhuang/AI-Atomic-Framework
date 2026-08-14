import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncGeneratedArtifacts } from './run-sealed-runner-build.ts';
import { captureSealedRunnerPublicationSnapshot } from './sealed-runner-publication.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-sealed-sync-'));
const source = path.join(root, 'source');
const target = path.join(root, 'target');
const artifact = 'release/atm-onefile/atm.mjs';

try {
  mkdirSync(path.dirname(path.join(source, artifact)), { recursive: true });
  mkdirSync(path.dirname(path.join(target, artifact)), { recursive: true });
  writeFileSync(path.join(source, artifact), 'sealed build bytes\n');
  writeFileSync(path.join(target, artifact), 'foreign dirty bytes\n');

  const result = syncGeneratedArtifacts(source, target, 'onefile', [artifact]);
  assert.deepEqual(result.preservedPaths, [artifact]);
  assert.equal(readFileSync(path.join(target, artifact), 'utf8'), 'foreign dirty bytes\n');
  console.log('[sealed-runner-build] preserves pre-existing generated WIP');
} finally {
  rmSync(root, { recursive: true, force: true });
}

const publicationRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-publication-snapshot-'));
try {
  execFileSync('git', ['init'], { cwd: publicationRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: publicationRoot, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: publicationRoot, stdio: 'ignore' });
  const taskId = 'TASK-PUBLICATION-0001';
  mkdirSync(path.join(publicationRoot, 'release/atm-onefile'), { recursive: true });
  mkdirSync(path.join(publicationRoot, 'packages/cli/dist'), { recursive: true });
  writeFileSync(path.join(publicationRoot, 'package.json'), '{}\n');
  writeFileSync(path.join(publicationRoot, 'release/atm-onefile/atm.mjs'), 'baseline runner\n', { encoding: 'utf8', flag: 'w' });
  writeFileSync(path.join(publicationRoot, 'packages/cli/dist/foreign.js'), 'baseline foreign\n', { encoding: 'utf8', flag: 'w' });
  mkdirSync(path.join(publicationRoot, '.atm/history/tasks'), { recursive: true });
  mkdirSync(path.join(publicationRoot, '.atm/runtime/locks'), { recursive: true });
  writeFileSync(path.join(publicationRoot, `.atm/history/tasks/${taskId}.json`), JSON.stringify({
    workItemId: taskId,
    status: 'running',
    claim: { actorId: 'steward', state: 'active', heartbeatAt: new Date().toISOString(), ttlSeconds: 600, files: ['release/atm-onefile/atm.mjs'] }
  }));
  writeFileSync(path.join(publicationRoot, `.atm/runtime/locks/${taskId}.lock.json`), JSON.stringify({
    workItemId: taskId,
    actorId: 'steward', lockedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(), ttlSeconds: 600, files: ['release/atm-onefile/atm.mjs']
  }));
  execFileSync('git', ['add', '.'], { cwd: publicationRoot, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'fixture'], { cwd: publicationRoot, stdio: 'ignore' });
  writeFileSync(path.join(publicationRoot, 'release/atm-onefile/atm.mjs'), 'task candidate\n');
  writeFileSync(path.join(publicationRoot, 'packages/cli/dist/foreign.js'), 'foreign candidate\n');
  const snapshots = captureSealedRunnerPublicationSnapshot({ cwd: publicationRoot, stewardActorId: 'steward', buildTarget: 'full', publicationTaskId: taskId });
  assert.ok(!snapshots.scopedSnapshot.preexistingDirtyPaths.includes('release/atm-onefile/atm.mjs'), 'own publication surface must be excluded from scoped preservation');
  assert.ok(snapshots.scopedSnapshot.preexistingDirtyPaths.includes('packages/cli/dist/foreign.js'), 'foreign generated output remains in the scoped preservation snapshot');
  assert.ok(snapshots.takeoverSnapshot.preexistingDirtyPaths.includes('release/atm-onefile/atm.mjs'), 'physical takeover snapshot must include current-task generated output');
  assert.ok(snapshots.takeoverSnapshot.preexistingDirtyPaths.includes('packages/cli/dist/foreign.js'), 'physical takeover snapshot must include foreign generated output');
  console.log('[sealed-runner-build] separates scoped preservation from physical takeover snapshots');
} finally {
  rmSync(publicationRoot, { recursive: true, force: true });
}
