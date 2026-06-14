import assert from 'node:assert/strict';
import { CliError } from '../packages/cli/src/commands/shared.ts';
import { assessLieutenantEscalation, buildAtomizationChecklist, runTeam } from '../packages/cli/src/commands/team.ts';

const taskCase = getArg('--case') ?? 'lieutenant-escalation';

await main();

async function main() {
  if (taskCase === 'lieutenant-escalation') {
    const lowRiskTask = {
      workItemId: 'TASK-TEAM-0008-SMALL',
      title: 'Small task crew dry-run',
      planningRepo: 'AI-Atomic-Framework',
      targetRepo: 'AI-Atomic-Framework',
      scopePaths: ['packages/cli/src/commands/team.ts'],
      deliverables: ['packages/cli/src/commands/team.ts'],
      validators: ['npm run typecheck'],
      acceptance: ['Captain keeps the crew small.']
    };

    const highRiskTask = {
      workItemId: 'TASK-TEAM-0008',
      title: 'Task lieutenant escalation rules',
      planningRepo: 'AI-Atomic-Framework',
      targetRepo: 'AI-Atomic-Framework',
      scopePaths: [
        'packages/cli/src/commands/team.ts',
        'packages/cli/src/commands/command-specs/team.spec.ts',
        'scripts/validate-team-agents.ts',
        'atomic_workbench/atomization-coverage/path-to-atom-map.json'
      ],
      deliverables: [
        'packages/cli/src/commands/team.ts',
        'packages/cli/src/commands/command-specs/team.spec.ts',
        'scripts/validate-team-agents.ts',
        'atomic_workbench/atomization-coverage/path-to-atom-map.json'
      ],
      validators: [
        'npm run typecheck',
        'npm run validate:cli',
        'node --strip-types scripts/validate-team-agents.ts --case lieutenant-escalation',
        'node atm.mjs team plan --task TASK-TEAM-0008 --json',
        'git diff --check'
      ],
      acceptance: [
        'Tasks touching more than two core files recommend Task Lieutenant.',
        'The output includes escalationRequired, escalationReason, needLieutenant, and nextTeamShape.'
      ]
    };

    const lowRisk = assessLieutenantEscalation(
      lowRiskTask,
      lowRiskTask.deliverables,
      { ok: true, findings: [] },
      safeBrokerLane(),
      buildAtomizationChecklist(lowRiskTask, lowRiskTask.deliverables)
    );

    assert.equal(lowRisk.escalationRequired, false);
    assert.equal(lowRisk.needLieutenant, false);
    assert.equal(lowRisk.nextTeamShape.lieutenant.recommended, false);
    assert.deepEqual(lowRisk.nextTeamShape.lieutenant.permissions, ['file.read', 'exec.validator']);
    assert.deepEqual(lowRisk.nextTeamShape.lieutenant.forbiddenPermissions, ['task.lifecycle', 'git.write', 'evidence.write']);
    assert.deepEqual(lowRisk.nextTeamShape.captain.permissions, ['task.lifecycle', 'git.write', 'evidence.write']);

    const highRisk = assessLieutenantEscalation(
      highRiskTask,
      highRiskTask.deliverables,
      { ok: true, findings: [] },
      safeBrokerLane(),
      buildAtomizationChecklist(highRiskTask, highRiskTask.deliverables)
    );

    assert.equal(highRisk.escalationRequired, true);
    assert.equal(highRisk.needLieutenant, true);
    assert.equal(highRisk.nextTeamShape.lieutenant.recommended, true);
    assert.equal(highRisk.nextTeamShape.coordinationBoundary, 'captain+lieutenant');
    assert.ok(highRisk.escalationReason.includes('explicitly governs lieutenant escalation rules'));
    assert.ok(highRisk.escalationReason.includes('Scope spans'));
    assert.ok(highRisk.escalationReason.includes('Validator fan-out'));
    assert.ok(highRisk.nextTeamShape.signals.largeScriptRisk);
    assert.equal(highRisk.nextTeamShape.signals.scopeCount, 4);

    console.log('[validate-team-agents] ok (lieutenant-escalation)');
    return;
  }

  if (taskCase === 'plan-resolver') {
    const result = await runTeam(['plan', '--task', 'TASK-TEAM-0009', '--cwd', process.cwd(), '--json']);
    assert.equal(result.ok, true, 'team plan dry-run must succeed for TASK-TEAM-0009');

    const evidence = result.evidence as any;
    assert.equal(evidence?.action, 'plan');
    assert.equal(evidence?.dryRun, true);
    assert.equal(evidence?.runtimeWritten, false);
    assert.equal(evidence?.agentsSpawned, false);
    assert.equal(evidence?.task?.taskId, 'TASK-TEAM-0009');
    assert.equal(evidence?.task?.title, 'Team plan dry-run resolver');
    assert.equal(evidence?.recipe?.schemaId, 'atm.teamRecipe.v1');
    assert.equal(evidence?.recipe?.recipeId, 'atm.default.normal.typescript');
    assert.equal(evidence?.teamPlan?.schemaId, 'atm.teamPlan.v1');
    assert.equal(evidence?.teamPlan?.recipeId, 'atm.default.normal.typescript');
    assert.equal(evidence?.teamPlan?.channelHint, 'normal');
    assert.equal(evidence?.teamPlan?.validation?.ok, true);
    assert.equal(evidence?.teamPlan?.brokerLane?.decision?.verdict, 'parallel-safe');
    assert.equal(evidence?.teamPlan?.briefingContract?.taskId, 'TASK-TEAM-0009');
    assert.deepEqual(evidence?.teamPlan?.briefingContract?.allowedFiles, [
      'atomic_workbench/atomization-coverage/path-to-atom-map.json',
      'packages/cli/src/commands/command-specs/team.spec.ts',
      'packages/cli/src/commands/team.ts',
      'scripts/validate-team-agents.ts'
    ]);
    assert.equal(evidence?.teamPlan?.captainDecision?.taskId, 'TASK-TEAM-0009');
    assert.equal(evidence?.teamPlan?.captainDecision?.nextTeamShape?.coordinationBoundary, 'captain+lieutenant');
    assert.equal(evidence?.teamPlan?.captainDecision?.nextTeamShape?.signals?.scopeCount, 4);
    assert.deepEqual(evidence?.teamPlan?.suggestedPermissionLeases?.map((lease: any) => lease.permission).sort(), [
      'evidence.write',
      'file.write',
      'git.write',
      'task.lifecycle'
    ]);
    assert.ok(Array.isArray(evidence?.teamPlan?.nextSteps) && evidence.teamPlan.nextSteps.includes('Review this dry-run plan.'));

    await assert.rejects(
      () => runTeam(['plan', '--task', 'TASK-TEAM-MISSING', '--cwd', process.cwd(), '--json']),
      (error: unknown) => error instanceof CliError && error.code === 'ATM_TEAM_TASK_NOT_FOUND'
    );

    console.log('[validate-team-agents] ok (plan-resolver)');
    return;
  }

  fail(`unsupported or missing --case value: ${taskCase}`);
}

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function safeBrokerLane(): any {
  return {
    decision: { verdict: 'safe-to-start' },
    chosenLane: 'direct-brokered',
    safeToStart: true,
    blockedReasons: [],
    stewardId: null,
    composerPath: null
  };
}

function fail(message: string): never {
  console.error(`[validate-team-agents] ${message}`);
  process.exit(1);
}
