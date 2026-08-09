import assert from 'node:assert/strict';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { runAtmGit } from '../../packages/cli/src/commands/git-governance.ts';
import { createFixtureRepository, runGit, tempDir, writeJson } from './git-commit-task-scoped-staging/fixture.ts';

try {
  const { taskId, foreignTaskId, scopedFile, sessionId, taskDocument } = await createFixtureRepository();
  const foreignEvidence = `.atm/history/evidence/${foreignTaskId}.json`;
  writeJson(path.join(tempDir, `.atm/history/tasks/${foreignTaskId}.json`), {
    workItemId: foreignTaskId,
    status: 'done',
    claim: { state: 'released' }
  });
  writeJson(path.join(tempDir, foreignEvidence), { taskId: foreignTaskId, evidence: [] });
  writeFileSync(path.join(tempDir, scopedFile), 'export const taskScopedStaging = "released-residue";\n', 'utf8');
  runGit(tempDir, ['add', foreignEvidence]);
  const stagedBefore = runGit(tempDir, ['ls-files', '-s', '--', foreignEvidence]);

  const released = await runAtmGit([
    'commit', '--cwd', tempDir, '--actor', 'fixture-agent', '--task', taskId,
    '--session', sessionId, '--message', 'test: preserve released residue',
    '--auto-stage', '--defer-foreign-staged', '--json'
  ]);
  assert.equal(released.ok, true, JSON.stringify(released.messages));
  assert.equal(
    runGit(tempDir, ['ls-files', '-s', '--', foreignEvidence]),
    stagedBefore,
    'the completed commit transaction must restore the foreign staged blob exactly'
  );
  assert.equal(runGit(tempDir, ['show', '--name-only', '--format=', 'HEAD']).includes(foreignEvidence), false);
  assert.ok((released.evidence as { deferredForeignStagedSnapshotPath?: string }).deferredForeignStagedSnapshotPath, 'the receipt must record the park/restore transaction snapshot');

  writeFileSync(path.join(tempDir, scopedFile), 'export const taskScopedStaging = "active-residue";\n', 'utf8');
  writeJson(path.join(tempDir, `.atm/history/tasks/${foreignTaskId}.json`), { workItemId: foreignTaskId, status: 'running', claim: { state: 'active' } });
  await assert.rejects(
    runAtmGit([
      'commit', '--cwd', tempDir, '--actor', 'fixture-agent', '--task', taskId,
      '--session', sessionId, '--message', 'test: active residue remains protected',
      '--auto-stage', '--defer-foreign-staged', '--json'
    ]),
    (error: { code?: string }) => error.code === 'ATM_GIT_COMMIT_PROTECTED_FOREIGN_STAGED_OWNERSHIP',
    'active foreign residue remains fail-closed'
  );
  console.log('[released-residue-transaction.test] ok');
} finally {
  if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
}
