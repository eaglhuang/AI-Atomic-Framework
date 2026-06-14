import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError } from '../packages/cli/src/commands/shared.ts';
import { createClosurePacket } from '../packages/cli/src/commands/framework-development.ts';
import { assessLieutenantEscalation, buildAtomizationChecklist, runTeam, selectTeamImplementer, validateTeamPermissionModel } from '../packages/cli/src/commands/team.ts';

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

  if (taskCase === 'permission-lease') {
    type FixtureAgent = {
      agentId: string;
      role: string;
      profile?: string;
      language?: string;
      permissions: string[];
    };
    const healthyRecipe = {
      schemaId: 'atm.teamRecipe.v1' as const,
      recipeId: 'validator.healthy',
      agents: [
        { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write'] },
        { agentId: 'implementer-typescript', role: 'implementer', profile: 'atm.implementer.typescript.v1', language: 'typescript', permissions: ['file.write'] },
        { agentId: 'scope-guardian', role: 'scopeGuardian', profile: 'atm.scopeGuardian.v1', permissions: ['file.read'] },
        { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] }
      ] satisfies FixtureAgent[]
    };
    const writePaths = ['packages/cli/src/commands/team.ts'];

    const healthy = validateTeamPermissionModel(healthyRecipe, writePaths);
    assert.equal(healthy.ok, true);
    assert.equal(healthy.findings.length, 0);

    const duplicateOwnersRecipe = {
      ...healthyRecipe,
      agents: [
        ...healthyRecipe.agents,
        { agentId: 'extra-coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['git.write'] }
      ]
    } as any;
    const duplicateOwners = validateTeamPermissionModel(duplicateOwnersRecipe, writePaths);
    assert.equal(duplicateOwners.ok, false);
    const duplicateFinding = duplicateOwners.findings.find((finding) => finding.code === 'ATM_TEAM_PERMISSION_CONFLICT' && finding.permission === 'git.write');
    assert.ok(duplicateFinding);
    assert.ok(duplicateFinding?.summary);
    assert.ok(duplicateFinding?.suggestedFix);
    assert.equal(duplicateFinding?.permission, 'git.write');

    const scopedLeaseMissing = validateTeamPermissionModel(healthyRecipe, []);
    assert.equal(scopedLeaseMissing.ok, false);
    const scopeFinding = scopedLeaseMissing.findings.find((finding) => finding.code === 'ATM_TEAM_PERMISSION_SCOPE_REQUIRED' && finding.permission === 'file.write');
    assert.ok(scopeFinding);
    assert.ok(scopeFinding?.summary);
    assert.ok(scopeFinding?.role);
    assert.ok(scopeFinding?.suggestedFix);

    const evidenceWriteDriftRecipe = {
      ...healthyRecipe,
      agents: healthyRecipe.agents.map((agent) => agent.role === 'coordinator'
        ? { ...agent, permissions: ['task.lifecycle', 'git.write'] }
        : agent.role === 'implementer'
          ? { ...agent, permissions: ['file.write', 'evidence.write'] }
          : agent)
    };
    const evidenceWriteDrift = validateTeamPermissionModel(evidenceWriteDriftRecipe, writePaths);
    assert.equal(evidenceWriteDrift.ok, false);
    const evidenceFinding = evidenceWriteDrift.findings.find((finding) => finding.code === 'ATM_TEAM_UNIQUE_OWNER_REQUIRED' && finding.permission === 'evidence.write');
    assert.ok(evidenceFinding);
    assert.ok(evidenceFinding?.summary);
    assert.ok(evidenceFinding?.suggestedFix);

    const readOnlyWriteRecipe = {
      ...healthyRecipe,
      agents: healthyRecipe.agents.map((agent) => agent.role === 'scopeGuardian'
        ? { ...agent, permissions: ['file.read', 'file.write'] }
        : agent)
    };
    const readOnlyWrite = validateTeamPermissionModel(readOnlyWriteRecipe, writePaths);
    assert.equal(readOnlyWrite.ok, false);
    const readOnlyFinding = readOnlyWrite.findings.find((finding) => finding.code === 'ATM_TEAM_READONLY_ROLE_WRITE_FORBIDDEN');
    assert.ok(readOnlyFinding);
    assert.equal(readOnlyFinding?.role, 'scopeGuardian');
    assert.ok(readOnlyFinding?.summary);
    assert.ok(readOnlyFinding?.suggestedFix);

    const validateResult = await runTeam(['validate', '--task', 'TASK-TEAM-0012', '--cwd', process.cwd(), '--json']);
    const evidence = validateResult.evidence as any;
    assert.equal(validateResult.ok, true);
    assert.equal(evidence?.action, 'validate');
    assert.equal(evidence?.validation?.ok, true);
    assert.ok(Array.isArray(evidence?.validation?.findings));
    assert.ok(Array.isArray(evidence?.suggestedPermissionLeases));
    assert.deepEqual(
      evidence?.suggestedPermissionLeases?.map((lease: any) => lease.permission).sort(),
      ['evidence.write', 'file.write', 'git.write', 'task.lifecycle']
    );

    console.log('[validate-team-agents] ok (permission-lease)');
    return;
  }

  if (taskCase === 'file-write-scope') {
    const recipe = {
      schemaId: 'atm.teamRecipe.v1' as const,
      recipeId: 'validator.file-write-scope',
      agents: [
        { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write'] },
        { agentId: 'implementer-typescript', role: 'implementer', profile: 'atm.implementer.typescript.v1', language: 'typescript', permissions: ['file.write'] },
        { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] }
      ]
    };
    const allowedWritePaths = [
      'packages/cli/src/commands/team.ts',
      'scripts/validate-team-agents.ts'
    ];

    const validLease = validateTeamPermissionModel(recipe, ['packages\\cli\\src\\commands\\team.ts'], { allowedWritePaths });
    assert.equal(validLease.ok, true);
    assert.equal(validLease.findings.length, 0);

    const outOfBounds = validateTeamPermissionModel(recipe, ['packages/cli/src/commands/next.ts'], { allowedWritePaths });
    assert.equal(outOfBounds.ok, false);
    const outOfBoundsFinding = outOfBounds.findings.find((finding) => finding.code === 'ATM_TEAM_WRITE_SCOPE_OUT_OF_BOUNDS');
    assert.ok(outOfBoundsFinding);
    assert.ok(outOfBoundsFinding?.detail.includes('packages/cli/src/commands/next.ts'));
    assert.deepEqual(outOfBoundsFinding?.paths, ['packages/cli/src/commands/next.ts']);
    assert.ok(outOfBoundsFinding?.suggestedFix.includes('scope amendment'));

    const traversal = validateTeamPermissionModel(recipe, ['packages/cli/src/commands/../next.ts'], { allowedWritePaths });
    assert.equal(traversal.ok, false);
    const traversalFinding = traversal.findings.find((finding) => finding.code === 'ATM_TEAM_WRITE_SCOPE_TRAVERSAL');
    assert.ok(traversalFinding);
    assert.ok(traversalFinding?.detail.includes('packages/cli/src/commands/../next.ts'));

    const runtimePath = validateTeamPermissionModel(recipe, ['.atm/runtime/team-runs/example.json'], {
      allowedWritePaths: ['.atm/runtime/team-runs/example.json']
    });
    assert.equal(runtimePath.ok, false);
    const runtimeFinding = runtimePath.findings.find((finding) => finding.code === 'ATM_TEAM_WRITE_SCOPE_FORBIDDEN');
    assert.ok(runtimeFinding);
    assert.ok(runtimeFinding?.detail.includes('.atm/runtime/team-runs/example.json'));

    const historyPath = validateTeamPermissionModel(recipe, ['.atm/history/tasks/TASK-TEAM-0013.json'], {
      allowedWritePaths: ['.atm/history/tasks/TASK-TEAM-0013.json']
    });
    assert.equal(historyPath.ok, false);
    const historyFinding = historyPath.findings.find((finding) => finding.code === 'ATM_TEAM_WRITE_SCOPE_FORBIDDEN');
    assert.ok(historyFinding);
    assert.ok(historyFinding?.detail.includes('.atm/history/tasks/TASK-TEAM-0013.json'));

    const validateResult = await runTeam(['validate', '--task', 'TASK-TEAM-0013', '--cwd', process.cwd(), '--json']);
    const evidence = validateResult.evidence as any;
    assert.equal(validateResult.ok, true);
    assert.equal(evidence?.action, 'validate');
    assert.equal(evidence?.validation?.ok, true);
    assert.ok(Array.isArray(evidence?.validation?.findings));
    assert.ok(evidence?.suggestedPermissionLeases?.some((lease: any) => lease.permission === 'file.write'));

    console.log('[validate-team-agents] ok (file-write-scope)');
    return;
  }

  if (taskCase === 'start-status') {
    const start = await runTeam(['start', '--task', 'TASK-TEAM-0011', '--actor', 'codex-main', '--cwd', process.cwd(), '--json']);
    const startEvidence = start.evidence as any;
    assert.equal(start.ok, true);
    assert.equal(startEvidence?.action, 'start');
    assert.equal(startEvidence?.runtimeWritten, true);
    assert.equal(startEvidence?.agentsSpawned, false);
    assert.match(startEvidence?.teamRunPath, /^\.atm\/runtime\/team-runs\/team-[a-f0-9]{12}\.json$/);

    const teamRun = startEvidence?.teamRun;
    assert.equal(teamRun?.schemaId, 'atm.teamRun.v1');
    assert.match(teamRun?.teamRunId, /^team-[a-f0-9]{12}$/);
    assert.equal(teamRun?.taskId, 'TASK-TEAM-0011');
    assert.equal(teamRun?.actorId, 'codex-main');
    assert.equal(teamRun?.recipeId, 'atm.default.normal.typescript');
    assert.equal(teamRun?.status, 'active');
    assert.equal(teamRun?.executionMode, 'manual-team');
    assert.equal(teamRun?.agentsSpawned, false);
    assert.equal(teamRun?.runtimeWritten, true);
    assert.ok(Array.isArray(teamRun?.roles) && teamRun.roles.length > 0);
    assert.ok(Array.isArray(teamRun?.leases) && teamRun.leases.length > 0);
    assert.deepEqual(teamRun?.leases, teamRun?.permissionLeases);
    assert.ok(teamRun.roles.some((role: any) => role.agentId === 'coordinator' && role.role === 'coordinator'));
    assert.ok(teamRun.leases.some((lease: any) => lease.permission === 'file.write' && Array.isArray(lease.paths)));
    assert.match(teamRun?.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(teamRun?.updatedAt, /^\d{4}-\d{2}-\d{2}T/);

    const status = await runTeam(['status', '--compact', '--cwd', process.cwd(), '--json']);
    const statusEvidence = status.evidence as any;
    assert.equal(status.ok, true);
    assert.equal(statusEvidence?.action, 'status');
    assert.ok(statusEvidence?.teamRunCount >= 1);
    const summary = statusEvidence?.teamRuns?.find((entry: any) => entry.teamRunId === teamRun.teamRunId);
    assert.equal(summary?.taskId, 'TASK-TEAM-0011');
    assert.equal(summary?.actorId, 'codex-main');
    assert.equal(summary?.recipeId, 'atm.default.normal.typescript');
    assert.equal(summary?.status, 'active');
    assert.equal(summary?.roleCount, teamRun.roles.length);
    assert.equal(summary?.leaseCount, teamRun.leases.length);
    assert.equal(summary?.agentsSpawned, false);

    const runtimePath = path.join(process.cwd(), '.atm', 'runtime', 'team-runs', `${teamRun.teamRunId}.json`);
    assert.equal(existsSync(runtimePath), true);
    rmSync(runtimePath, { force: true });

    console.log('[validate-team-agents] ok (start-status)');
    return;
  }

  if (taskCase === 'closure-summary') {
    const cwd = process.cwd();
    const teamRunId = 'team-closure-summary-fixture';
    const runtimePath = path.join(cwd, '.atm', 'runtime', 'team-runs', `${teamRunId}.json`);
    mkdirSync(path.dirname(runtimePath), { recursive: true });
    writeFileSync(runtimePath, `${JSON.stringify({
      schemaId: 'atm.teamRun.v1',
      teamRunId,
      taskId: 'TASK-TEAM-0016',
      actorId: 'validator',
      status: 'active',
      createdAt: '2026-06-14T00:00:00.000Z',
      updatedAt: '2026-06-14T00:00:00.000Z',
      captainDecision: { decision: 'close', reason: 'fixture captain decision' },
      agentReports: [{ role: 'validator', status: 'done', recommendation: 'close' }],
      patrolFindings: ['no scope drift found'],
      evidenceCuratorSummary: { summary: 'command-backed evidence remains authoritative' },
      teamSummary: {
        decision: 'close',
        implementationSummary: 'closure summary fixture',
        validators: ['typecheck'],
        evidence: ['fixture command evidence'],
        risk: 'low',
        closeReady: true
      }
    }, null, 2)}\n`, 'utf8');
    try {
      const packet = createClosurePacket({
        cwd,
        taskId: 'TASK-TEAM-0016',
        actorId: 'validator',
        evidencePath: '.atm/history/evidence/TASK-TEAM-0016.json',
        changedFiles: ['packages/cli/src/commands/team.ts']
      });
      assert.equal(packet.teamSummary?.teamRunId, teamRunId);
      assert.equal((packet.teamSummary?.captainDecision as any)?.decision, 'close');
      assert.equal(packet.teamSummary?.agentReports.length, 1);
      assert.equal(packet.teamSummary?.patrolFindings.length, 1);
      assert.equal((packet.teamSummary?.evidenceCuratorSummary as any)?.summary, 'command-backed evidence remains authoritative');

      const noSummaryPacket = createClosurePacket({
        cwd,
        taskId: 'TASK-TEAM-0016',
        actorId: 'validator',
        evidencePath: '.atm/history/evidence/TASK-TEAM-0016.json',
        changedFiles: ['packages/cli/src/commands/team.ts'],
        teamSummary: null
      });
      assert.equal(noSummaryPacket.teamSummary, null);
    } finally {
      rmSync(runtimePath, { force: true });
    }

    console.log('[validate-team-agents] ok (closure-summary)');
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
