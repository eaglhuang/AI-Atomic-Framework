import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanupStaleTeamRunsForTerminalTasks } from '../../packages/cli/src/commands/team-runtime-cleanup.ts';

const tempDir = mkdtempSync(path.join(os.tmpdir(), 'atm-team-runtime-cleanup-'));

function writeJson(filePath: string, value: unknown) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

try {

  writeJson(path.join(tempDir, '.atm', 'history', 'tasks', 'TASK-DONE-0001.json'), {
    workItemId: 'TASK-DONE-0001',
    status: 'done'
  });
  writeJson(path.join(tempDir, '.atm', 'history', 'tasks', 'TASK-RUNNING-0001.json'), {
    workItemId: 'TASK-RUNNING-0001',
    status: 'running'
  });
  writeJson(path.join(tempDir, '.atm', 'runtime', 'team-runs', 'team-done.json'), {
    schemaId: 'atm.teamRun.v1',
    teamRunId: 'team-done',
    taskId: 'TASK-DONE-0001',
    status: 'active'
  });
  writeJson(path.join(tempDir, '.atm', 'runtime', 'team-runs', 'team-running.json'), {
    schemaId: 'atm.teamRun.v1',
    teamRunId: 'team-running',
    taskId: 'TASK-RUNNING-0001',
    status: 'active'
  });

  const cleaned = cleanupStaleTeamRunsForTerminalTasks({ cwd: tempDir });
  assert.equal(cleaned.length, 1);
  assert.equal(cleaned[0]?.teamRunId, 'team-done');
  assert.equal(cleaned[0]?.terminalTaskStatus, 'done');
  assert.equal(existsSync(path.join(tempDir, '.atm', 'runtime', 'team-runs', 'team-done.json')), false);
  assert.equal(existsSync(path.join(tempDir, '.atm', 'runtime', 'team-runs', 'team-running.json')), true);

  writeJson(path.join(tempDir, '.atm', 'runtime', 'team-runs', 'team-close-path.json'), {
    schemaId: 'atm.teamRun.v1',
    teamRunId: 'team-close-path',
    taskId: 'TASK-CLOSE-0001',
    status: 'active'
  });
  const targeted = cleanupStaleTeamRunsForTerminalTasks({
    cwd: tempDir,
    taskId: 'TASK-CLOSE-0001',
    terminalTaskStatus: 'done'
  });
  assert.equal(targeted.length, 1);
  assert.equal(targeted[0]?.teamRunId, 'team-close-path');
  assert.equal(existsSync(path.join(tempDir, '.atm', 'runtime', 'team-runs', 'team-close-path.json')), false);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
assert.equal(existsSync(tempDir), false, 'test must remove only its uniquely allocated fixture');
