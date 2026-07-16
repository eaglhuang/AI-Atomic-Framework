import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runBatch } from '../../packages/cli/src/commands/batch.ts';
import { runNext } from '../../packages/cli/src/commands/next.ts';
import { runQuickfix } from '../../packages/cli/src/commands/quickfix.ts';
import { runTasks } from '../../packages/cli/src/commands/tasks.ts';
import { runTeam } from '../../packages/cli/src/commands/team.ts';
import { listActiveBatchRuns } from '../../packages/cli/src/commands/work-channels.ts';
import { assert, assertDecisionTrail, assertRunnerMode, assertTeamRecommendation, runGit } from './assertions.ts';
import { writeLedgerTask, writeTaskCard } from './writers.ts';

export async function runClaimScenarios(ctx: any) {
  const { tempRoot, ledgerTaskDir } = ctx;
    writeLedgerTask(path.join(ledgerTaskDir, 'SANGUO-BOOTSTRAP-0001.json'), 'SANGUO-BOOTSTRAP-0001', 'Running Sanguo bootstrap task', 'docs/sanguo.md', {
      status: 'running',
      claimActorId: 'prompt-scope-test'
    });
    const runningExact = await runNext(['--cwd', tempRoot, '--prompt', 'SANGUO-BOOTSTRAP-0001']);
    assert(runningExact.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_ROUTE_READY'), 'exact task id prompt must route to a running task with active claim');
    assert((runningExact.evidence.nextAction as any).selectedTask.workItemId === 'SANGUO-BOOTSTRAP-0001', 'exact running task prompt selected wrong task');
    const runningClaim = await runNext(['--cwd', tempRoot, '--claim', '--actor', 'prompt-scope-test', '--prompt', 'SANGUO-BOOTSTRAP-0001']);
    assert(runningClaim.ok === true, `next --claim must reuse an active claim for a running task: ${JSON.stringify(runningClaim.messages ?? [])}`);
    assert((runningClaim.evidence.claimPreparation as any)?.reusedActiveClaim === true, 'running task claim should be reported as reused active claim');
    assert((runningClaim.evidence.taskDirectionLock as any)?.taskId === 'SANGUO-BOOTSTRAP-0001', 'running task claim must still write a direction lock');
    const runningAllowedFiles = (runningClaim.evidence.taskDirectionLock as any)?.allowedFiles ?? [];
    assert(runningAllowedFiles.includes('docs/sanguo.md'), 'direction lock allowedFiles must preserve real task paths');
    assert(!runningAllowedFiles.some((entry: string) => entry.includes('human gate')), 'direction lock allowedFiles must not include natural-language acceptance text');

    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-PLANNED-0001.json'), 'TASK-PLANNED-0001', 'Planned route should auto-prepare', 'docs/planned-route.md', {
      status: 'planned'
    });
    const plannedClaim = await runNext(['--cwd', tempRoot, '--claim', '--actor', 'prompt-scope-test', '--prompt', 'TASK-PLANNED-0001']);
    assert(plannedClaim.ok === true, 'next --claim must auto-prepare planned tasks before claiming');
    assert(!(plannedClaim.messages ?? []).some((entry) => entry.code === 'ATM_LIFECYCLE_LEGACY_LOCK'), 'planned next --claim must not surface legacy lifecycle warnings');
    const plannedPreparation = (plannedClaim.evidence.claimPreparation as any) ?? {};
    assert(Array.isArray(plannedPreparation.steps) && plannedPreparation.steps.length === 2, 'planned next --claim must report reserve+promote preparation steps');
    assert(plannedPreparation.steps[0]?.action === 'reserve', 'planned next --claim must reserve before claim');
    assert(plannedPreparation.steps[1]?.action === 'promote', 'planned next --claim must promote before claim');
    assert((plannedClaim.evidence.taskDirectionLock as any)?.taskId === 'TASK-PLANNED-0001', 'planned next --claim must write a direction lock for the selected task');
    const plannedAllowedFiles = (plannedClaim.evidence.taskDirectionLock as any)?.allowedFiles ?? [];
    assert(plannedAllowedFiles.includes('docs/planned-route.md'), 'planned next --claim direction lock must preserve task scope files');
    const plannedTaskAfterClaim = JSON.parse(readFileSync(path.join(ledgerTaskDir, 'TASK-PLANNED-0001.json'), 'utf8'));
    assert(plannedTaskAfterClaim.status === 'running', 'planned next --claim must leave the task in running state');

    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-DEP-0001.json'), 'TASK-DEP-0001', 'Unfinished dependency', 'docs/dep.md', {
      status: 'planned'
    });
    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-DEP-0041.json'), 'TASK-DEP-0041', 'Ready task with hard dependency', 'docs/dep-0041.md', {
      status: 'ready',
      dependencies: ['TASK-DEP-0001']
    });
    const dependencyBlockedNextClaim = await runNext(['--cwd', tempRoot, '--claim', '--actor', 'prompt-scope-test', '--prompt', 'TASK-DEP-0041']);
    assert(dependencyBlockedNextClaim.ok === false, 'next --claim must block when a task dependency is not yet closed');
    assert(dependencyBlockedNextClaim.messages.some((entry) => entry.code === 'ATM_NEXT_CLAIM_DEPENDENCY_BLOCKED'), 'next --claim must report dependency-blocked guidance');
    const dependencyBlockedTasksClaim = await runTasks(['claim', '--cwd', tempRoot, '--task', 'TASK-DEP-0041', '--actor', 'prompt-scope-test', '--json']).catch((error: any) => ({ ok: false, error }));
    const dependencyBlockedTasksClaimError = (dependencyBlockedTasksClaim as any).error;
    assert(dependencyBlockedTasksClaimError && dependencyBlockedTasksClaimError.code === 'ATM_TASK_CLAIM_DEPENDENCY_BLOCKED', 'tasks claim must fail when a task dependency is not yet closed');
    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-DEP-0040.json'), 'TASK-DEP-0040', 'Explicit running task with advisory dependency', 'docs/dep-0040.md', {
      status: 'running',
      claimActorId: 'prompt-scope-test',
      dependencies: ['TASK-DEP-0001']
    });
    const explicitRunningWithDependencyClaim = await runNext(['--cwd', tempRoot, '--claim', '--actor', 'prompt-scope-test', '--prompt', 'TASK-DEP-0040']);
    assert(explicitRunningWithDependencyClaim.ok === true, 'explicit running task claim must recreate direction lock even when advisory dependencies are not complete');
    assert((explicitRunningWithDependencyClaim.evidence.taskDirectionLock as any)?.taskId === 'TASK-DEP-0040', 'explicit running task claim with advisory dependency must lock the requested task');

    const crossClaim = await runNext(['--cwd', tempRoot, '--claim', '--actor', 'prompt-scope-test', '--prompt', 'TASK-CROSS-0001']);
    assert(crossClaim.ok === true, 'cross-repo ledger task claim must succeed');
    const crossLock = (crossClaim.evidence.taskDirectionLock as any) ?? {};
    assert((crossClaim.evidence.nextAction as any).planningContext?.readOnlyPaths?.some((entry: string) => entry.includes('3KLife/docs/ai_atomic_framework/atm-agent-first-operability')), 'next --claim must surface planningContext.readOnlyPaths');
    assert((crossClaim.evidence.nextAction as any).targetWork?.allowedFiles?.includes('packages/cli/src/commands/next.ts'), 'next --claim must surface targetWork.allowedFiles');
    assert(!((crossClaim.evidence.nextAction as any).targetWork?.allowedFiles ?? []).some((entry: string) => entry.startsWith('docs/ai_atomic_framework/atm-agent-first-operability/')), 'targetWork.allowedFiles must exclude planning mirror files');
    assert((crossLock.allowedFiles ?? []).includes('packages/cli/src/commands/next.ts'), 'direction lock must keep real target files');
    assert(!((crossLock.allowedFiles ?? []).some((entry: string) => entry.startsWith('docs/ai_atomic_framework/atm-agent-first-operability/'))), 'direction lock allowedFiles must exclude planning mirror files');
    assert((crossLock.planningMirrorPaths ?? []).some((entry: string) => entry.startsWith('docs/ai_atomic_framework/atm-agent-first-operability/')), 'direction lock must record planning mirror guard paths');

}
