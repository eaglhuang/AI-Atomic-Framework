import { quoteCliValue } from './shared.js';
import { buildBrokerConflictSharedVocabulary, buildBrokerConflictUxProjection, runTeamBrokerConflictResolve } from './team/legacy/broker-observability.js';
export { buildBrokerConflictSharedVocabulary, buildBrokerConflictUxProjection, runTeamBrokerConflictResolve };
import { buildReviewAgentSignature, buildTeamClosureAttestation, buildTeamRuntimeContract, evaluateReviewerIndependence, evaluateReviewQuorum } from './team/legacy/runtime-governance.js';
export { buildReviewAgentSignature, buildTeamClosureAttestation, buildTeamRuntimeContract, evaluateReviewerIndependence, evaluateReviewQuorum };
import { buildTeamPlan, buildTeamRuntimePilot, planTeamBrokerLane, readActiveTaskClaimActorId, resolveTeamPlanActorId } from './team/legacy/plan-orchestration.js';
export { buildTeamPlan, buildTeamRuntimePilot, planTeamBrokerLane, readActiveTaskClaimActorId, resolveTeamPlanActorId };
export { buildTeamGrowthContract, buildTeamRoleGrowthObservabilityContract } from './team/growth-contract.js';
export { buildProviderNeutralRoleSkillPackManifest, buildTeamRoleRoutingMatrix, buildTeamRoleSkillPackContract } from './team/role-skill-packs.js';
export { buildAnthropicRuntimeBridgeSummary, buildEditorExecutionRuntimeBridgeSummary, buildGeminiDirectRuntimeBridgeSummary, buildMicrosoftFoundryRuntimeBridgeSummary, buildOpenAIFamilyRuntimeBridgeSummary } from './team/runtime-bridges.js';
export { buildTeamArtifactHandoffContract, buildTeamRetryBudgetContract, buildTeamReworkRouteStateMachine, transitionTeamReworkRoute, validateTeamArtifactHandoff } from './team/legacy/runtime-contracts.js';
export { buildTeamLeaseConflictDetails, buildTeamLeaseNotFoundDetails, compactTeamRun, createTeamRunId, findLatestTeamRunForTask, listTeamRuns, normalizePermissionLeaseRecords, readTeamRun, teamRunsDirectory, writeExistingTeamRun } from './team/legacy/team-run-store.js';
export { buildPermissionFinding, buildProposalFirstParityFindings, buildSuggestedPermissionLeases, deriveAllowedWriteScope, mergeValidation, normalizeRepoAbsoluteLeasePath, normalizeTeamLeasePath, normalizeTaskWriteScope, validateTeamPermissionModel } from './team/legacy/permission-lease-policy.js';
export { TEAM_HANDOFF_CONTEXT_MAX_ARTIFACTS, appendTeamRuntimeObservabilityEvents, buildDirectTeamRoleInstructions, loadTeamVendorLocalSecrets, runDirectTeamProviderRole, runTeamProviderExecution } from './team/legacy/provider-execution.js';
export { buildAtomizationChecklist, buildCaptainDecision, evaluateLargeScriptRisk, buildMinimalTaskCrewBriefingContract, normalizeTeamSizeOverride, assessLieutenantEscalation } from './team/legacy/crew-decision-policy.js';
export { mapTeamSizeToLevel, projectTeamRecipeForLevel, selectTeamImplementer } from './team/legacy/implementer-selector-policy.js';
import { TEAM_ATOM_BOUNDARIES } from './team/legacy/types.js';
export { TEAM_ATOM_BOUNDARIES };
export function evaluateBatchTeamAdmission(input) {
    const taskId = String(input.taskId ?? '').trim();
    const batchId = String(input.batchId ?? '').trim();
    const isQueueHead = taskId.length > 0 && taskId === String(input.currentQueueHeadTaskId ?? '').trim();
    const costTelemetryLoaded = input.costTelemetryLoaded === true;
    const reasonCodes = [];
    if (!isQueueHead)
        reasonCodes.push('not-current-queue-head');
    if (input.structuralParallelism !== true)
        reasonCodes.push('no-structural-parallelism');
    if (!costTelemetryLoaded)
        reasonCodes.push('missing-cost-telemetry');
    if (input.stopLossTriggered === true)
        reasonCodes.push('stop-loss-triggered');
    const allowed = reasonCodes.length === 0;
    return {
        schemaId: 'atm.batchTeamAdmissionDecision.v1',
        taskId,
        batchId,
        allowed,
        mode: allowed ? 'team-current-head' : 'single-agent',
        reasonCodes,
        queueHeadOnly: true,
        structuralParallelismRequired: true,
        costTelemetryRequired: true,
        stopLossAction: input.stopLossTriggered === true
            ? 'single-agent'
            : (!costTelemetryLoaded ? 'cheaper-qualified-model-mix' : 'none')
    };
}
export function resolveTeamRecipeIdForChannel(channel) {
    if (channel === 'batch') {
        return 'atm.default.batch';
    }
    if (channel === 'fast') {
        return 'atm.default.fast';
    }
    return 'atm.default.normal.typescript';
}
export function defaultTeamRecommendationReason(channel) {
    if (channel === 'batch') {
        return 'Batch queue-head work can use a current-task team, but ATM still owns checkpoint and advance.';
    }
    if (channel === 'fast') {
        return 'Fast quickfix work usually stays single-actor; a team run is optional and advisory only.';
    }
    return 'This task can use an optional team run for role and permission coordination.';
}
export function buildTeamRecommendation(input) {
    const taskId = typeof input.taskId === 'string' ? input.taskId.trim() : '';
    if (!taskId || input.enabled === false) {
        return null;
    }
    const actorId = input.actorId?.trim() || '<id>';
    const recipeId = resolveTeamRecipeIdForChannel(input.channel);
    const quotedTask = quoteCliValue(taskId);
    const reason = input.reason?.trim() || defaultTeamRecommendationReason(input.channel);
    return {
        schemaId: 'atm.teamRecommendation.v1',
        enabled: true,
        required: false,
        channel: input.channel,
        taskId,
        recipeId,
        reason,
        plan: `node atm.mjs team plan --task ${quotedTask} --recipe ${recipeId} --json`,
        validate: `node atm.mjs team validate --task ${quotedTask} --recipe ${recipeId} --json`,
        start: `node atm.mjs team start --task ${quotedTask} --actor ${actorId} --recipe ${recipeId} --json`,
        status: 'node atm.mjs team status --compact --json',
        ...(input.knowledgeSummary ? { knowledgeSummary: input.knowledgeSummary } : {}),
        ...(input.parallelAdvisory ? { parallelAdvisory: input.parallelAdvisory } : {}),
        constraints: [
            'Team start writes only .atm/runtime/team-runs/<teamRunId>.json.',
            'Team agents are not spawned by this recommendation.',
            'Coordinator remains the only task.lifecycle and git.write owner.'
        ]
    };
}
export { runTeam } from './team/legacy/command-runner.js';
export { writeTeamRun, buildTeamStatusResult, evaluateTeamRequiredCompletionGate } from './team/legacy/team-run-runtime.js';
export { buildTeamPatrolResult, buildTeamPatrolReport } from './team/legacy/patrol-handler.js';
export { buildTeamPlanningContext } from './team/legacy/planning-context.js';
export { deriveWritePaths } from './team/legacy/team-utils.js';
