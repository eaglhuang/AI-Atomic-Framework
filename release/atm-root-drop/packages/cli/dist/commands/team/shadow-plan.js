import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createTeamShadowSchedule } from './scheduler.js';
import { createTeamShadowWorkspaceProviderPlan } from './shadow-workspace.js';
export function buildTeamShadowScheduleForPlan(input) {
    const taskId = String(input.task?.workItemId ?? input.task?.taskId ?? 'unknown-task');
    const workGroups = buildShadowWorkGroups(input.recipe, input.writePaths);
    const modelOptions = buildShadowModelOptions(input.recipe);
    const acceptanceCriteria = readTaskStringList(input.task, 'acceptanceCriteria');
    const requestedTeamSize = Number.parseInt(String(input.captainDecision.teamSize), 10);
    const fanOutCap = Math.max(1, Math.min(Number.isFinite(requestedTeamSize) ? requestedTeamSize : 1, workGroups.length || 1));
    const baseCommit = readGitHead(input.cwd);
    const quotaProbeDigest = stableDigest({
        taskId,
        writePaths: input.writePaths,
        validationOk: input.validation.ok,
        brokerSafeToStart: input.brokerLane.safeToStart,
        requestedTeamSize: input.captainDecision.teamSize
    });
    return createTeamShadowSchedule({
        taskId,
        baseCommit,
        scopeEpoch: 1,
        workGroups,
        modelOptions,
        catalogVersion: 'diagnostic-shadow-v1',
        fanOutCap,
        spendingCeiling: 0,
        quotaProbeDigest,
        acceptanceCriteria,
        cleanContextReviewer: true,
        workspaceProvider: createTeamShadowWorkspaceProviderPlan({ baseCommit })
    });
}
function buildShadowWorkGroups(recipe, writePaths) {
    const scopedFiles = writePaths.length > 0 ? writePaths : ['__read_only_team_plan__'];
    return recipe.agents
        .filter((agent) => agent.role !== 'coordinator')
        .map((agent, index) => ({
        groupId: `role-${index + 1}-${agent.role}`,
        role: agent.role,
        independent: agent.permissions.includes('file.write'),
        dependencies: agent.permissions.includes('handoff.materialize') ? ['composer'] : [],
        allowedFiles: agent.permissions.includes('file.write') ? scopedFiles : [],
        capability: agent.role.includes('review') ? 'review' : agent.permissions.includes('file.write') ? 'implementation' : 'planning'
    }));
}
function buildShadowModelOptions(recipe) {
    const providers = recipe.agents.length > 0 ? ['openai'] : ['openai'];
    return providers.flatMap((providerId) => [
        { providerId, modelId: 'shadow-low-cost', plan: 'diagnostic', capability: 'planning', costPerUnit: 1 },
        { providerId, modelId: 'shadow-low-cost', plan: 'diagnostic', capability: 'review', costPerUnit: 1 },
        { providerId, modelId: 'shadow-standard', plan: 'diagnostic', capability: 'implementation', costPerUnit: 2 }
    ]);
}
function readTaskStringList(task, key) {
    const value = task?.[key];
    return Array.isArray(value) ? uniqueStrings(value.map(String).filter(Boolean)) : [];
}
function readGitHead(cwd) {
    try {
        return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    }
    catch {
        return 'unknown';
    }
}
function stableDigest(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
function uniqueStrings(values) {
    return Array.from(new Set(values));
}
