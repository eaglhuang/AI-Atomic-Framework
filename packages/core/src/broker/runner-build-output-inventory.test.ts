import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  captureRunnerBuildOutputSnapshot,
  planRunnerPublicationTakeover,
  scanSealedRunnerBuildOutputInventory,
  validateRunnerPublicationTakeoverPlan
} from './runner-build-output-inventory.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-runner-inventory-'));

function git(args: readonly string[]): void {
  execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
}

try {
  git(['init']);
  git(['config', 'user.name', 'fixture']);
  git(['config', 'user.email', 'fixture@example.com']);
  const artifact = path.join(repo, 'release', 'atm-onefile', 'atm.mjs');
  mkdirSync(path.dirname(artifact), { recursive: true });
  writeFileSync(artifact, 'baseline\n');
  git(['add', '.']);
  git(['commit', '-m', 'seed']);

  writeFileSync(artifact, 'foreign-dirty\n');
  const snapshot = captureRunnerBuildOutputSnapshot({
    cwd: repo,
    buildTarget: 'onefile',
    currentTaskId: 'TASK-CURRENT',
    currentTaskAllowedFiles: ['packages/core/src']
  });
  writeFileSync(artifact, 'sealed-build-output\n');
  const inventory = scanSealedRunnerBuildOutputInventory({
    cwd: repo,
    buildTarget: 'onefile',
    sealedSourceSha: 'a'.repeat(40),
    taskId: 'TASK-CURRENT',
    beforeBuildSnapshot: snapshot,
    includeDirtyPublicationMembers: true
  });
  const entry = inventory.entries.find((item) => item.path === 'release/atm-onefile/atm.mjs');
  assert.deepEqual(entry, {
    path: 'release/atm-onefile/atm.mjs',
    disposition: 'unowned',
    ownerTaskId: null,
    ownerActorId: null
  });
  const adoptedInventory = scanSealedRunnerBuildOutputInventory({
    cwd: repo,
    buildTarget: 'onefile',
    sealedSourceSha: 'a'.repeat(40),
    taskId: 'TASK-CURRENT',
    beforeBuildSnapshot: snapshot,
    includeDirtyPublicationMembers: true,
    takeoverPaths: ['release/atm-onefile/atm.mjs']
  });
  assert.deepEqual(adoptedInventory.entries.find((item) => item.path === 'release/atm-onefile/atm.mjs'), {
    path: 'release/atm-onefile/atm.mjs',
    disposition: 'owned-current',
    ownerTaskId: 'TASK-CURRENT',
    ownerActorId: null
  });
  const mixedCaseSnapshot = {
    schemaId: 'atm.runnerBuildOutputSnapshot.v1' as const,
    buildTarget: 'root-drop' as const,
    members: {
      'release/atm-root-drop/atomic_workbench/atoms/ATM-GOV-0001/atom.spec.json': 'sha256:upper',
      'release/atm-root-drop/atomic_workbench/generator-provenance-audit.json': 'sha256:lower'
    },
    preexistingDirtyPaths: [
      'release/atm-root-drop/atomic_workbench/generator-provenance-audit.json',
      'release/atm-root-drop/atomic_workbench/atoms/ATM-GOV-0001/atom.spec.json'
    ]
  };
  const mixedCasePlan = planRunnerPublicationTakeover({
    sealedSourceSha: 'b'.repeat(40),
    snapshot: mixedCaseSnapshot
  });
  assert.equal(
    validateRunnerPublicationTakeoverPlan({
      plan: mixedCasePlan,
      sealedSourceSha: 'b'.repeat(40),
      snapshot: mixedCaseSnapshot
    }).ok,
    true,
    'a broker-authored takeover plan with mixed-case generated paths must validate under the same canonical order'
  );
  console.log('[runner-build-output-inventory] preserves foreign ownership until an exact takeover is supplied');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
