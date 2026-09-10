import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  durableEvidenceRelativePath,
  runtimeEvidenceBundleRelativePath
} from '../../packages/core/src/evidence/evidence-ledger.ts';
import {
  evidencePathForTask,
  readEvidenceBundle
} from '../../packages/cli/src/commands/evidence/evidence-store.ts';
import { validateProductionEvidenceCallers } from '../../scripts/validate-evidence-ledger-boundary.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-runtime-evidence-boundary-'));

try {
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  writeFileSync(path.join(root, '.gitignore'), '.atm/runtime/\n', 'utf8');
  execFileSync('git', ['add', '.gitignore'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=ATM Test', '-c', 'user.email=atm@example.invalid', 'commit', '--quiet', '-m', 'fixture'], { cwd: root });

  const taskId = 'TASK-BOUNDARY-0001';
  const runtimePath = evidencePathForTask(root, taskId);
  assert.equal(path.relative(root, runtimePath).replace(/\\/g, '/'), runtimeEvidenceBundleRelativePath(taskId));
  mkdirSync(path.dirname(runtimePath), { recursive: true });
  writeFileSync(runtimePath, `${JSON.stringify({ taskId, evidence: [{ summary: 'runtime-only' }] })}\n`, 'utf8');
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }), '');
  assert.deepEqual(readEvidenceBundle(root, taskId).evidence, [{ summary: 'runtime-only' }]);

  rmSync(runtimePath);
  const legacyPath = path.join(root, '.atm', 'history', 'evidence', `${taskId}.json`);
  mkdirSync(path.dirname(legacyPath), { recursive: true });
  writeFileSync(legacyPath, `${JSON.stringify({ taskId, evidence: [{ summary: 'legacy-read-only' }] })}\n`, 'utf8');
  assert.deepEqual(readEvidenceBundle(root, taskId).evidence, [{ summary: 'legacy-read-only' }]);
  assert.equal(durableEvidenceRelativePath(taskId, 'closure-packet'), `.atm/history/evidence/${taskId}.closure-packet.json`);

  const callerReport = validateProductionEvidenceCallers(process.cwd());
  assert.deepEqual(callerReport.illegalReferences, []);
  assert.ok(callerReport.scannedFiles > 3);
  console.log('[runtime-evidence-git-boundary] ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
