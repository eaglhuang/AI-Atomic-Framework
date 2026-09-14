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
import {
  assertRepositoryOwnsRuntimeIgnoreRule,
  assertRuntimeLedgerIsNotTracked,
  validateProductionEvidenceCallers
} from '../../scripts/validate-evidence-ledger-boundary.ts';

const root = mkdtempSync(path.join(os.tmpdir(), 'atm-runtime-evidence-boundary-'));

try {
  execFileSync('git', ['init', '--quiet'], { cwd: root });
  const repositoryIgnore = readFileSync(path.join(process.cwd(), '.gitignore'), 'utf8');
  writeFileSync(path.join(root, '.gitignore'), repositoryIgnore, 'utf8');
  writeFileSync(path.join(root, '.git', 'info', 'exclude'), '# local excludes intentionally empty\n', 'utf8');
  execFileSync('git', ['add', '.gitignore'], { cwd: root });
  execFileSync('git', ['-c', 'user.name=ATM Test', '-c', 'user.email=atm@example.invalid', 'commit', '--quiet', '-m', 'fixture'], { cwd: root });

  const taskId = 'TASK-BOUNDARY-0001';
  const runtimePath = evidencePathForTask(root, taskId);
  assert.equal(path.relative(root, runtimePath).replace(/\\/g, '/'), runtimeEvidenceBundleRelativePath(taskId));
  mkdirSync(path.dirname(runtimePath), { recursive: true });
  writeFileSync(runtimePath, `${JSON.stringify({ taskId, evidence: [{ summary: 'runtime-only' }] })}\n`, 'utf8');
  const runtimeClassPaths = [
    '.atm/runtime/evidence-ledger/bundles/example.json',
    '.atm/runtime/evidence-ledger/records/record.json',
    '.atm/runtime/evidence-ledger/work-items/TASK-BOUNDARY-0001.json'
  ];
  for (const relativePath of runtimeClassPaths) {
    mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
    if (relativePath !== path.relative(root, runtimePath).replace(/\\/g, '/')) {
      writeFileSync(path.join(root, relativePath), '{"runtime":true}\n', 'utf8');
    }
  }
  const gitEnvironment = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: path.join(root, 'missing-global-gitconfig')
  };
  for (const relativePath of runtimeClassPaths) {
    assert.equal(execFileSync('git', ['check-ignore', '-q', '--no-index', '--', relativePath], { cwd: root, env: gitEnvironment, encoding: 'utf8' }), '');
    const ignoreSource = execFileSync('git', ['check-ignore', '-v', '--no-index', '--', relativePath], { cwd: root, env: gitEnvironment, encoding: 'utf8' });
    assert.match(ignoreSource, /\.gitignore/);
  }
  assert.equal(execFileSync('git', ['status', '--porcelain'], { cwd: root, env: gitEnvironment, encoding: 'utf8' }), '');
  assert.deepEqual(readEvidenceBundle(root, taskId).evidence, [{ summary: 'runtime-only' }]);

  rmSync(runtimePath);
  const legacyPath = path.join(root, '.atm', 'history', 'evidence', `${taskId}.json`);
  mkdirSync(path.dirname(legacyPath), { recursive: true });
  writeFileSync(legacyPath, `${JSON.stringify({ taskId, evidence: [{ summary: 'legacy-read-only' }] })}\n`, 'utf8');
  assert.deepEqual(readEvidenceBundle(root, taskId).evidence, [{ summary: 'legacy-read-only' }]);
  assert.equal(durableEvidenceRelativePath(taskId, 'closure-packet'), `.atm/history/evidence/${taskId}.closure-packet.json`);

  const trackedLedgerPath = path.join(root, '.atm', 'runtime', 'evidence-ledger', 'records', 'tracked.json');
  mkdirSync(path.dirname(trackedLedgerPath), { recursive: true });
  writeFileSync(trackedLedgerPath, '{}\n', 'utf8');
  execFileSync('git', ['add', '-f', '--', '.atm/runtime/evidence-ledger/records/tracked.json'], { cwd: root });
  assertRepositoryOwnsRuntimeIgnoreRule(root);
  assert.throws(() => assertRuntimeLedgerIsNotTracked(root), /must not be tracked/);
  execFileSync('git', ['reset', '--quiet', '--', '.atm/runtime/evidence-ledger/records/tracked.json'], { cwd: root });

  const callerReport = validateProductionEvidenceCallers(process.cwd());
  assert.deepEqual(callerReport.illegalReferences, []);
  assert.ok(callerReport.scannedFiles > 3);
  console.log('[runtime-evidence-git-boundary] ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
