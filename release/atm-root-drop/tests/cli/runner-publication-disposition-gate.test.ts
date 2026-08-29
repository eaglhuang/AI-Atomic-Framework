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
  assert.equal(foreignWip.code, 'ATM_RUNNER_PUBLICATION_INVENTORY_INCOMPLETE');
  assert.equal(foreignWip.report.disposition, 'inventory-incomplete');
  assert.deepEqual(foreignWip.report.extraOutputPaths, ['release/atm-onefile/release-manifest.json']);

  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '--quiet', '-m', 'fixture'], { cwd: repo });
  const clean = inspectRunnerPublicationDisposition(repo);
  assert.equal(clean.ok, true, 'a clean checkout must not inherit a historical pending receipt');
  assert.equal(clean.receiptPath, null, 'a receipt is relevant only when it names a currently dirty runner artifact');
  assert.equal(clean.report.disposition, 'published');

  const currentSealedSourceSha = 'fedcba9876543210fedcba9876543210fedcba98';
  const currentReceiptPath = '.atm/history/evidence/TASK-GIT-0023.runner-sync-receipt.json';
  const currentInventory = deriveRunnerBuildOutputInventory({
    sealedSourceSha: currentSealedSourceSha,
    observedPaths: ['packages/cli/dist/atm.js', 'release/atm-onefile/atm.mjs', 'release/atm-onefile/release-manifest.json', currentReceiptPath],
    currentTaskId: 'TASK-GIT-0023'
  });
  write('release/atm-onefile/release-manifest.json', `${JSON.stringify({ sealedSourceCommit: currentSealedSourceSha })}\n`);
  write(currentReceiptPath, `${JSON.stringify({ schemaId: 'atm.runnerSyncReceipt.v1', outputInventory: currentInventory, publicationDisposition: 'published' })}\n`);
  write('packages/cli/dist/atm.js', 'current published build output\n');

  const currentPublication = inspectRunnerPublicationDisposition(repo);
  assert.equal(currentPublication.ok, true, 'a sealed current receipt must win over an older overlapping receipt');
  assert.equal(currentPublication.receiptPath, currentReceiptPath);
  assert.equal(currentPublication.sealedSourceSha, currentSealedSourceSha);
  assert.equal(currentPublication.report.disposition, 'published');
  console.log('[runner-publication-disposition-gate.test] ok');
} finally {
  rmSync(repo, { recursive: true, force: true });
}
