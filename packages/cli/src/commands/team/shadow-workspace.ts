import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type TeamShadowWorkspaceProviderPlan = {
  readonly schemaId: 'atm.teamShadowWorkspaceProvider.v1';
  readonly mode: 'ephemeral-detached-worktree';
  readonly shadowOnly: true;
  readonly baseCommit: string;
  readonly isolatedIndexEnv: 'GIT_INDEX_FILE';
  readonly cleanupRequired: true;
  readonly writebackToPrimaryWorktree: false;
};

export type ProvisionedTeamShadowWorkspace = TeamShadowWorkspaceProviderPlan & {
  readonly repoRoot: string;
  readonly tempRoot: string;
  readonly workspacePath: string;
  readonly gitIndexFile: string;
  readonly env: {
    readonly GIT_INDEX_FILE: string;
  };
};

export function createTeamShadowWorkspaceProviderPlan(input: {
  readonly baseCommit: string;
}): TeamShadowWorkspaceProviderPlan {
  return {
    schemaId: 'atm.teamShadowWorkspaceProvider.v1',
    mode: 'ephemeral-detached-worktree',
    shadowOnly: true,
    baseCommit: input.baseCommit,
    isolatedIndexEnv: 'GIT_INDEX_FILE',
    cleanupRequired: true,
    writebackToPrimaryWorktree: false
  };
}

export function provisionTeamShadowWorkspace(input: {
  readonly repoRoot: string;
  readonly baseCommit: string;
  readonly tempRoot?: string;
}): ProvisionedTeamShadowWorkspace {
  const repoRoot = path.resolve(input.repoRoot);
  const tempRoot = input.tempRoot
    ? path.resolve(input.tempRoot)
    : mkdtempSync(path.join(os.tmpdir(), 'atm-team-shadow-'));
  const workspacePath = path.join(tempRoot, 'worktree');
  const gitIndexFile = path.join(tempRoot, 'shadow.index');

  runGit(repoRoot, ['worktree', 'add', '--detach', workspacePath, input.baseCommit]);

  return {
    ...createTeamShadowWorkspaceProviderPlan({ baseCommit: input.baseCommit }),
    repoRoot,
    tempRoot,
    workspacePath,
    gitIndexFile,
    env: {
      GIT_INDEX_FILE: gitIndexFile
    }
  };
}

export function cleanupTeamShadowWorkspace(workspace: Pick<ProvisionedTeamShadowWorkspace, 'repoRoot' | 'tempRoot' | 'workspacePath'>): void {
  if (existsSync(workspace.workspacePath)) {
    try {
      runGit(workspace.repoRoot, ['worktree', 'remove', '--force', workspace.workspacePath]);
    } catch {
      rmSync(workspace.workspacePath, { recursive: true, force: true });
    }
  }
  rmSync(workspace.tempRoot, { recursive: true, force: true });
}

function runGit(cwd: string, args: readonly string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
}
