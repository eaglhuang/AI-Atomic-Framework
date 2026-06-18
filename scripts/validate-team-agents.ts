import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CliError } from '../packages/cli/src/commands/shared.ts';
import { createClosurePacket } from '../packages/cli/src/commands/framework-development.ts';
import { assessLieutenantEscalation, buildAtomizationChecklist, buildTeamRuntimeContract, runTeam, selectTeamImplementer, validateTeamPermissionModel } from '../packages/cli/src/commands/team.ts';
import {
  validateScopeLeaseEpoch,
  validateScopeLeaseFencing,
  type ScopeLeaseRegistryEntry,
  type ScopeLeaseRunMode
} from '../packages/core/src/governance/scope-lock.ts';
import { planWaves, type WaveCandidateCard } from '../packages/core/src/broker/team-wave-planner.ts';
import { admitWave } from '../packages/core/src/broker/team-wave-admission.ts';
import { createTeamWaveEnvelope, validateTeamWaveEnvelope } from '../packages/core/src/broker/team-wave-envelope.ts';
import { assertCoordinatorOnly, type WaveRole } from '../packages/cli/src/commands/team-wave.ts';

const taskCase = getArg('--case') ?? 'lieutenant-escalation';

await main();

async function main() {
  // TASK-MAO-0027: Team Agents Wave Mode runtime self-check. Runs on every
  // invocation so any caller of this validator also asserts wave behavior.
  validateWaveMode();

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

  if (taskCase === 'fencing-deadlock') {
    const runModes: ScopeLeaseRunMode[] = ['real-agent', 'editor-subagent', 'broker-only'];
    for (const runMode of runModes) {
      const duplicateOwner = validateScopeLeaseFencing([
        scopeLease({ leaseId: `${runMode}-a`, runMode, owner: { instanceId: 'agent-a', worktreeId: 'wt-a' } }),
        scopeLease({ leaseId: `${runMode}-b`, runMode, owner: { instanceId: 'agent-b', worktreeId: 'wt-b' } })
      ]);
      assert.equal(duplicateOwner.ok, false);
      assert.ok(duplicateOwner.findings.some((finding) => finding.code === 'ATM_SCOPE_LEASE_DUPLICATE_EXCLUSIVE_OWNER'));

      const staleEpoch = validateScopeLeaseEpoch({
        leaseId: `${runMode}-epoch`,
        runMode,
        expectedEpoch: 20,
        actualEpoch: 19
      });
      assert.equal(staleEpoch.ok, false);
      const staleFinding = staleEpoch.findings.find((finding) => finding.code === 'ATM_SCOPE_LEASE_STALE_EPOCH');
      assert.equal(staleFinding?.expectedEpoch, 20);
      assert.equal(staleFinding?.actualEpoch, 19);

      const cycle = validateScopeLeaseFencing([
        scopeLease({ leaseId: `${runMode}-cycle-a`, runMode, resourceKey: 'src/a.ts', waitsFor: [`${runMode}-cycle-b`] }),
        scopeLease({ leaseId: `${runMode}-cycle-b`, runMode, resourceKey: 'src/b.ts', waitsFor: [`${runMode}-cycle-a`] })
      ]);
      assert.equal(cycle.ok, false);
      assert.ok(cycle.findings.some((finding) => finding.code === 'ATM_SCOPE_LEASE_WAIT_FOR_CYCLE'));

      const tombstone = validateScopeLeaseFencing([
        scopeLease({ leaseId: `${runMode}-released`, runMode, status: 'released', leaseEpoch: 10 }),
        scopeLease({ leaseId: `${runMode}-reacquire`, runMode, leaseEpoch: 10 })
      ]);
      assert.equal(tombstone.ok, false);
      assert.ok(tombstone.findings.some((finding) => finding.code === 'ATM_SCOPE_LEASE_TOMBSTONE_REACQUIRE'));
    }

    const acyclic = validateScopeLeaseFencing([
      scopeLease({ leaseId: 'acyclic-a', resourceKey: 'src/a.ts', waitsFor: ['acyclic-b'] }),
      scopeLease({ leaseId: 'acyclic-b', resourceKey: 'src/b.ts' })
    ]);
    assert.equal(acyclic.ok, true);

    const outsideAllowedFiles = validateScopeLeaseFencing([
      scopeLease({
        leaseId: 'outside-scope',
        allowedFiles: ['packages/cli/src/commands/team.ts'],
        writeSet: ['packages/cli/src/commands/next.ts']
      })
    ]);
    assert.equal(outsideAllowedFiles.ok, false);
    assert.ok(outsideAllowedFiles.findings.some((finding) => finding.code === 'ATM_SCOPE_LEASE_ALLOWED_FILES_VIOLATION'));

    console.log('[validate-team-agents] ok (fencing-deadlock)');
    return;
  }

  if (taskCase === 'active-resource-index-readonly') {
    const beforeStatus = await runTeam(['status', '--compact', '--cwd', process.cwd(), '--json']);
    const beforeEvidence = beforeStatus.evidence as any;
    const plan = await runTeam(['plan', '--task', 'TASK-TEAM-0018', '--cwd', process.cwd(), '--json']);
    const validate = await runTeam(['validate', '--task', 'TASK-TEAM-0018', '--cwd', process.cwd(), '--json']);
    const afterStatus = await runTeam(['status', '--compact', '--cwd', process.cwd(), '--json']);
    const afterEvidence = afterStatus.evidence as any;

    assert.equal(plan.ok, true);
    assert.equal(validate.ok, true);
    assert.equal(beforeEvidence?.teamRunCount, afterEvidence?.teamRunCount);
    assert.equal((plan.evidence as any)?.runtimeWritten, false);
    assert.equal((validate.evidence as any)?.runtimeWritten, false);
    assert.equal((plan.evidence as any)?.agentsSpawned, false);
    assert.equal((validate.evidence as any)?.agentsSpawned, false);
    assert.equal((plan.evidence as any)?.teamPlan?.brokerLane?.safeToStart, true);

    console.log('[validate-team-agents] ok (active-resource-index-readonly)');
    return;
  }

  if (taskCase === 'planning-path-lease-normalization') {
    const recipe = {
      schemaId: 'atm.teamRecipe.v1' as const,
      recipeId: 'validator.planning-path-lease-normalization',
      agents: [
        { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write'] },
        { agentId: 'implementer-typescript', role: 'implementer', profile: 'atm.implementer.typescript.v1', language: 'typescript', permissions: ['file.write'] },
        { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] }
      ]
    };
    const repoRoot = process.cwd();
    const targetAbsolute = path.join(repoRoot, 'packages/cli/src/commands/team.ts');
    const targetRelative = 'packages/cli/src/commands/team.ts';
    const planningAbsolute = 'C:/Users/User/3KLife/docs/ai_atomic_framework/team-agents/tasks/TASK-TEAM-0030.task.md';

    const targetRepoLease = validateTeamPermissionModel(recipe, [targetAbsolute], {
      allowedWritePaths: [targetRelative],
      repoRoot
    });
    assert.equal(targetRepoLease.ok, true);
    assert.equal(targetRepoLease.findings.length, 0);

    const planningRepoLease = validateTeamPermissionModel(recipe, [planningAbsolute], {
      allowedWritePaths: [targetRelative],
      repoRoot
    });
    assert.equal(planningRepoLease.ok, false);
    assert.ok(planningRepoLease.findings.some((finding) => finding.code === 'ATM_TEAM_WRITE_SCOPE_TRAVERSAL'));

    const validateResult = await runTeam(['validate', '--task', 'TASK-TEAM-0030', '--recipe', 'atm.default.normal.typescript', '--cwd', repoRoot, '--json']);
    const validateEvidence = validateResult.evidence as any;
    const validateFindings = validateEvidence?.validation?.findings ?? [];
    assert.equal(validateResult.ok, true);
    assert.equal(validateEvidence?.validation?.ok, true);
    assert.equal(validateFindings.some((finding: any) => finding.code === 'ATM_TEAM_WRITE_SCOPE_TRAVERSAL'), false);
    assert.equal(validateEvidence?.suggestedPermissionLeases?.some((lease: any) => lease.permission === 'file.write' && lease.paths?.some((entry: string) => entry.includes('3KLife'))), false);
    assert.ok(validateEvidence?.suggestedPermissionLeases?.some((lease: any) => lease.permission === 'file.write' && lease.paths?.includes(targetRelative)));

    console.log('[validate-team-agents] ok (planning-path-lease-normalization)');
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

  if (taskCase === 'runtime-mode-contract') {
    const defaultContract = buildTeamRuntimeContract({});
    assert.equal(defaultContract.runtimeMode, 'broker-only');
    assert.equal(defaultContract.runtimeLanguage, 'node');
    assert.equal(defaultContract.executionSurface, 'broker-governance');
    assert.equal(defaultContract.agentsSpawned, false);
    assert.ok(defaultContract.selectionReason.includes('broker-only selected'));

    const realAgentContract = buildTeamRuntimeContract({
      runtimeMode: 'real-agent',
      runtimeLanguage: 'python',
      runtimeAdapterId: 'atm.node.reference',
      providerId: 'local',
      sdkId: 'node-sdk',
      modelId: 'model-a'
    });
    assert.equal(realAgentContract.runtimeMode, 'real-agent');
    assert.equal(realAgentContract.runtimeLanguage, 'python');
    assert.equal(realAgentContract.runtimeAdapterId, 'atm.node.reference');
    assert.equal(realAgentContract.providerId, 'local');
    assert.equal(realAgentContract.sdkId, 'node-sdk');
    assert.equal(realAgentContract.modelId, 'model-a');
    assert.equal(realAgentContract.executionSurface, 'agent-runtime');
    assert.equal(realAgentContract.agentsSpawned, true);

    const editorContract = buildTeamRuntimeContract({ runtimeMode: 'editor-subagent' });
    assert.equal(editorContract.executionSurface, 'editor-subagent');
    assert.equal(editorContract.runtimeLanguage, 'node');

    assert.throws(
      () => buildTeamRuntimeContract({ runtimeMode: 'unsupported-mode' }),
      (error: unknown) => error instanceof CliError && error.code === 'ATM_TEAM_RUNTIME_MODE_INVALID'
    );

    const start = await runTeam([
      'start',
      '--task',
      'TASK-TEAM-0031',
      '--actor',
      'codex-runtime-validator',
      '--runtime-mode',
      'broker-only',
      '--runtime-adapter',
      'atm.node.broker',
      '--provider',
      'local',
      '--sdk',
      'none',
      '--model',
      'none',
      '--cwd',
      process.cwd(),
      '--json'
    ]);
    const evidence = start.evidence as any;
    assert.equal(start.ok, true);
    assert.equal(evidence?.runtimeContract?.schemaId, 'atm.teamRuntimeContract.v1');
    assert.equal(evidence?.runtimeContract?.runtimeMode, 'broker-only');
    assert.equal(evidence?.runtimeContract?.runtimeLanguage, 'node');
    assert.equal(evidence?.runtimeContract?.runtimeAdapterId, 'atm.node.broker');
    assert.equal(evidence?.runtimeContract?.providerId, 'local');
    assert.equal(evidence?.runtimeContract?.sdkId, 'none');
    assert.equal(evidence?.runtimeContract?.modelId, 'none');
    assert.equal(evidence?.runtimeContract?.executionSurface, 'broker-governance');
    assert.equal(evidence?.runtimeContract?.agentsSpawned, false);
    assert.equal(evidence?.agentsSpawned, false);
    assert.equal(evidence?.teamRun?.runtimeMode, 'broker-only');
    assert.equal(evidence?.teamRun?.runtimeLanguage, 'node');
    assert.equal(evidence?.teamRun?.runtimeAdapterId, 'atm.node.broker');
    assert.equal(evidence?.teamRun?.providerId, 'local');
    assert.equal(evidence?.teamRun?.sdkId, 'none');
    assert.equal(evidence?.teamRun?.modelId, 'none');
    assert.equal(evidence?.teamRun?.executionMode, 'manual-team');
    assert.equal(evidence?.teamRun?.executionSurface, 'broker-governance');
    assert.equal(evidence?.teamRun?.agentsSpawned, false);
    assert.ok(String(evidence?.teamRun?.teamSummary?.implementationSummary).includes('broker-only selected'));

    console.log('[validate-team-agents] ok (runtime-mode-contract)');
    return;
  }

  if (taskCase === 'claim-gate-parity') {
    const cwd = process.cwd();
    const taskId = 'TASK-TEAM-0029-FIXTURE';
    const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    const runtimeDir = path.join(cwd, '.atm', 'runtime', 'team-runs');
    const beforeRuntimeFiles = new Set(existsSync(runtimeDir) ? Array.from(readdirSync(runtimeDir)) : []);
    mkdirSync(path.dirname(taskPath), { recursive: true });
    writeFileSync(taskPath, `${JSON.stringify({
      schemaId: 'atm.taskLedger.v1',
      workItemId: taskId,
      title: 'Team claim gate parity fixture',
      status: 'ready',
      dependencies: ['TASK-TEAM-0029-MISSING-DEPENDENCY'],
      planningRepo: 'AI-Atomic-Framework',
      targetRepo: 'AI-Atomic-Framework',
      scopePaths: ['packages/cli/src/commands/team.ts'],
      deliverables: ['packages/cli/src/commands/team.ts'],
      validators: ['node --strip-types scripts/validate-team-agents.ts --case claim-gate-parity'],
      acceptance: ['Team start must fail closed when normal task claim dependency gates would reject the task.']
    }, null, 2)}\n`, 'utf8');
    try {
      const plan = await runTeam(['plan', '--task', taskId, '--cwd', cwd, '--json']);
      const planEvidence = plan.evidence as any;
      const planFindings = planEvidence?.teamPlan?.validation?.findings ?? [];
      assert.equal(plan.ok, false);
      assert.ok(planFindings.some((finding: any) => finding.code === 'ATM_TEAM_START_CLAIM_DEPENDENCY_BLOCKED'));

      const validate = await runTeam(['validate', '--task', taskId, '--cwd', cwd, '--json']);
      const validateEvidence = validate.evidence as any;
      assert.equal(validate.ok, true);
      assert.equal(validateEvidence?.safeToStart, false);
      assert.ok(validateEvidence?.relatedFindings?.some((finding: any) => finding.code === 'ATM_TEAM_START_CLAIM_DEPENDENCY_BLOCKED'));

      const start = await runTeam(['start', '--task', taskId, '--actor', 'claim-gate-validator', '--cwd', cwd, '--json']);
      const startEvidence = start.evidence as any;
      assert.equal(start.ok, false);
      assert.equal(startEvidence?.runtimeWritten, false);
      assert.ok(startEvidence?.validation?.findings?.some((finding: any) => finding.code === 'ATM_TEAM_START_CLAIM_DEPENDENCY_BLOCKED'));
      const afterRuntimeFiles = new Set(existsSync(runtimeDir) ? Array.from(readdirSync(runtimeDir)) : []);
      assert.deepEqual(afterRuntimeFiles, beforeRuntimeFiles);
    } finally {
      rmSync(taskPath, { force: true });
    }

    console.log('[validate-team-agents] ok (claim-gate-parity)');
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

  if (taskCase === 'knowledge-boundary') {
    const contract = readFileSync(path.join(process.cwd(), 'docs/governance/team-agents/knowledge-index-contract.md'), 'utf8');
    const templatesReadme = readFileSync(path.join(process.cwd(), 'docs/governance/team-agents/templates/README.md'), 'utf8');
    const shardTemplate = readFileSync(path.join(process.cwd(), 'docs/governance/team-agents/templates/team-memory-shard-template.md'), 'utf8');

    for (const content of [contract, templatesReadme, shardTemplate]) {
      assert.ok(content.includes('.atm/knowledge/**'));
      assert.ok(content.includes('.atm/runtime/knowledge/**'));
      assert.match(content, /advisory/i);
    }

    assert.match(contract, /not a second task\s+registry|never a second task\s+registry/i);
    assert.match(contract, /promotion path/i);
    assert.match(contract, /closure authority/i);
    assert.match(templatesReadme, /cache-only/i);
    assert.match(shardTemplate, /Authority: advisory-only/);

    console.log('[validate-team-agents] ok (knowledge-boundary)');
    return;
  }

  if (taskCase === 'knowledge-build-query') {
    const cwd = path.join(process.cwd(), '.atm-temp', 'validate-team-knowledge');
    rmSync(cwd, { recursive: true, force: true });
    mkdirSync(path.join(cwd, '.atm', 'knowledge', 'team'), { recursive: true });
    writeFileSync(path.join(cwd, '.atm', 'knowledge', 'team', 'routing.md'), [
      '# Team routing knowledge',
      'repo: AI-Atomic-Framework',
      'channel: normal',
      'domain: team-agents',
      'paths: packages/cli/src/commands/team.ts, scripts/validate-team-agents.ts',
      'atoms: team.knowledge-build-query',
      'validators: npm run validate:cli, node --strip-types scripts/validate-team-agents.ts',
      '',
      'Use this advisory shard when a Team Agents task needs metadata filtering before lexical ranking.'
    ].join('\n'), 'utf8');

    try {
      const dryRun = await runTeam(['knowledge', 'build', '--scope', 'project', '--dry-run', '--cwd', cwd, '--json']);
      const dryEvidence = dryRun.evidence as any;
      assert.equal(dryRun.ok, true);
      assert.equal(dryEvidence?.action, 'knowledge.build');
      assert.equal(dryEvidence?.advisoryOnly, true);
      assert.equal(dryEvidence?.dryRun, true);
      assert.equal(dryEvidence?.shardCount, 1);
      assert.equal(existsSync(path.join(cwd, '.atm', 'runtime', 'knowledge', 'team-knowledge-index.json')), false);

      const missingQuery = await runTeam(['knowledge', 'query', '--query', 'metadata filtering lexical ranking', '--top', '5', '--cwd', cwd, '--json']);
      const missingEvidence = missingQuery.evidence as any;
      assert.equal(missingQuery.ok, true);
      assert.equal(missingEvidence?.indexStatus, 'missing');
      assert.ok(missingQuery.messages.some((entry: any) => entry.code === 'ATM_TEAM_KNOWLEDGE_INDEX_MISSING'));
      assert.ok(String(missingEvidence?.buildCommand).includes('team knowledge build'));

      const writeBuild = await runTeam(['knowledge', 'build', '--scope', 'project', '--write', '--cwd', cwd, '--json']);
      assert.equal(writeBuild.ok, true);
      assert.equal(existsSync(path.join(cwd, '.atm', 'runtime', 'knowledge', 'team-knowledge-index.json')), true);

      const query = await runTeam([
        'knowledge',
        'query',
        '--query',
        'metadata filtering lexical ranking',
        '--domain',
        'team-agents',
        '--atom',
        'team.knowledge-build-query',
        '--top',
        '5',
        '--cwd',
        cwd,
        '--json'
      ]);
      const queryEvidence = query.evidence as any;
      assert.equal(query.ok, true);
      assert.equal(queryEvidence?.action, 'knowledge.query');
      assert.equal(queryEvidence?.advisoryOnly, true);
      assert.equal(queryEvidence?.indexStatus, 'ready');
      assert.equal(queryEvidence?.hits?.length, 1);
      assert.equal(queryEvidence?.hits?.[0]?.path, '.atm/knowledge/team/routing.md');
      assert.equal(typeof queryEvidence?.hits?.[0]?.snippet, 'string');
      assert.equal(Object.hasOwn(queryEvidence.hits[0], 'searchText'), false);

      mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
      writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', 'TASK-KNOW-0001.json'), `${JSON.stringify({
        schemaId: 'atm.taskLedger.v1',
        workItemId: 'TASK-KNOW-0001',
        title: 'Team routing knowledge task',
        status: 'ready',
        scopePaths: ['packages/cli/src/commands/team.ts'],
        deliverables: ['packages/cli/src/commands/team.ts'],
        validators: ['node --strip-types scripts/validate-team-agents.ts --case knowledge-build-query'],
        acceptance: ['Captain brief shows advisory knowledge hits.']
      }, null, 2)}\n`, 'utf8');
      const plan = await runTeam(['plan', '--task', 'TASK-KNOW-0001', '--cwd', cwd, '--json']);
      const planEvidence = plan.evidence as any;
      assert.equal(planEvidence?.teamPlan?.knowledgeSummary?.schemaId, 'atm.teamKnowledgeSummary.v1');
      assert.equal(planEvidence?.teamPlan?.knowledgeSummary?.advisoryOnly, true);
      assert.equal(planEvidence?.teamPlan?.knowledgeSummary?.top, 3);
      assert.ok(Array.isArray(planEvidence?.teamPlan?.knowledgeSummary?.hits));
      assert.ok(String(planEvidence?.teamPlan?.knowledgeSummary?.followUpCommand).includes('team knowledge query'));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    console.log('[validate-team-agents] ok (knowledge-build-query)');
    return;
  }

  if (taskCase === 'knowledge-retention-budget') {
    const cwd = path.join(process.cwd(), '.atm-temp', 'validate-team-knowledge-retention');
    rmSync(cwd, { recursive: true, force: true });
    mkdirSync(path.join(cwd, '.atm', 'knowledge', 'team'), { recursive: true });
    mkdirSync(path.join(cwd, '.atm', 'runtime', 'knowledge', 'embeddings'), { recursive: true });
    writeFileSync(path.join(cwd, '.atm', 'knowledge', 'team', 'active.md'), [
      '# Active team lesson',
      'status: active',
      'domain: team-agents',
      '',
      'Retained advisory knowledge for active Team Agents work.'
    ].join('\n'), 'utf8');
    writeFileSync(path.join(cwd, '.atm', 'knowledge', 'team', 'old-superseded.md'), [
      '# Old team lesson',
      'status: superseded',
      'supersededBy: .atm/knowledge/team/active.md',
      '',
      'This shard remains canonical source and requires human review before archive.'
    ].join('\n'), 'utf8');
    writeFileSync(path.join(cwd, '.atm', 'runtime', 'knowledge', 'team-knowledge-index.json'), '{"entries":[]}\n', 'utf8');
    writeFileSync(path.join(cwd, '.atm', 'runtime', 'knowledge', 'embeddings', 'lesson-cache.bin'), 'runtime embedding cache fixture', 'utf8');

    try {
      const stats = await runTeam(['knowledge', 'stats', '--cwd', cwd, '--warning-bytes', '1', '--budget-bytes', '10', '--json']);
      const statsEvidence = stats.evidence as any;
      assert.equal(stats.ok, true);
      assert.equal(statsEvidence?.action, 'knowledge.stats');
      assert.equal(statsEvidence?.schemaId, 'atm.teamKnowledgeStats.v1');
      assert.equal(statsEvidence?.advisoryOnly, true);
      assert.equal(statsEvidence?.shardCount, 2);
      assert.ok(statsEvidence?.runtimeIndexBytes > 0);
      assert.ok(statsEvidence?.runtimeCacheBytes > 0);
      assert.ok(statsEvidence?.embeddingCacheBytes > 0);
      assert.equal(statsEvidence?.supersededShardCount, 1);
      assert.equal(statsEvidence?.archiveCandidateCount, 1);
      assert.equal(statsEvidence?.budget?.status, 'hard-limit');

      const compact = await runTeam(['knowledge', 'compact', '--dry-run', '--cwd', cwd, '--json']);
      const compactEvidence = compact.evidence as any;
      assert.equal(compact.ok, true);
      assert.equal(compactEvidence?.action, 'knowledge.compact');
      assert.equal(compactEvidence?.dryRun, true);
      assert.equal(compactEvidence?.canonicalMutated, false);
      assert.equal(compactEvidence?.runtimeCacheMutated, false);
      assert.equal(compactEvidence?.archiveCandidates?.length, 1);
      assert.equal(compactEvidence?.archiveCandidates?.[0]?.path, '.atm/knowledge/team/old-superseded.md');
      assert.ok(compactEvidence?.runtimePrunableFiles?.some((entry: any) => entry.path === '.atm/runtime/knowledge/embeddings/lesson-cache.bin'));
      assert.equal(existsSync(path.join(cwd, '.atm', 'knowledge', 'team', 'old-superseded.md')), true);
      assert.equal(existsSync(path.join(cwd, '.atm', 'runtime', 'knowledge', 'embeddings', 'lesson-cache.bin')), true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    console.log('[validate-team-agents] ok (knowledge-retention-budget)');
    return;
  }

  if (taskCase === 'knowledge-hybrid-rerank') {
    const cwd = path.join(process.cwd(), '.atm-temp', 'validate-team-knowledge-hybrid');
    rmSync(cwd, { recursive: true, force: true });
    mkdirSync(path.join(cwd, '.atm', 'knowledge', 'team'), { recursive: true });
    writeFileSync(path.join(cwd, '.atm', 'knowledge', 'team', 'alpha.md'), [
      '# Alpha lexical note',
      'domain: team-agents',
      'atoms: team.knowledge-hybrid-rerank',
      '',
      'Lexical common routing alpha baseline note for Team knowledge retrieval.'
    ].join('\n'), 'utf8');
    writeFileSync(path.join(cwd, '.atm', 'knowledge', 'team', 'beta.md'), [
      '# Beta semantic note',
      'domain: team-agents',
      'atoms: team.knowledge-hybrid-rerank',
      '',
      'Lexical common semantic captain vector note for opt-in Team knowledge retrieval.'
    ].join('\n'), 'utf8');

    try {
      const writeBuild = await runTeam(['knowledge', 'build', '--scope', 'project', '--write', '--cwd', cwd, '--json']);
      assert.equal(writeBuild.ok, true);

      const lexicalOnly = await runTeam([
        'knowledge',
        'query',
        '--query',
        'lexical common captain vector',
        '--top',
        '2',
        '--cwd',
        cwd,
        '--json'
      ]);
      const lexicalEvidence = lexicalOnly.evidence as any;
      assert.equal(lexicalOnly.ok, true);
      assert.equal(lexicalEvidence?.hybridRetrieval?.requested, false);
      assert.equal(lexicalEvidence?.hybridRetrieval?.applied, false);

      const missingCache = await runTeam([
        'knowledge',
        'query',
        '--query',
        'lexical common captain vector',
        '--top',
        '2',
        '--vector-rerank',
        '--cwd',
        cwd,
        '--json'
      ]);
      const missingEvidence = missingCache.evidence as any;
      assert.equal(missingCache.ok, true);
      assert.equal(missingEvidence?.hybridRetrieval?.requested, true);
      assert.equal(missingEvidence?.hybridRetrieval?.applied, false);
      assert.equal(missingEvidence?.hybridRetrieval?.fallback, 'embedding-cache-missing-or-invalid');
      assert.equal(missingEvidence?.hybridRetrieval?.lexicalBaselineRequired, true);

      mkdirSync(path.join(cwd, '.atm', 'runtime', 'knowledge'), { recursive: true });
      writeFileSync(path.join(cwd, '.atm', 'runtime', 'knowledge', 'team-knowledge-embeddings.json'), `${JSON.stringify({
        schemaId: 'atm.teamKnowledgeEmbeddingCache.v1',
        advisoryOnly: true,
        entries: [
          { path: '.atm/knowledge/team/alpha.md', vector: { alpha: 4, baseline: 1 } },
          { path: '.atm/knowledge/team/beta.md', vector: { captain: 3, vector: 3, semantic: 1 } }
        ]
      }, null, 2)}\n`, 'utf8');

      const reranked = await runTeam([
        'knowledge',
        'query',
        '--query',
        'lexical common captain vector',
        '--top',
        '2',
        '--vector-rerank',
        '--cwd',
        cwd,
        '--json'
      ]);
      const rerankEvidence = reranked.evidence as any;
      assert.equal(reranked.ok, true);
      assert.equal(rerankEvidence?.hybridRetrieval?.requested, true);
      assert.equal(rerankEvidence?.hybridRetrieval?.applied, true);
      assert.equal(rerankEvidence?.hybridRetrieval?.lexicalBaselineRequired, true);
      assert.ok(rerankEvidence?.hybridRetrieval?.lexicalShortlistSize >= 2);
      assert.equal(rerankEvidence?.hits?.[0]?.path, '.atm/knowledge/team/beta.md');
      assert.equal(typeof rerankEvidence?.hits?.[0]?.semanticScore, 'number');
      assert.equal(Object.hasOwn(rerankEvidence.hits[0], 'searchText'), false);

      const stats = await runTeam(['knowledge', 'stats', '--cwd', cwd, '--json']);
      const statsEvidence = stats.evidence as any;
      assert.ok(statsEvidence?.embeddingCacheBytes > 0);
      assert.ok(statsEvidence?.runtimeFiles?.some((entry: any) => entry.path === '.atm/runtime/knowledge/team-knowledge-embeddings.json' && entry.prunable === true));
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    console.log('[validate-team-agents] ok (knowledge-hybrid-rerank)');
    return;
  }

  if (taskCase === 'patrol-report') {
    const cwd = path.join(process.cwd(), '.atm-temp', 'validate-team-patrol');
    const taskId = 'TASK-PATROL-0001';
    const teamRunId = 'team-patrol-fixture';
    rmSync(cwd, { recursive: true, force: true });
    mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
    mkdirSync(path.join(cwd, '.atm', 'runtime', 'team-runs'), { recursive: true });
    writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`), `${JSON.stringify({
      schemaId: 'atm.taskLedger.v1',
      workItemId: taskId,
      title: 'Patrol report fixture',
      status: 'running',
      planningRepo: 'AI-Atomic-Framework',
      targetRepo: 'AI-Atomic-Framework',
      targetAllowedFiles: [
        'packages/cli/src/commands/team.ts',
        'packages/cli/src/commands/command-specs/team.spec.ts',
        'scripts/validate-team-agents.ts',
        'atomic_workbench/atomization-coverage/path-to-atom-map.json'
      ],
      deliverables: ['packages/cli/src/commands/team.ts'],
      validators: ['node --strip-types scripts/validate-team-agents.ts --case patrol-report'],
      acceptance: ['Patrol output is read-only and reports runtime findings.']
    }, null, 2)}\n`, 'utf8');
    writeFileSync(path.join(cwd, '.atm', 'runtime', 'team-runs', `${teamRunId}.json`), `${JSON.stringify({
      schemaId: 'atm.teamRun.v1',
      teamRunId,
      taskId,
      actorId: 'captain',
      status: 'active',
      executionMode: 'manual-team',
      agentsSpawned: false,
      retryBudget: { remaining: 0, limit: 2 },
      reworkRoute: { status: 'needs-rework' },
      createdAt: '2026-06-18T00:00:00.000Z',
      updatedAt: '2026-06-18T00:00:00.000Z'
    }, null, 2)}\n`, 'utf8');

    try {
      const beforeHistory = listRelativeFiles(path.join(cwd, '.atm', 'history'));
      const beforeRuntime = listRelativeFiles(path.join(cwd, '.atm', 'runtime'));
      const patrol = await runTeam(['patrol', '--task', taskId, '--team', teamRunId, '--cwd', cwd, '--json']);
      const evidence = patrol.evidence as any;
      assert.equal(patrol.ok, true);
      assert.equal(evidence?.schemaId, 'atm.teamPatrolReport.v1');
      assert.equal(evidence?.action, 'patrol');
      assert.equal(evidence?.readOnly, true);
      assert.equal(evidence?.runtimeWritten, false);
      assert.equal(evidence?.historyWritten, false);
      assert.equal(evidence?.agentsSpawned, false);
      assert.deepEqual(evidence?.mutations, []);
      assert.equal(evidence?.taskId, taskId);
      assert.equal(evidence?.runId, `patrol-${taskId}-claim-preflight`);
      assert.ok(Array.isArray(evidence?.patrolTeam) && evidence.patrolTeam.includes('atomic-police'));
      assert.equal(evidence?.mode, 'claim-preflight');
      assert.equal(evidence?.severity, 'blocker');
      assert.equal(evidence?.safeToProceed, false);
      assert.ok(evidence?.findings?.some((finding: any) => finding.level === 'blocker' && finding.category === 'retry-budget'));
      assert.ok(evidence?.findings?.some((finding: any) => finding.level === 'warning' && finding.category === 'rework-state'));
      assert.ok(evidence?.findings?.some((finding: any) => finding.category === 'scope'));
      assert.equal(typeof evidence?.suggestedCommand, 'string');
      assert.ok(Array.isArray(evidence?.followUp) && evidence.followUp.length > 0);
      assert.deepEqual(listRelativeFiles(path.join(cwd, '.atm', 'history')), beforeHistory);
      assert.deepEqual(listRelativeFiles(path.join(cwd, '.atm', 'runtime')), beforeRuntime);

      for (const mode of ['close-preflight', 'big-script', 'daily-noon']) {
        const modeResult = await runTeam(['patrol', '--task', taskId, '--mode', mode, '--cwd', cwd, '--json']);
        const modeEvidence = modeResult.evidence as any;
        assert.equal(modeResult.ok, true);
        assert.equal(modeEvidence?.mode, mode);
        assert.deepEqual(modeEvidence?.mutations, []);
      }
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }

    console.log('[validate-team-agents] ok (patrol-report)');
    return;
  }

  fail(`unsupported or missing --case value: ${taskCase}`);
}

