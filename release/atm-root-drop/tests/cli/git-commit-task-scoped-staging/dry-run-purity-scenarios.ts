import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  assertDryRunReachedNoExecutor,
  resolveDryRunPurity
} from '../../../packages/cli/src/commands/git-governance/implementation/dry-run-purity.ts';

/**
 * ATM-GOV-0394 — dry-run purity across every lifecycle branch.
 *
 * Regression origin: on 2026-08-14 a `git commit --task <closed-task>
 * --auto-stage --dry-run` returned ATM_GIT_COMMIT_OK and advanced HEAD to
 * 60ced0732. The task had closed and released its claim, so neither the
 * task-scoped branch nor the framework branch matched, and the request fell
 * through to the executor — which never consults the flag.
 *
 * These scenarios pin the contract rather than that incident: purity is
 * resolved from the request before branch selection, and the executor is
 * unreachable while pure. Nothing here names a task id, actor, or path.
 */

export interface RepositoryStateSnapshot {
  readonly head: string;
  readonly reflogLines: number;
  readonly index: string;
  readonly worktree: string;
}

/**
 * Reflog is included deliberately. HEAD alone cannot distinguish "never
 * committed" from "committed and reset"; a reflog entry survives both.
 */
export function captureRepositoryState(
  repositoryRoot: string,
  runGit: (args: readonly string[], cwd?: string) => string
): RepositoryStateSnapshot {
  const reflogPath = path.join(repositoryRoot, '.git', 'logs', 'HEAD');
  return {
    head: runGit(['rev-parse', 'HEAD'], repositoryRoot).trim(),
    reflogLines: existsSync(reflogPath)
      ? readFileSync(reflogPath, 'utf8').split('\n').filter((line) => line.trim().length > 0).length
      : 0,
    index: runGit(['diff', '--cached', '--name-status'], repositoryRoot).trim(),
    worktree: runGit(['status', '--porcelain'], repositoryRoot).trim()
  };
}

export function assertRepositoryUnchanged(
  before: RepositoryStateSnapshot,
  after: RepositoryStateSnapshot,
  shape: string
): void {
  assert.equal(after.head, before.head, `${shape}: dry-run must not move HEAD`);
  assert.equal(after.reflogLines, before.reflogLines, `${shape}: dry-run must not append a reflog entry`);
  assert.equal(after.index, before.index, `${shape}: dry-run must not change the index`);
  assert.equal(after.worktree, before.worktree, `${shape}: dry-run must not change the worktree`);
}

/**
 * caseId: dry_run_never_mutates_on_any_lifecycle_branch_0394
 *
 * Purity is a property of the request. It is decided before any branch is
 * chosen, so it holds identically for a task-scoped request, a
 * framework auto-stage request, a request whose task has closed and released,
 * and the 60ced0732 shape that matches no branch at all.
 */
export function runDryRunPurityResolutionScenarios(): void {
  const lifecycleShapes = [
    { shape: 'task-scoped', options: { dryRun: true, taskId: 'FIXTURE-TASK', autoStage: false } },
    { shape: 'framework-auto-stage', options: { dryRun: true, taskId: null, autoStage: true } },
    { shape: 'closed-and-released', options: { dryRun: true, taskId: 'FIXTURE-TASK', autoStage: true } },
    { shape: 'no-matching-branch', options: { dryRun: true, taskId: 'FIXTURE-TASK', autoStage: true, claimReleased: true } }
  ];
  for (const { shape, options } of lifecycleShapes) {
    assert.equal(
      resolveDryRunPurity(options),
      true,
      `${shape}: purity must be resolved from the request, independently of which branch would match`
    );
  }

  // The mirror case: without the flag nothing is constrained, on any shape.
  for (const { shape, options } of lifecycleShapes) {
    assert.equal(
      resolveDryRunPurity({ ...options, dryRun: false }),
      false,
      `${shape}: a request without the flag must not be treated as pure`
    );
  }
  assert.equal(resolveDryRunPurity({}), false, 'an absent flag is not purity');
  assert.equal(resolveDryRunPurity({ dryRun: 'true' }), false, 'only the boolean flag grants purity');
}

/**
 * caseId: dry_run_without_authority_fails_closed_0394
 *
 * Reaching the executor while pure is the defect itself, so it must raise
 * rather than commit — and the refusal must name the missing authority, or an
 * operator cannot tell a broken preview from a successful no-op.
 */
export function runDryRunExecutorGuardScenarios(): void {
  assert.doesNotThrow(
    () => assertDryRunReachedNoExecutor(false, { taskId: 'FIXTURE-TASK', usesFrameworkClaimCommit: false }),
    'an ordinary commit must still reach the executor'
  );

  for (const context of [
    { taskId: 'FIXTURE-TASK', usesFrameworkClaimCommit: false },
    { taskId: null, usesFrameworkClaimCommit: true }
  ]) {
    let raised: any = null;
    try {
      assertDryRunReachedNoExecutor(true, context);
    } catch (error) {
      raised = error;
    }
    assert(raised, 'a pure request that reaches the executor must fail closed');
    assert.equal(raised.code, 'ATM_GIT_COMMIT_DRY_RUN_PURITY_VIOLATED');
    assert.equal(raised.details.dryRun, true);
    assert(
      String(raised.details.missingAuthority).length > 0,
      'the refusal must name the authority that was missing'
    );
    assert(
      String(raised.details.statusCommand).startsWith('node atm.mjs '),
      'the refusal must route recovery back through the ATM CLI'
    );
  }
}

/**
 * Entry point used by the suite: unit contract first, then a real invocation
 * against the fixture repository with a full state snapshot around it.
 */
export async function runDryRunPurityScenarios(input: {
  readonly tempDir: string;
  readonly taskId: string;
  readonly sessionId: string;
  readonly runGit: (cwd: string, args: string[]) => string;
  readonly runAtmGit: (argv: string[]) => Promise<any>;
}): Promise<void> {
  const { tempDir, taskId, sessionId, runGit, runAtmGit } = input;
  // ATM-GOV-0394: purity is a property of the request, so it is pinned as a
  // unit contract; the end-to-end snapshot below then proves the repository is
  // untouched by a real dry-run invocation.
  runDryRunPurityResolutionScenarios();
  runDryRunExecutorGuardScenarios();

  const stateBeforeDryRun = captureRepositoryState(tempDir, (args, cwd) => runGit(cwd ?? tempDir, [...args]));
  try {
    await runAtmGit([
      'commit',
      '--cwd', tempDir,
      '--actor', 'fixture-agent',
      '--task', taskId,
      '--session', sessionId,
      '--message', 'dry run must not commit',
      '--auto-stage',
      '--dry-run',
      '--json'
    ]);
  } catch {
    // A refusal is an acceptable dry-run outcome; a mutation is not.
  }
  assertRepositoryUnchanged(
    stateBeforeDryRun,
    captureRepositoryState(tempDir, (args, cwd) => runGit(cwd ?? tempDir, [...args])),
    'end-to-end dry-run'
  );


}
