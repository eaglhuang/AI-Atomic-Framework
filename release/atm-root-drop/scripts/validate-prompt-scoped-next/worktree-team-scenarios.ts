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

export async function runWorktreeTeamScenarios(ctx: any) {
  const { tempRoot, ledgerTaskDir, atomizationCoverageDir } = ctx;
    writeFileSync(path.join(tempRoot, 'release', 'fixture.txt'), 'dirty release mirror\n', 'utf8');
    writeFileSync(path.join(tempRoot, 'notes', 'unrelated.txt'), 'dirty unrelated tracked file\n', 'utf8');
    mkdirSync(path.join(tempRoot, 'atomic_workbench', 'evidence'), { recursive: true });
    writeFileSync(path.join(tempRoot, 'atomic_workbench', 'evidence', 'route-hint.json'), '{"ok":true}\n', 'utf8');
    mkdirSync(path.join(tempRoot, '.atm', 'runtime'), { recursive: true });
    writeFileSync(path.join(tempRoot, '.atm', 'runtime', 'prompt-hint.json'), '{"runtime":true}\n', 'utf8');
    mkdirSync(path.join(tempRoot, 'artifacts', 'generated', 'cross-agent-review-signature', '20260628'), { recursive: true });
    writeFileSync(path.join(tempRoot, 'artifacts', 'generated', 'cross-agent-review-signature', '20260628', 'signature.json'), '{"signature":true}\n', 'utf8');
    const nonTaskPrompt = await runNext(['--cwd', tempRoot, '--prompt', 'Please show onboarding guidance']);
    assert(nonTaskPrompt.messages.some((entry) => entry.code === 'ATM_NEXT_PROMPT_GUIDANCE_REQUIRED'), 'non-task prompt must route to prompt-scoped guidance');
    assert(nonTaskPrompt.messages.some((entry) => entry.code === 'ATM_NEXT_PLAYBOOK_ABSENT'), 'non-task prompt must state when no playbook exists');
    assert(nonTaskPrompt.messages.some((entry) => entry.code === 'ATM_NEXT_IGNORED_ARTIFACT_FORCE_ADD_HINT'), 'non-task prompt must surface ignored artifact force-add hints');
    assert(nonTaskPrompt.messages.some((entry) => entry.code === 'ATM_NEXT_WORKTREE_SCOPE_HINT'), 'non-task prompt must surface dirty worktree classification hints');
    assert(nonTaskPrompt.messages.some((entry) => entry.code === 'ATM_NEXT_GOVERNANCE_READINESS_HINT'), 'non-task prompt must still surface early governance readiness hints');
    const nonTaskNextAction = (nonTaskPrompt.evidence.nextAction as any) ?? {};
    assert(nonTaskNextAction.playbookState === 'absent', 'non-task prompt must mark playbookState=absent');
    assert(nonTaskNextAction.structuredOutputHint?.hasPlaybook === false, 'non-task prompt must expose structuredOutputHint.hasPlaybook=false');
    assert(nonTaskNextAction.structuredOutputHint?.followNextActionField === 'evidence.nextAction.command', 'non-task prompt must point agents at evidence.nextAction.command');
    assert(Array.isArray(nonTaskNextAction.governanceReadiness?.queueRetryCodes), 'non-task prompt must expose governance readiness queue retry codes');
    assert((nonTaskNextAction.ignoredArtifactForceAddHints ?? []).some((entry: any) => String(entry.path).startsWith('artifacts/')), 'non-task prompt must hint ignored artifact force-add paths');
    assert((nonTaskNextAction.promptWorktreeHint?.releaseMirrorFiles ?? []).includes('release/fixture.txt'), 'non-task prompt must classify release mirror dirty files');
    assert((nonTaskNextAction.promptWorktreeHint?.unrelatedTrackedFiles ?? []).includes('notes/unrelated.txt'), 'non-task prompt must classify unrelated tracked dirty files');
    assert((nonTaskNextAction.promptWorktreeHint?.generatedArtifactFiles ?? []).includes('atomic_workbench/evidence/route-hint.json'), 'non-task prompt must classify generated artifact dirty files');
    assert((nonTaskNextAction.promptWorktreeHint?.atmManagedFiles ?? []).includes('.atm/runtime/prompt-hint.json'), 'non-task prompt must classify ATM-managed dirty files');
    assert(nonTaskNextAction.promptWorktreeHint?.ignoredArtifactCount >= 1, 'non-task prompt must count ignored artifact candidates');

    const noPrompt = await runNext(['--cwd', tempRoot]);
    assert(noPrompt.ok === false, 'next without prompt must not proceed when non-bootstrap tasks exist');
    assert(noPrompt.messages.some((entry) => entry.code === 'ATM_NEXT_PROMPT_REQUIRED_FOR_TASK_ROUTING'), 'next without prompt must require the current user prompt for task routing');
    assert((noPrompt.evidence.nextAction as any).batchInstruction?.includes('recommendedChannel=batch'), 'next without prompt must explain that batch needs the original prompt');

    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-ACTIVE-0001.json'), 'TASK-ACTIVE-0001', 'Active scoped task', 'src/active-owned.ts', {
      status: 'running',
      claimActorId: 'prompt-scope-test'
    });
    const divergentActiveTask = await runNext(['--cwd', tempRoot, '--prompt', 'Please fix src/new-bug.ts, not the current task']);
    assert(divergentActiveTask.ok === false, 'divergent prompt must not auto-attach to the active task');
    assert(divergentActiveTask.messages.some((entry) => entry.code === 'ATM_NEXT_ACTIVE_TASK_DIVERGENCE_BLOCKED'), 'divergent prompt must emit active-task divergence blocker');
    const divergentAction = (divergentActiveTask.evidence.nextAction as any) ?? {};
    assert(divergentAction.status === 'active-task-divergence-blocked', 'divergent prompt must expose active-task-divergence-blocked status');
    assert((divergentAction.decisionOptions ?? []).some((entry: string) => entry.includes('Open or import')), 'divergence blocker must tell the operator to open/import a new card');
    assert((divergentAction.decisionOptions ?? []).some((entry: string) => entry.includes('Continue intentionally')), 'divergence blocker must allow intentional same-task continuation by naming the task');

    const sameActiveTask = await runNext(['--cwd', tempRoot, '--prompt', 'Continue TASK-ACTIVE-0001']);
    assert(sameActiveTask.ok === true, 'same-task continuation prompt must still route');
    assert((sameActiveTask.evidence.nextAction as any).selectedTask?.workItemId === 'TASK-ACTIVE-0001', 'same-task continuation must select the active task');

    // ATM-BUG-2026-07-07-047: a blanket "all/open/remaining task cards" prompt
    // names no specific task, plan, or root, so keyword-based scoring finds
    // nothing above zero. ATM must still route the already-discovered open
    // queue instead of discarding it as task-scope-not-found.
    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-BLANKET-0001.json'), 'TASK-BLANKET-0001', 'Ledger first standalone card', 'src/blanket-one.ts');
    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-BLANKET-0002.json'), 'TASK-BLANKET-0002', 'Ledger second standalone card', 'src/blanket-two.ts');
    const blanketRoute = await runNext(['--cwd', tempRoot, '--prompt', 'please finish all open task cards and push the results']);
    assert(!blanketRoute.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_SCOPE_NOT_FOUND'), 'blanket all-open-task-cards prompt must not be discarded as task-scope-not-found');
    assert(blanketRoute.messages.some((entry) => entry.code === 'ATM_NEXT_TASK_QUEUE_READY'), 'blanket all-open-task-cards prompt must resolve to a scoped task queue');
    const blanketNextAction = (blanketRoute.evidence.nextAction as any) ?? {};
    assert(blanketNextAction.status === 'task-queue-ready', 'blanket all-open-task-cards prompt must report task-queue-ready status');
    assert(blanketNextAction.recommendedChannel === 'batch', 'blanket all-open-task-cards prompt must recommend the batch channel');
    assert(Array.isArray(blanketNextAction.selectedTasks) && blanketNextAction.selectedTasks.some((task: any) => task.workItemId === 'TASK-BLANKET-0001'), 'blanket all-open-task-cards prompt must include the discovered open queue');
    assertDecisionTrail(blanketNextAction, 'task-queue-ready');

    // Regression: Parallel CID advisor preflight and team validation integration tests
    writeFileSync(path.join(atomizationCoverageDir, 'path-to-atom-map.json'), JSON.stringify({
      mappings: [
        {
          path_pattern: 'src/conflict-file.ts',
          atom_id: 'atom-conflict',
          capability: 'conflict'
        }
      ]
    }, null, 2), 'utf8');

    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-CONFLICT-0001.json'), 'TASK-CONFLICT-0001', 'Active conflict task', 'src/conflict-file.ts', {
      status: 'running',
      claimActorId: 'other-actor'
    });
    writeLedgerTask(path.join(ledgerTaskDir, 'TASK-CONFLICT-0002.json'), 'TASK-CONFLICT-0002', 'Blocked conflict task', 'src/conflict-file.ts', {
      status: 'ready'
    });

    try {
      await runNext([
        '--cwd', tempRoot,
        '--claim',
        '--actor', 'prompt-scope-test',
        '--prompt', 'TASK-CONFLICT-0002'
      ]);
      assert(false, 'next --claim must fail closed when Broker arbitration returns freeze');
    } catch (err: any) {
      assert(err?.code === 'ATM_NEXT_CLAIM_BLOCKED', 'next --claim must report ATM_NEXT_CLAIM_BLOCKED for broker freeze');
      assert(err?.details?.conflictWithTaskId === 'TASK-CONFLICT-0001', 'claim block must identify the conflicting task');
    }

    let teamPlanResult: any;
    try {
      teamPlanResult = await runTeam(['plan', '--task', 'TASK-CONFLICT-0002', '--cwd', tempRoot, '--json']);
    } catch (err: any) {
      console.log('runTeam failed with error:', err.message, err.stack, JSON.stringify(err.details ?? {}, null, 2));
      throw err;
    }
    try {
      assert(teamPlanResult.ok === true, 'team plan must not fail validation on unconfirmed same-atom metadata overlap');
      const teamEvidence = teamPlanResult.evidence as any;
      assert(teamEvidence?.validation?.ok === true, 'validation ok must stay true for unconfirmed same-atom metadata overlap');
      assert(!teamEvidence?.validation?.findings?.some((f: any) => f.code === 'blocked-cid-conflict'), 'findings must not include blocked-cid-conflict without Broker confirmation');
    } catch (err) {
      // Only dump the full payload when the assertions above actually fail;
      // the success path stays quiet so CI/agent transcripts are scannable.
      console.log('teamPlanResult is:', JSON.stringify(teamPlanResult, null, 2));
      throw err;
    }

    // ATM-BUG-2026-07-07-043/044 (OPT-10): a `tasks scope add` amendment merges
    // the new path into taskDirectionLock.allowedFiles and claim.files, but
    // never rewrites the task's own static scope/scopePaths declaration.
    // Re-claiming afterwards (e.g. escalating from closeout-only to write
    // intent) used to rebuild allowedFiles from the static scope only and
    // silently drop the amended path. Confirm the amendment survives re-claim.
    const scopeAmendTaskId = 'TASK-SCOPEAMEND-0001';
    const scopeAmendTaskPath = path.join(ledgerTaskDir, `${scopeAmendTaskId}.json`);
    writeFileSync(scopeAmendTaskPath, `${JSON.stringify({
      schemaVersion: 'atm.workItem.v0.2',
      workItemId: scopeAmendTaskId,
      title: 'Scope amendment survives re-claim',
      status: 'running',
      dependencies: [],
      acceptance: ['bootstrap output reviewed by human gate'],
      scope: ['src/scope-amend-original.ts'],
      scopePaths: ['src/scope-amend-original.ts'],
      deliverables: ['src/scope-amend-original.ts'],
      claim: {
        actorId: 'prompt-scope-test',
        leaseId: `lease-${scopeAmendTaskId.toLowerCase()}`,
        claimedAt: '2026-05-24T00:00:00.000Z',
        heartbeatAt: '2026-05-24T00:00:00.000Z',
        ttlSeconds: 1800,
        intent: 'closeout-only',
        files: ['src/scope-amend-original.ts', 'src/scope-amend-linked.ts'],
        state: 'active'
      },
      taskDirectionLock: {
        allowedFiles: ['src/scope-amend-original.ts', 'src/scope-amend-linked.ts']
      },
      source: {
        planPath: 'docs/plan/PlanAlpha.md',
        sectionTitle: 'Scope amendment survives re-claim',
        headingLine: 1,
        hash: scopeAmendTaskId
      }
    }, null, 2)}\n`, 'utf8');

    const reclaimWithEscalatedIntent = await runNext([
      '--cwd', tempRoot,
      '--claim',
      '--actor', 'prompt-scope-test',
      '--claim-intent', 'write',
      '--prompt', scopeAmendTaskId
    ]);
    assert(reclaimWithEscalatedIntent.ok === true, `re-claim with escalated intent must succeed: ${JSON.stringify(reclaimWithEscalatedIntent.messages ?? [])}`);
    const scopeAmendedTaskDocument = JSON.parse(readFileSync(scopeAmendTaskPath, 'utf8')) as Record<string, unknown>;
    const scopeAmendedClaim = scopeAmendedTaskDocument.claim as Record<string, unknown> | undefined;
    const scopeAmendedClaimFiles = Array.isArray(scopeAmendedClaim?.files) ? scopeAmendedClaim.files as string[] : [];
    assert(
      scopeAmendedClaimFiles.includes('src/scope-amend-linked.ts'),
      `re-claim must not drop the tasks-scope-add-amended path; claim.files was ${JSON.stringify(scopeAmendedClaimFiles)}`
    );

}
