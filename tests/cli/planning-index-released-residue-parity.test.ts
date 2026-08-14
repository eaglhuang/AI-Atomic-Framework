import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildHistoricalClosePreflight } from '../../packages/cli/src/commands/taskflow/historical-close-preflight.ts';

const targetDir = path.join(os.tmpdir(), `atm-planning-residue-target-${process.pid}`);
const planningDir = path.join(os.tmpdir(), `atm-planning-residue-planning-${process.pid}`);

function runGit(cwd: string, args: string[]) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function initializeRepository(cwd: string) {
  rmSync(cwd, { recursive: true, force: true });
  mkdirSync(cwd, { recursive: true });
  runGit(cwd, ['init']);
  runGit(cwd, ['config', 'user.name', 'fixture-agent']);
  runGit(cwd, ['config', 'user.email', 'fixture-agent@example.invalid']);
  writeFileSync(path.join(cwd, 'README.md'), 'fixture\n', 'utf8');
  runGit(cwd, ['add', 'README.md']);
  runGit(cwd, ['commit', '-m', 'fixture']);
}

try {
  initializeRepository(targetDir);
  initializeRepository(planningDir);
  const releasedTaskId = 'TASK-RELEASED-0009';
  const releasedPath = `.atm/history/task-events/${releasedTaskId}/close.json`;
  mkdirSync(path.join(planningDir, path.dirname(releasedPath)), { recursive: true });
  writeFileSync(path.join(planningDir, releasedPath), '{"fixture":"released"}\n', 'utf8');
  runGit(planningDir, ['add', releasedPath]);

  const preflight = buildHistoricalClosePreflight({
    cwd: targetDir,
    taskId: 'TASK-CLOSE-0008',
    actorId: 'fixture-agent',
    taskDocument: { workItemId: 'TASK-CLOSE-0008', scopePaths: [], deliverables: [] },
    previewCommitBundle: {
      targetRepo: { repoRoot: targetDir, stageFiles: [] },
      planningRepo: { repoRoot: planningDir, stageFiles: [] }
    },
    historicalDeliveryRefs: [],
    waiverOutOfScopeDelivery: false,
    waiverReason: null
  });

  assert.deepEqual(preflight.unexpectedStagedTasks, [], 'released planning residue must not be reclassified as an active foreign task');
  assert.deepEqual(
    preflight.unexpectedNonBundleStaged.flatMap((entry) => entry.parkableReleasedGovernanceFiles),
    [releasedPath],
    'planning residue must retain its released classification for transactional park-and-restore'
  );
  console.log(JSON.stringify({ marker: '[planning-index-released-residue-parity] ok' }));
} finally {
  rmSync(targetDir, { recursive: true, force: true });
  rmSync(planningDir, { recursive: true, force: true });
}
