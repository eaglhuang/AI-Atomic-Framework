import path from 'node:path';
import { buildTeamBrokerEvidence, brokerLaneToFindings, evaluateTeamBrokerLane } from '../../../../../core/dist/broker/team-lane.js';
import { buildTeamObservabilityContract } from '../../../../../core/dist/team-runtime/observability.js';
import { readJsonFile } from '../../shared.js';
import { buildTeamGrowthContract, buildTeamRoleGrowthObservabilityContract } from '../growth-contract.js';
import { buildProviderNeutralRoleSkillPackManifest, buildTeamRoleRoutingMatrix, buildTeamRoleSkillPackContract } from '../role-skill-packs.js';
import { buildAnthropicRuntimeBridgeSummary, buildEditorExecutionRuntimeBridgeSummary, buildMicrosoftFoundryRuntimeBridgeSummary, buildOpenAIFamilyRuntimeBridgeSummary } from '../runtime-bridges.js';
import { buildRuntimeTierContract } from '../runtime-tier-contract.js';
import { buildTeamShadowScheduleForPlan } from '../shadow-plan.js';
import { buildAtomizationChecklist, buildCaptainDecision, buildMinimalTaskCrewBriefingContract } from './crew-decision-policy.js';
import { mapTeamSizeToLevel, projectTeamRecipeForLevel, selectTeamImplementer } from './implementer-selector-policy.js';
import { buildPermissionFinding, buildProposalFirstParityFindings, buildSuggestedPermissionLeases } from './permission-lease-policy.js';
export function resolveTeamPlanActorId(input) {
    const requested = String(input.requestedActorId ?? input.explicitActorId ?? '').trim();
    if (requested) {
        return requested;
    }
    const fallback = String(input.fallbackActorId ?? '').trim() || 'team-planner';
    return readActiveTaskClaimActorId(input.cwd, input.taskId) ?? fallback;
}
export function readActiveTaskClaimActorId(cwd, taskId) {
    try {
        const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
        const task = readJsonFile(taskPath);
        const claim = task.claim && typeof task.claim === 'object' ? task.claim : null;
        if (!claim || String(claim.state ?? '').trim() !== 'active') {
            return null;
        }
        const actorId = String(claim.actorId ?? '').trim();
        if (!actorId) {
            return null;
        }
        const heartbeatAt = String(claim.heartbeatAt ?? claim.claimedAt ?? '').trim();
        const ttlSeconds = Number(claim.ttlSeconds ?? 0);
        if (heartbeatAt && Number.isFinite(ttlSeconds) && ttlSeconds > 0) {
            const heartbeatMs = Date.parse(heartbeatAt);
            if (Number.isFinite(heartbeatMs) && Date.now() - heartbeatMs > ttlSeconds * 1000) {
                return null;
            }
        }
        return actorId;
    }
    catch {
        return null;
    }
}
export function planTeamBrokerLane(input) {
    const brokerLaneResult = evaluateTeamBrokerLane({
        cwd: input.cwd,
        taskId: input.taskId,
        actorId: input.actorId,
        task: input.task,
        writePaths: input.writePaths,
        readOnly: input.readOnly === true
    });
    const findings = brokerLaneToFindings(brokerLaneResult).map((finding) => buildPermissionFinding({
        level: finding.level,
        code: finding.code,
        detail: finding.detail,
        paths: finding.paths
    }));
    return {
        result: brokerLaneResult,
        evidence: buildTeamBrokerEvidence(brokerLaneResult),
        findings: [
            ...findings,
            ...buildProposalFirstParityFindings({
                taskId: input.taskId,
                brokerLaneResult,
                advisoryOnly: input.readOnly === true
            })
        ]
    };
}
export function buildTeamPlan(input) {
    const atomizationChecklist = buildAtomizationChecklist(input.task, input.writePaths);
    const crewBriefingContract = buildMinimalTaskCrewBriefingContract(input.task, input.writePaths, input.validation, input.brokerLane);
    const implementerSelector = selectTeamImplementer(input.task, input.recipe, input.writePaths);
    const captainDecision = buildCaptainDecision(input.task, input.writePaths, input.validation, input.brokerLane, crewBriefingContract, atomizationChecklist, implementerSelector, input.requestedTeamSize);
    const activeTeamLevel = captainDecision.teamLevel ?? mapTeamSizeToLevel(captainDecision.teamSize);
    const rosterProjection = projectTeamRecipeForLevel(input.recipe, activeTeamLevel);
    const activeRecipe = rosterProjection.recipe;
    const roleSkillPacks = buildTeamRoleSkillPackContract(activeRecipe);
    const roleSkillPackManifest = buildProviderNeutralRoleSkillPackManifest({
        recipe: activeRecipe,
        roleSkillPacks,
        selectionConfig: input.providerSelectionConfig ?? undefined
    });
    const routingMatrix = buildTeamRoleRoutingMatrix(roleSkillPacks);
    const growthContract = buildTeamGrowthContract();
    const observabilityContract = buildTeamObservabilityContract();
    const roleGrowthObservabilityContract = buildTeamRoleGrowthObservabilityContract({
        roleSkillPacks,
        growthContract
    });
    const runtimeTierContract = buildRuntimeTierContract(activeRecipe);
    const runtimePilot = buildTeamRuntimePilot({
        roleSkillPacks,
        routingMatrix,
        growthContract,
        validation: input.validation,
        brokerLane: input.brokerLane
    });
    const shadowSchedule = buildTeamShadowScheduleForPlan({
        cwd: input.cwd ?? process.cwd(),
        task: input.task,
        recipe: activeRecipe,
        writePaths: input.writePaths,
        captainDecision,
        validation: input.validation,
        brokerLane: input.brokerLane
    });
    const governanceRuntime = buildTeamGovernanceRuntimeFields({
        validation: input.validation,
        brokerLane: input.brokerLane,
        runtimePilot,
        captainDecision
    });
    return {
        schemaId: 'atm.teamPlan.v1',
        recipeId: activeRecipe.recipeId,
        channelHint: 'normal',
        teamLevel: activeTeamLevel,
        rosterProjection: rosterProjection.projection,
        governanceRuntime,
        decisionClass: governanceRuntime.decisionClass,
        decisionReason: governanceRuntime.decisionReason,
        requiresHumanSignoff: governanceRuntime.requiresHumanSignoff,
        requiresAdr: governanceRuntime.requiresAdr,
        violationStatus: governanceRuntime.violationStatus,
        escalationTarget: governanceRuntime.escalationTarget,
        providerSelectionSource: input.providerSelectionSource ?? null,
        brokerLane: input.brokerLane,
        indexLane: input.gitIndexOwnership?.indexLane ?? {
            schemaId: 'atm.gitIndexLane.v1',
            status: 'free',
            ownerTaskId: null,
            ownerActorId: null,
            reason: 'Git index ownership was not inspected for this team plan.'
        },
        gitIndexOwnership: input.gitIndexOwnership ?? null,
        agents: activeRecipe.agents,
        captainDecision,
        implementerSelector,
        roleSkillPacks,
        roleSkillPackManifest,
        routingMatrix,
        growthContract,
        observabilityContract,
        roleGrowthObservabilityContract,
        runtimeTierContract,
        shadowSchedule,
        openAIFamilyRuntimeBridges: buildOpenAIFamilyRuntimeBridgeSummary(),
        editorExecutionRuntimeBridges: buildEditorExecutionRuntimeBridgeSummary(),
        microsoftFoundryRuntimeBridges: buildMicrosoftFoundryRuntimeBridgeSummary(),
        anthropicRuntimeBridges: buildAnthropicRuntimeBridgeSummary(),
        runtimePilot,
        ...(input.knowledgeSummary ? { knowledgeSummary: input.knowledgeSummary } : {}),
        requiredRoles: crewBriefingContract.requiredRoles,
        optionalRoles: crewBriefingContract.optionalRoles,
        briefingContract: crewBriefingContract,
        atomizationPlannerRole: {
            role: 'atomizationPlanner',
            agentIds: input.recipe.agents.filter((agent) => agent.role === 'atomizationPlanner').map((agent) => agent.agentId),
            permissions: input.recipe.agents.find((agent) => agent.role === 'atomizationPlanner')?.permissions ?? []
        },
        atomizationChecklist,
        suggestedPermissionLeases: buildSuggestedPermissionLeases(input.recipe, input.writePaths, { allowEmptyWriteScope: input.allowEmptyWriteScope }),
        nextSteps: [
            'Review this dry-run plan.',
            'Run team start when you want a runtime team run record.',
            'Do not hand-edit .atm/runtime team state.'
        ],
        validation: input.validation
    };
}
export function buildTeamRuntimePilot(input) {
    const orderedRoles = ['coordinator', 'implementer', 'validator'];
    const selectedRoles = orderedRoles.filter((role) => input.roleSkillPacks.roles.some((entry) => entry.role === role));
    const pilotRoles = selectedRoles.length >= 3 ? selectedRoles.slice(0, 3) : selectedRoles.slice(0, 2);
    const selectedEntries = input.roleSkillPacks.roles.filter((entry) => pilotRoles.includes(entry.role));
    const blockedByBroker = input.brokerLane.safeToStart === false;
    const brokerViolationStatus = blockedByBroker
        ? input.brokerLane.decision.admission?.state === 'proposal-submitted'
            ? 'proposal-submitted'
            : 'broker-conflict-blocked'
        : 'none';
    const brokerConflictVocabulary = {
        decisionClass: blockedByBroker ? 'blocked' : 'auto-execution',
        decisionReason: input.brokerLane.blockedReasons[0] ?? input.brokerLane.decision.reason ?? 'Team Broker allowed the runtime pilot lane.',
        violationStatus: blockedByBroker
            ? brokerViolationStatus === 'proposal-submitted'
                ? 'proposal-submitted'
                : 'broker-conflict-blocked'
            : 'none',
        blockedCode: blockedByBroker && brokerViolationStatus !== 'proposal-submitted' ? 'broker-conflict-blocked' : null
    };
    const actionableRefinementFindings = [
        ...input.validation.findings.map((finding) => ({
            category: classifyTeamPilotFinding(finding.code),
            summary: finding.summary,
            detail: finding.detail,
            correctRoute: 'Keep Coordinator authority primary, resolve lease or scope blockers first, then rerun team validate or team start.',
            promotionTarget: input.growthContract.promotionPolicy.rawCaseTarget
        })),
        ...normalizeTeamBrokerPilotFindings(input.brokerLane, input.growthContract.promotionPolicy.rawCaseTarget)
    ];
    return {
        schemaId: 'atm.teamRuntimePilot.v1',
        providerNeutral: true,
        coordinatorOwnsLifecycle: true,
        pilotMode: pilotRoles.length >= 3 ? 'role-trio' : 'role-pair',
        selectedRoles: pilotRoles,
        selectedSkillPackIds: selectedEntries.map((entry) => entry.skillPackId),
        agentSkillUnits: selectedEntries.map((entry) => ({
            role: entry.role,
            agentId: entry.agentId,
            skillPackId: entry.skillPackId,
            boundedSkillPackLoaded: true,
            permissionLease: {
                allowedPermissions: entry.allowedPermissions,
                forbiddenPermissions: entry.forbiddenPermissions
            },
            playbookSlice: entry.playbookSlice,
            lifecycleAuthority: entry.role === 'coordinator' ? 'coordinator-owned' : 'worker-forbidden'
        })),
        realisticWorkflow: [
            'Coordinator routes the task and remains the only lifecycle and git.write owner.',
            'Implementer loads only the scoped delivery pack for the active workstream.',
            'Validator loads only validator-evidence guidance and returns findings to Coordinator.'
        ],
        workflowEvidence: {
            scenarioId: 'agent-plus-skill-runtime-pilot',
            roleOrder: input.routingMatrix.routes.find((route) => route.workstream === 'scoped-implementation')?.roleOrder ?? pilotRoles,
            coordinatorOnlyLifecyclePreserved: true,
            workerWriteScope: 'bounded-by-task-lease',
            blockedByBroker,
            brokerViolationStatus
        },
        roleBoundarySignals: [
            ...selectedEntries.map((entry) => `${entry.role} -> ${entry.playbookSlice}`),
            ...input.routingMatrix.routes
                .filter((route) => ['task-entry-routing', 'scoped-implementation', 'validation-and-evidence'].includes(route.workstream))
                .map((route) => `${route.workstream}: ${route.primaryRole}`)
        ],
        lifecycleAuthority: {
            ownerRole: 'coordinator',
            forbiddenToWorkers: ['task.lifecycle', 'git.write', 'self-close']
        },
        roleConfusionReduction: [
            'Each pilot role loads only its bounded skill pack instead of a monolithic governance skill.',
            'Workers return findings or diffs to Coordinator instead of widening into closeout authority.',
            'Growth lessons land in a shared taxonomy without contaminating unrelated role packs.'
        ],
        roleConfusionMetrics: {
            baselineLoadedSkillPacks: 'monolithic-team-context',
            pilotLoadedSkillPacks: selectedEntries.map((entry) => entry.skillPackId),
            preventedPermissionDrift: uniqueStrings(selectedEntries.flatMap((entry) => entry.forbiddenPermissions)),
            refinementSignalCount: actionableRefinementFindings.length
        },
        roleGrowthObservability: {
            contractSchemaId: 'atm.teamRoleGrowthObservabilityContract.v1',
            eventType: 'artifact.output',
            artifactType: 'atm.teamRoleGrowthLearningItem.v1',
            frictionDimensions: ['shared-atm-routing-friction', 'role-specific-friction'],
            brokerConflictBlockedMetricId: 'broker-conflict-blocked.hit-rate',
            roleContractMappings: selectedEntries.map((entry) => ({
                role: entry.role,
                skillPackId: entry.skillPackId,
                playbookSlice: entry.playbookSlice
            }))
        },
        brokerConflictVocabulary,
        actionableRefinementFindings
    };
}
export function buildTeamGovernanceRuntimeFields(input) {
    const blockingFinding = input.validation.findings.find((finding) => finding.level === 'error') ?? null;
    const blockedByBroker = input.runtimePilot.brokerConflictVocabulary.violationStatus === 'broker-conflict-blocked'
        || input.brokerLane.safeToStart === false;
    const brokerVerdict = String(input.brokerLane.decision.verdict ?? '');
    const escalationRequired = input.captainDecision.escalationRequired === true
        || brokerVerdict === 'needs-steward'
        || brokerVerdict === 'historical-delivery-required';
    const requiresAdr = brokerVerdict === 'needs-steward'
        || normalizeStringArray(input.brokerLane.blockedReasons).some((reason) => reason.toLowerCase().includes('adr'));
    const requiresHumanSignoff = escalationRequired || requiresAdr;
    const decisionClass = blockedByBroker || blockingFinding
        ? 'blocked'
        : requiresAdr
            ? 'adr-required'
            : requiresHumanSignoff
                ? 'human-signoff-required'
                : 'auto-execution';
    const decisionReason = blockingFinding?.summary
        ?? input.runtimePilot.brokerConflictVocabulary.decisionReason
        ?? input.captainDecision.reason;
    const violationStatus = blockedByBroker
        ? 'broker-conflict-blocked'
        : blockingFinding
            ? 'blocked'
            : requiresAdr
                ? 'adr-required'
                : requiresHumanSignoff
                    ? 'human-signoff-required'
                    : 'none';
    return {
        schemaId: 'atm.teamGovernanceRuntimeFields.v1',
        decisionClass,
        decisionReason,
        requiresHumanSignoff,
        requiresAdr,
        violationStatus,
        escalationTarget: requiresHumanSignoff
            ? (requiresAdr ? 'ADR + Captain review' : 'Captain / human review')
            : null
    };
}
function classifyTeamPilotFinding(code) {
    const normalized = String(code ?? '').toLowerCase();
    if (normalized.includes('scope'))
        return 'boundary-confusion';
    if (normalized.includes('lease') || normalized.includes('broker'))
        return 'role-specific-friction';
    if (normalized.includes('validator'))
        return 'validator-gap';
    return 'tooling-mismatch';
}
function normalizeTeamBrokerPilotFindings(brokerLane, promotionTarget) {
    const decision = brokerLane?.decision;
    if (!decision) {
        return [];
    }
    const conflicts = Array.isArray(decision.conflicts) ? decision.conflicts : [];
    if (conflicts.length === 0) {
        return [{
                category: 'role-specific-friction',
                summary: decision.reason ?? 'Broker-governed pilot requires refinement.',
                detail: decision.reason ?? 'No broker detail was provided.',
                correctRoute: 'Surface the broker verdict as pilot evidence and keep Coordinator from forcing a start.',
                promotionTarget
            }];
    }
    return conflicts.map((conflict) => ({
        category: conflict.kind === 'lease' ? 'role-specific-friction' : 'boundary-confusion',
        summary: decision.reason ?? 'Broker-governed pilot finding',
        detail: String(conflict.detail ?? '').trim() || 'Broker conflict detail unavailable.',
        correctRoute: 'Use takeover, repair, or bounded proposal flow before attempting a worker write lease again.',
        promotionTarget
    }));
}
function normalizeStringArray(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.map((entry) => String(entry ?? '').trim()).filter(Boolean);
}
function uniqueStrings(values) {
    return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}