function getArg(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function waveCard(over: Partial<WaveCandidateCard> & { taskId: string }): WaveCandidateCard {
  return {
    taskId: over.taskId,
    dependencies: over.dependencies ?? [],
    scopePaths: over.scopePaths ?? [`src/${over.taskId}.ts`],
    deliverables: over.deliverables ?? [`src/${over.taskId}.ts`],
    validators: over.validators ?? ['npm run typecheck'],
    targetRepo: over.targetRepo ?? 'repo-x',
    closureAuthority: over.closureAuthority ?? 'target_repo',
    ownerAtomOrMap: over.ownerAtomOrMap ?? null
  };
}

function scopeLease(over: Partial<ScopeLeaseRegistryEntry> & { leaseId: string }): ScopeLeaseRegistryEntry {
  return {
    leaseId: over.leaseId,
    taskId: over.taskId ?? 'TASK-TEAM-0018',
    resourceKey: over.resourceKey ?? 'packages/cli/src/commands/team.ts',
    owner: over.owner ?? { instanceId: 'agent-a', worktreeId: 'wt-a' },
    runMode: over.runMode ?? 'real-agent',
    leaseEpoch: over.leaseEpoch ?? 1,
    status: over.status ?? 'active',
    allowedFiles: over.allowedFiles ?? ['packages/cli/src/commands/team.ts'],
    writeSet: over.writeSet ?? ['packages/cli/src/commands/team.ts'],
    ...(over.waitsFor ? { waitsFor: over.waitsFor } : {}),
    ...(over.releasedAt ? { releasedAt: over.releasedAt } : {})
  };
}

function validateWaveMode(): void {
  // Safe wave: disjoint cards plan into one wave and admit fully.
  const safePlan = planWaves({ cards: [waveCard({ taskId: 'T-A' }), waveCard({ taskId: 'T-B' })] });
  if (safePlan.waves.length !== 1) fail('wave-mode: safe wave must plan into one wave');
  const safe = admitWave({ members: [{ card: waveCard({ taskId: 'T-A' }) }, { card: waveCard({ taskId: 'T-B' }) }] });
  if (!safe.ok || safe.admitted.length !== 2) fail('wave-mode: safe wave must admit all members');

  // Unsafe wave: same deliverable fails closed.
  const unsafe = admitWave({
    members: [
      { card: waveCard({ taskId: 'T-A', scopePaths: ['s.ts'], deliverables: ['s.ts'] }) },
      { card: waveCard({ taskId: 'T-B', scopePaths: ['s.ts'], deliverables: ['s.ts'] }) }
    ]
  });
  if (unsafe.admitted.length !== 1 || unsafe.rejected.length !== 1) {
    fail('wave-mode: unsafe wave must reject the conflicting member');
  }

  // Mixed wave: dependency-blocked member is deferred.
  const mixed = admitWave({
    members: [{ card: waveCard({ taskId: 'T-A' }) }, { card: waveCard({ taskId: 'T-B', dependencies: ['T-OPEN'] }) }]
  });
  if (!mixed.admitted.includes('T-A') || !mixed.rejected.some((r) => r.taskId === 'T-B')) {
    fail('wave-mode: mixed wave must admit ready and defer blocked members');
  }

  // Envelope: validates and enforces disjoint deliverables.
  const env = createTeamWaveEnvelope({
    coordinatorActorId: 'coordinator',
    targetRepo: 'repo-x',
    closureAuthority: 'target_repo',
    waveIndex: 0,
    members: [
      { taskId: 'T-A', workerActorId: null, scopePaths: ['a.ts'], deliverables: ['a.ts'], patchEnvelopeId: null },
      { taskId: 'T-B', workerActorId: null, scopePaths: ['b.ts'], deliverables: ['b.ts'], patchEnvelopeId: null }
    ]
  });
  if (!validateTeamWaveEnvelope(env).ok) fail('wave-mode: clean wave envelope must validate');

  // TASK-MAO-0032: validator / reviewer Team Agents roles are advisory — only the
  // coordinator may perform privileged git / closeout / checkpoint actions.
  if (!assertCoordinatorOnly('coordinator', 'task-closeout').allowed) {
    fail('wave-mode: coordinator must be allowed to drive closeout');
  }
  const advisoryRoles: WaveRole[] = ['worker', 'validator', 'reviewer'];
  for (const role of advisoryRoles) {
    if (assertCoordinatorOnly(role, 'git-write').allowed) {
      fail(`wave-mode: advisory role ${role} must not be allowed git-write`);
    }
    if (assertCoordinatorOnly(role, 'task-closeout').allowed) {
      fail(`wave-mode: advisory role ${role} must not be allowed task-closeout`);
    }
  }

  console.log('[validate-team-agents] wave-mode checks ok (safe / unsafe / mixed / envelope / roles)');
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

function listRelativeFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const files: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current)) {
      const fullPath = path.join(current, entry);
      const relative = path.relative(root, fullPath).replace(/\\/g, '/');
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        visit(fullPath);
      } else {
        files.push(relative);
      }
    }
  };
  visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

function fail(message: string): never {
  console.error(`[validate-team-agents] ${message}`);
  process.exit(1);
}
