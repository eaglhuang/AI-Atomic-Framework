import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  checkProposalWorkspaceAccess,
  cleanupTeamProposalWorkspace,
  createTeamProposalWorkspaceProviderPlan,
  normalizeProposalWorkerOutput,
  provisionTeamProposalWorkspace
} from '../../packages/cli/src/commands/team/proposal-workspace.ts';

const tempRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-team-proposal-workspace-test-'));
const repo = path.join(tempRoot, 'repo');

try {
  mkdirSync(path.join(repo, 'src'), { recursive: true });
  writeFileSync(path.join(repo, 'src', 'a.ts'), 'const a = 1;\n');
  writeFileSync(path.join(repo, 'src', 'b.ts'), 'const b = 2;\n');

  const plan = createTeamProposalWorkspaceProviderPlan({
    repoRoot: repo,
    baseCommit: 'base-commit',
    declaredFiles: ['src/a.ts', 'src/b.ts']
  });
  assert.equal(plan.schemaId, 'atm.teamProposalWorkspaceProvider.v1');
  assert.equal(plan.mode, 'bounded-proposal-tree');
  assert.equal(plan.canMutateCanonicalWorktree, false);
  assert.equal(plan.stewardWritePath, true);
  assert.deepEqual(plan.unsupportedGitTopology, ['branch', 'worktree', 'merge', 'rebase', 'alternate-index']);
  assert.equal('branch' in plan, false);
  assert.equal('worktreePath' in plan, false);
  assert.equal('isolatedIndexEnv' in plan, false);
  assert.equal(plan.immutableBaseBlobs.length, 2);
  assert.equal(plan.immutableBaseBlobs.every((blob) => blob.materialized), true);

  const workspace = provisionTeamProposalWorkspace({
    repoRoot: repo,
    baseCommit: 'base-commit',
    declaredFiles: ['src/a.ts']
  });
  try {
    assert.equal(existsSync(path.join(workspace.workspacePath, 'src', 'a.ts')), true);
    assert.equal(existsSync(path.join(workspace.workspacePath, 'src', 'b.ts')), false);
    assert.equal(JSON.parse(readFileSync(workspace.manifestPath, 'utf8')).mode, 'bounded-proposal-tree');
    assert.deepEqual(workspace.env, {});
  } finally {
    cleanupTeamProposalWorkspace(workspace);
  }
  assert.equal(existsSync(workspace.workspacePath), false);

  const access = checkProposalWorkspaceAccess({
    declaredFiles: ['src/a.ts'],
    requestedFiles: ['src/a.ts', 'src/c.ts']
  });
  assert.equal(access.ok, false);
  assert.deepEqual(access.undeclaredFiles, ['src/c.ts']);
  assert.equal(access.queueOnlyRequired, true);

  const mutationRequest = normalizeProposalWorkerOutput({
    taskId: 'ATM-GOV-0248',
    baseCommit: 'base-commit',
    declaredFiles: ['src/a.ts'],
    changedFiles: ['src/a.ts']
  });
  assert.equal(mutationRequest.schemaId, 'atm.teamMutationRequest.v1');
  assert.equal(mutationRequest.access.ok, true);
  assert.equal(mutationRequest.stewardRequired, true);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log('[team-proposal-workspace:test] ok');
