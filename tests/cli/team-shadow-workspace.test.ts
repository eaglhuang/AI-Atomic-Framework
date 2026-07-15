import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  cleanupTeamShadowWorkspace,
  createTeamShadowWorkspaceProviderPlan,
  provisionTeamShadowWorkspace
} from '../../packages/cli/src/commands/team/shadow-workspace.ts';

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-team-shadow-workspace-test-'));
const repo = path.join(tempRoot, 'repo');

try {
  mkdirSync(repo, { recursive: true });
  runGit(repo, ['init']);
  runGit(repo, ['config', 'user.email', 'atm@example.test']);
  runGit(repo, ['config', 'user.name', 'ATM Test']);
  writeFileSync(path.join(repo, 'tracked.txt'), 'base\n');
  runGit(repo, ['add', 'tracked.txt']);
  runGit(repo, ['commit', '-m', 'base']);

  const baseCommit = runGit(repo, ['rev-parse', 'HEAD']);
  const plan = createTeamShadowWorkspaceProviderPlan({ baseCommit });
  assert.equal(plan.schemaId, 'atm.teamShadowWorkspaceProvider.v1');
  assert.equal(plan.shadowOnly, true);
  assert.equal(plan.writebackToPrimaryWorktree, false);
  assert.equal(plan.isolatedIndexEnv, 'GIT_INDEX_FILE');

  const workspace = provisionTeamShadowWorkspace({ repoRoot: repo, baseCommit });
  try {
    assert.equal(existsSync(workspace.workspacePath), true);
    assert.equal(runGit(workspace.workspacePath, ['rev-parse', 'HEAD']), baseCommit);
    assert.equal(workspace.env.GIT_INDEX_FILE, workspace.gitIndexFile);
    assert.equal(path.dirname(workspace.gitIndexFile), workspace.tempRoot);

    writeFileSync(path.join(workspace.workspacePath, 'shadow-only.txt'), 'shadow\n');
    execFileSync('git', ['add', 'shadow-only.txt'], {
      cwd: workspace.workspacePath,
      env: { ...process.env, ...workspace.env },
      stdio: 'pipe'
    });
    assert.equal(existsSync(workspace.gitIndexFile), true);
    assert.equal(runGit(repo, ['status', '--short']), '');
  } finally {
    cleanupTeamShadowWorkspace(workspace);
  }
  assert.equal(existsSync(workspace.workspacePath), false);
  assert.equal(existsSync(workspace.tempRoot), false);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[team-shadow-workspace:test] ok');

function runGit(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}
