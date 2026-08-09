import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deriveRunnerBuildOutputInventory } from '../../packages/core/src/broker/runner-build-output-inventory.ts';
import { inspectRunnerPublicationDisposition } from '../../packages/cli/src/commands/framework-development/runner-publication-lifecycle.ts';

const repo = mkdtempSync(path.join(os.tmpdir(), 'atm-g14-publication-'));
const receiptPath = '.atm/history/evidence/TASK-GIT-0022.runner-sync-receipt.json';

function write(relativePath: string, value: string) {
  const absolute = path.join(repo, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, value, 'utf8');
}

try {
  execFileSync('git', ['init', '--quiet'], { cwd: repo });
  const inventory = deriveRunnerBuildOutputInventory({
    sealedSourceSha: '0123456789abcdef0123456789abcdef01234567',
    observedPaths: ['packages/cli/dist/atm.js', 'release/atm-onefile/atm.mjs', receiptPath],
    currentTaskId: 'TASK-GIT-0022'
  });
  write(receiptPath, `${JSON.stringify({ schemaId: 'atm.runnerSyncReceipt.v1', outputInventory: inventory })}\n`);
  write('packages/cli/dist/atm.js', 'dirty build output\n');
  write('.atm/history/evidence/TASK-TMP-0005.residue-reconciliation.json', '{}\n');

  const pending = inspectRunnerPublicationDisposition(repo);
  assert.equal(pending.code, 'ATM_RUNNER_PUBLICATION_PENDING');
  assert.equal(pending.report.disposition, 'publication-pending');
  assert.deepEqual(pending.report.extraOutputPaths, []);

  write('release/atm-onefile/release-manifest.json', '{}\n');
  const foreignWip = inspectRunnerPublicationDisposition(repo);
  assert.equal(foreignWip.code, 'ATM_RUNNER_PUBLICATION_PENDING');
  assert.equal(foreignWip.report.disposition, 'publication-pending');
  assert.deepEqual(foreignWip.report.extraOutputPaths, ['release/atm-onefile/release-manifest.json']);
  console.log('[runner-publication-disposition-gate.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
