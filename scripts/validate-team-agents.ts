import assert from 'node:assert/strict';
import { CliError } from '../packages/cli/src/commands/shared.ts';
import { assessLieutenantEscalation, buildAtomizationChecklist, runTeam, selectTeamImplementer } from '../packages/cli/src/commands/team.ts';

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
    assert.equal(evidence?.teamPlan?.implementerSelector?.schemaId, 'atm.teamImplementerSelector.v1');
    assert.equal(evidence?.teamPlan?.implementerSelector?.selectedImplementer?.agentId, 'implementer-typescript');
    assert.equal(evidence?.teamPlan?.implementerSelector?.languageMatch, 'typescript');
    assert.equal(evidence?.teamPlan?.implementerSelector?.roleMatch, 'typescript-implementer');
    assert.equal(evidence?.teamPlan?.implementerSelector?.confidence, 'high');
    assert.deepEqual(evidence?.teamPlan?.captainDecision?.implementerSelector, evidence?.teamPlan?.implementerSelector);
    const findings = evidence?.teamPlan?.validation?.findings ?? [];
    const onlyActiveClaimConflict = findings.length === 1 && findings[0]?.code === 'blocked-cid-conflict';
    assert.equal(result.ok, evidence?.teamPlan?.validation?.ok === true, 'plan ok must mirror permission validation state');
    assert.equal(evidence?.teamPlan?.validation?.ok === true || onlyActiveClaimConflict, true, 'plan-resolver permits only active-claim CID conflict as a transient regression condition');
    assert.equal(typeof evidence?.teamPlan?.brokerLane?.decision?.verdict, 'string');
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

  if (taskCase === 'role-selector') {
    const result = await runTeam(['plan', '--task', 'TASK-TEAM-0010', '--cwd', process.cwd(), '--json']);

    const evidence = result.evidence as any;
    const findings = evidence?.teamPlan?.validation?.findings ?? [];
    const onlyActiveLeaseConflict = findings.length === 1 && ['blocked-cid-conflict', 'blocked-broker-cid-conflict'].includes(findings[0]?.code);
    assert.equal(result.ok, evidence?.teamPlan?.validation?.ok === true, 'plan ok must mirror permission validation state');
    assert.equal(evidence?.teamPlan?.validation?.ok === true || onlyActiveLeaseConflict, true, 'role-selector permits only active-lease/broker CID conflict as a transient validation condition');
    const selection = evidence?.teamPlan?.implementerSelector;
    assert.equal(selection?.schemaId, 'atm.teamImplementerSelector.v1');
    assert.equal(selection?.selectedImplementer?.agentId, 'implementer-typescript');
    assert.equal(selection?.selectedImplementer?.role, 'implementer');
    assert.equal(selection?.selectedImplementer?.profile, 'atm.implementer.typescript.v1');
    assert.equal(selection?.selectedImplementer?.language, 'typescript');
    assert.equal(selection?.languageMatch, 'typescript');
    assert.equal(selection?.roleMatch, 'typescript-implementer');
    assert.ok(selection?.deterministicHints?.scopePaths?.includes('packages/cli/src/commands/team.ts'));
    assert.ok(selection?.deterministicHints?.fileExtensions?.includes('.ts'));
    assert.ok(selection?.fallbackReason?.includes('No fallback needed'));
    assert.equal(selection?.confidence, 'high');
    assert.deepEqual(evidence?.teamPlan?.captainDecision?.implementerSelector, selection);

    const recipe = {
      schemaId: 'atm.teamRecipe.v1',
      recipeId: 'validator.fixture',
      agents: [
        { agentId: 'implementer-typescript', role: 'implementer', profile: 'atm.implementer.typescript.v1', language: 'typescript', permissions: ['file.write'] },
        { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] }
      ]
    } as any;
    const pythonRecipe = {
      ...recipe,
      agents: [
        ...recipe.agents,
        { agentId: 'implementer-python', role: 'implementer', profile: 'atm.implementer.python.v1', language: 'python', permissions: ['file.write'] }
      ]
    } as any;
    const uiRecipe = {
      ...recipe,
      agents: [
        ...recipe.agents,
        { agentId: 'implementer-adopter-ui', role: 'ui-implementer', profile: 'atm.implementer.adopter-ui.v1', language: 'typescript', permissions: ['file.write'] }
      ]
    } as any;
    const genericRecipe = {
      ...recipe,
      agents: [
        { agentId: 'implementer-generic', role: 'implementer', profile: 'atm.implementer.generic.v1', language: 'generic', permissions: ['file.write'] }
      ]
    } as any;
    const pythonSelection = selectTeamImplementer({
      workItemId: 'TASK-TEAM-PY',
      title: 'Python data pipeline task',
      scopePaths: ['tools/pipeline/extract.py', 'requirements.txt'],
      deliverables: ['tools/pipeline/extract.py']
    }, pythonRecipe, ['tools/pipeline/extract.py']);
    assert.equal(pythonSelection.selectedImplementer.agentId, 'implementer-python');
    assert.equal(pythonSelection.selectedImplementer.language, 'python');
    assert.equal(pythonSelection.languageMatch, 'python');
    assert.equal(pythonSelection.roleMatch, 'python-implementer');
    assert.ok(pythonSelection.fallbackReason.includes('No fallback needed'));

    const uiSelection = selectTeamImplementer({
      workItemId: 'TASK-TEAM-UI',
      title: 'Adopter UI task',
      scopePaths: ['assets/scripts/ui/scenes/LoadingScene.ts'],
      deliverables: ['assets/scripts/ui/scenes/LoadingScene.ts']
    }, uiRecipe, ['assets/scripts/ui/scenes/LoadingScene.ts']);
    assert.equal(uiSelection.selectedImplementer.agentId, 'implementer-adopter-ui');
    assert.equal(uiSelection.languageMatch, 'typescript');
    assert.equal(uiSelection.roleMatch, 'ui-implementer');
    assert.ok(uiSelection.fallbackReason.includes('No fallback needed'));

    const genericSelection = selectTeamImplementer({
      workItemId: 'TASK-TEAM-UNKNOWN',
      title: 'Generic documentation task',
      scopePaths: ['docs/notes/readme.md'],
      deliverables: ['docs/notes/readme.md']
    }, genericRecipe, ['docs/notes/readme.md']);
    assert.equal(genericSelection.selectedImplementer.agentId, 'implementer-generic');
    assert.equal(genericSelection.languageMatch, 'unknown');
    assert.equal(genericSelection.roleMatch, 'generic-implementer');
    assert.ok(genericSelection.fallbackReason.includes('generic implementer'));
    assert.equal(genericSelection.confidence, 'low');

    console.log('[validate-team-agents] ok (role-selector)');
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
