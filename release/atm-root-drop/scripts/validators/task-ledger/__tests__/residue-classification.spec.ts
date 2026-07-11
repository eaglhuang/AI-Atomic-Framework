import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateTaskResidueClassification } from '../residue-classification.ts';
import { makeFrameworkRepo, initGitRepo, writeJson } from '../../../lib/task-ledger-fixture-builder.ts';

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-residue-spec-'));
try {
  await validateTaskResidueClassification(tempRoot);

  const repo = makeFrameworkRepo(tempRoot);
  initGitRepo(repo);
  writeJson(path.join(repo, '.atm', 'history', 'tasks', 'TASK-RESIDUE-SPEC-0001.json'), {
    schemaVersion: 'atm.workItem.v0.2',
    workItemId: 'TASK-RESIDUE-SPEC-0001',
    title: 'residue boundary',
    status: 'done',
    planningRepo: '3KLife',
    targetRepo: 'AI-Atomic-Framework',
    closureAuthority: 'target_repo'
  });
  assert.equal(typeof validateTaskResidueClassification, 'function');
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[residue-classification.spec] ok');
