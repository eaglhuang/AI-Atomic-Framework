import assert from 'node:assert/strict';
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
  writeFileSync(path.join(repo, 'tracked.txt'), 'base\n');

  const plan = createTeamShadowWorkspaceProviderPlan({
    repoRoot: repo,
    baseCommit: 'base-commit',
    declaredFiles: ['tracked.txt']
  });
  assert.equal(plan.schemaId, 'atm.teamProposalWorkspaceProvider.v1');
  assert.equal(plan.mode, 'bounded-proposal-tree');
  assert.equal(plan.canMutateCanonicalWorktree, false);
  assert.equal(plan.stewardWritePath, true);
  assert.equal('isolatedIndexEnv' in plan, false);

  const workspace = provisionTeamShadowWorkspace({
    repoRoot: repo,
    baseCommit: 'base-commit',
    declaredFiles: ['tracked.txt']
  });
  try {
    assert.equal(existsSync(path.join(workspace.workspacePath, 'tracked.txt')), true);
    assert.deepEqual(workspace.env, {});
    writeFileSync(path.join(workspace.workspacePath, 'shadow-only.txt'), 'shadow\n');
    assert.equal(existsSync(path.join(repo, 'shadow-only.txt')), false);
  } finally {
    cleanupTeamShadowWorkspace(workspace);
  }
  assert.equal(existsSync(workspace.workspacePath), false);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[team-shadow-workspace:test] ok');
