import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { CliError, readJsonFile } from '../../shared.js';
import { runTasks } from '../../tasks.js';
import { evaluateBrokerQueueAdmission, restrictTeamWriteScopeForQueueAdmission } from '../../next/broker-queue-admission.js';
import { findTaskClaimDependencyBlockers } from '../../tasks/dependency-gates.js';
import { buildTeamKnowledgeSummary } from '../../team-knowledge.js';
import { readBrokerProposalFile, validateBrokerProposal } from '../../../../../core/dist/broker/proposal.js';
import { inspectGitIndexOwnership } from '../../git-index-ownership.js';
import { buildPermissionFinding, deriveAllowedWriteScope, mergeValidation, validateTeamPermissionModel } from './permission-lease-policy.js';
import { buildTeamPlan, planTeamBrokerLane } from './plan-orchestration.js';
import { normalizeTeamSizeOverride } from './crew-decision-policy.js';
import { projectTeamRecipeForLevel } from './implementer-selector-policy.js';
import { collectTaskPathHints, deriveTeamWriteScope, deriveWritePaths } from './team-utils.js';
const builtInRecipes = [
    {
        schemaId: 'atm.teamRecipe.v1',
        recipeId: 'atm.default.fast',
        appliesTo: ['fast'],
        agents: [
            { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write', 'file.write', 'handoff.read', 'handoff.materialize'] },
            { agentId: 'atomization-planner', role: 'atomizationPlanner', profile: 'atm.atomizationPlanner.v1', permissions: ['file.read'] },
            { agentId: 'scope-guardian', role: 'scopeGuardian', profile: 'atm.scopeGuardian.v1', permissions: ['file.read'] },
            { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] }
        ]
    },
    {
        schemaId: 'atm.teamRecipe.v1',
        recipeId: 'atm.default.normal.typescript',
        appliesTo: ['normal'],
        language: 'typescript',
        agents: [
            { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write', 'handoff.read', 'handoff.materialize'] },
            { agentId: 'atomization-planner', role: 'atomizationPlanner', profile: 'atm.atomizationPlanner.v1', permissions: ['file.read'] },
            { agentId: 'reader', role: 'reader', profile: 'atm.reader.v1', permissions: ['file.read'] },
            { agentId: 'scope-guardian', role: 'scopeGuardian', profile: 'atm.scopeGuardian.v1', permissions: ['file.read'] },
            { agentId: 'implementer-typescript', role: 'implementer', profile: 'atm.implementer.typescript.v1', language: 'typescript', permissions: ['file.write'] },
            { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] },
            { agentId: 'evidence-collector', role: 'evidenceCollector', profile: 'atm.evidenceCollector.v1', permissions: ['file.read'] }
        ]
    },
    {
        schemaId: 'atm.teamRecipe.v1',
        recipeId: 'atm.default.batch',
        appliesTo: ['batch'],
        agents: [
            { agentId: 'batch-coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle', 'git.write', 'evidence.write', 'handoff.read', 'handoff.materialize'] },
            { agentId: 'atomization-planner', role: 'atomizationPlanner', profile: 'atm.atomizationPlanner.v1', permissions: ['file.read'] },
            { agentId: 'current-task-reader', role: 'reader', profile: 'atm.reader.v1', permissions: ['file.read'] },
            { agentId: 'current-task-scope-guardian', role: 'scopeGuardian', profile: 'atm.scopeGuardian.v1', permissions: ['file.read'] },
            { agentId: 'current-task-implementer', role: 'implementer', profile: 'atm.implementer.generic.v1', permissions: ['file.write'] },
            { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] },
            { agentId: 'evidence-collector', role: 'evidenceCollector', profile: 'atm.evidenceCollector.v1', permissions: ['file.read'] }
        ]
    }
];
export async function buildTeamPlanningContext(input) {
    let task = readTask(input.cwd, input.taskId);
    if (input.brokerProposalFile) {
        task = applyTeamBrokerProposalAdmission({
            cwd: input.cwd,
            task,
            taskId: input.taskId,
            actorId: input.actorId,
            proposalFile: input.brokerProposalFile
        });
    }
    const recipes = loadTeamRecipes(input.cwd);
    const recipe = selectRecipe({
        recipes,
        requestedRecipeId: input.requestedRecipeId,
        task
    });
    const requestedRosterLevel = normalizeTeamSizeOverride(input.requestedTeamSize)?.teamLevel ?? null;
    const activeRecipe = requestedRosterLevel ? projectTeamRecipeForLevel(recipe, requestedRosterLevel).recipe : recipe;
    const writeScope = deriveTeamWriteScope(task, input.cwd);
    // TASK-TEAM-0078: project the write scope through the canonical
    // shared-surface queue before any role or provider lease is derived, so a
    // queued task may plan/start only against its disjoint private paths and a
    // fully queued task is rejected instead of silently widening a lease.
    const queueAdmission = evaluateBrokerQueueAdmission({
        cwd: input.cwd,
        taskId: input.taskId,
        allowedFiles: writeScope.writePaths,
        overlappingFiles: []
    });
    const queueScopeDecision = restrictTeamWriteScopeForQueueAdmission(queueAdmission, writeScope.writePaths);
    const queueScopeFindings = [];
    if (queueScopeDecision.verdict === 'rejected') {
        queueScopeFindings.push(buildPermissionFinding({
            level: 'error',
            code: 'broker-queue-blocked',
            detail: `team plan/start rejected by canonical shared-surface queue admission (${queueAdmission.status}): ${queueScopeDecision.reason}`,
            paths: [...queueScopeDecision.queuedSharedPaths]
        }));
    }
    else if (queueScopeDecision.verdict === 'restricted-private-work') {
        queueScopeFindings.push(buildPermissionFinding({
            level: 'warning',
            code: 'broker-queue-private-work',
            detail: 'Role write scope is restricted to disjoint private paths while shared paths remain queued; leases must not widen beyond the canonical queue projection.',
            paths: [...queueScopeDecision.queuedSharedPaths]
        }));
    }
    const writePaths = [...queueScopeDecision.writePaths];
    const permissionValidation = validateTeamPermissionModel(activeRecipe, writePaths, {
        allowedWritePaths: deriveAllowedWriteScope(task, input.cwd),
        repoRoot: input.cwd,
        allowEmptyWriteScope: writeScope.allowEmptyWriteScope
    });
    const parallelFindings = [];
    try {
        const parallelResult = await runTasks([
            'parallel',
            '--task',
            input.taskId,
            '--queue',
            '--cwd',
            input.cwd,
            '--json'
        ]);
        if (parallelResult && parallelResult.ok && parallelResult.evidence && Array.isArray(parallelResult.evidence.candidates)) {
            for (const candidate of parallelResult.evidence.candidates) {
                const finding = candidate.finding;
                if (finding && finding.verdict === 'blocked-cid-conflict') {
                    parallelFindings.push(buildPermissionFinding({
                        level: 'error',
                        code: 'blocked-cid-conflict',
                        detail: `Parallel advisor identified a CID logic conflict with task ${candidate.taskId} on atom(s): ${finding.overlappingAtomIds.join(', ')}`,
                        paths: finding.overlappingFiles
                    }));
                }
            }
        }
    }
    catch (err) {
        // Best-effort check
    }
    const brokerLanePlan = planTeamBrokerLane({
        cwd: input.cwd,
        taskId: input.taskId,
        actorId: input.actorId,
        task,
        writePaths,
        readOnly: input.readOnly === true
    });
    const brokerLane = brokerLanePlan.evidence;
    const gitIndexOwnership = inspectGitIndexOwnership({
        cwd: input.cwd,
        taskId: input.taskId
    });
    const claimAdmissionFindings = buildTeamClaimAdmissionFindings(input.cwd, input.taskId, task);
    const validation = mergeValidation(permissionValidation, { ok: queueScopeFindings.every((f) => f.level !== 'error'), findings: queueScopeFindings }, { ok: claimAdmissionFindings.every((f) => f.level !== 'error'), findings: claimAdmissionFindings }, { ok: parallelFindings.every((f) => f.level !== 'error'), findings: parallelFindings }, { ok: brokerLanePlan.findings.every((f) => f.level !== 'error'), findings: brokerLanePlan.findings });
    const finalTeamPlan = buildTeamPlan({
        cwd: input.cwd,
        task,
        recipe: activeRecipe,
        writePaths,
        validation,
        brokerLane,
        gitIndexOwnership,
        allowEmptyWriteScope: writeScope.allowEmptyWriteScope,
        requestedTeamSize: input.requestedTeamSize,
        providerSelectionConfig: input.providerSelectionConfig?.config ?? null,
        providerSelectionSource: input.providerSelectionConfig?.source ?? null,
        knowledgeSummary: buildTeamKnowledgeSummary({
            cwd: input.cwd,
            taskId: String(task.workItemId ?? task.taskId ?? input.taskId),
            top: 3
        })
    });
    return {
        task,
        recipes,
        recipe: activeRecipe,
        permissionValidation,
        validation,
        writePaths,
        queueAdmission,
        queueScopeDecision,
        providerSelectionConfig: input.providerSelectionConfig?.config ?? null,
        providerSelectionSource: input.providerSelectionConfig?.source ?? null,
        teamPlan: {
            ...finalTeamPlan,
            validation,
            brokerLane
        }
    };
}
function applyTeamBrokerProposalAdmission(input) {
    const proposalPath = path.resolve(input.cwd, input.proposalFile);
    let proposal;
    try {
        proposal = readBrokerProposalFile(proposalPath);
    }
    catch (error) {
        throw new CliError('ATM_TEAM_BROKER_PROPOSAL_INVALID', `Team start could not read broker proposal: ${error.message}`, { exitCode: 1 });
    }
    const validation = validateBrokerProposal(proposal, { cwd: input.cwd });
    const allowed = new Set(deriveWritePaths(input.task, input.cwd));
    const hashOnlyMismatch = validation.issues.length === 1
        && validation.issues[0]?.kind === 'file-hash-mismatch'
        && String(validation.currentFileHash ?? '').replace(/^sha256:/, '') === String(proposal.fileBeforeHash ?? '').replace(/^sha256:/, '');
    if ((!validation.ok && !hashOnlyMismatch) || proposal.taskId !== input.taskId || proposal.actorId !== input.actorId || !allowed.has(proposal.targetFile.replace(/\\/g, '/'))) {
        throw new CliError('ATM_TEAM_BROKER_PROPOSAL_INVALID', 'Team start requires a current validated proposal owned by its task/actor and target write scope.', {
            exitCode: 1,
            details: { proposalFile: input.proposalFile, proposalId: proposal.proposalId, issues: validation.issues }
        });
    }
    return {
        ...input.task,
        proposalAdmission: {
            trigger: 'hot-file',
            summarySubmitted: true,
            hotFiles: [proposal.targetFile.replace(/\\/g, '/')],
            notes: `Validated broker proposal ${proposal.proposalId} consumed by team start.`
        }
    };
}
function buildTeamClaimAdmissionFindings(cwd, taskId, task) {
    return findTaskClaimDependencyBlockers(cwd, taskId, task).map((blocker) => buildPermissionFinding({
        level: 'error',
        code: 'ATM_TEAM_START_CLAIM_DEPENDENCY_BLOCKED',
        detail: `Team start is unsafe because normal task claim would be blocked by dependency ${blocker.taskId} (${blocker.status}).`,
        paths: [path.relative(cwd, blocker.taskPath).replace(/\\/g, '/')]
    }));
}
function readTask(cwd, taskId) {
    const taskPath = path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`);
    if (!existsSync(taskPath)) {
        throw new CliError('ATM_TEAM_TASK_NOT_FOUND', `Task not found for team plan: ${taskId}`, {
            exitCode: 2,
            details: { taskId, taskPath: path.relative(cwd, taskPath).replace(/\\/g, '/') }
        });
    }
    return readJsonFile(taskPath, 'ATM_TEAM_TASK_NOT_FOUND');
}
function loadTeamRecipes(cwd) {
    const recipeDir = path.join(cwd, '.atm', 'config', 'team-recipes');
    const repoRecipes = existsSync(recipeDir)
        ? readdirSync(recipeDir)
            .filter((entry) => entry.endsWith('.json'))
            .map((entry) => {
            const filePath = path.join(recipeDir, entry);
            return {
                recipe: normalizeRecipe(JSON.parse(readFileSync(filePath, 'utf8'))),
                source: {
                    kind: 'repo-json',
                    path: path.relative(cwd, filePath).replace(/\\/g, '/')
                }
            };
        })
        : [];
    return {
        recipes: [
            ...builtInRecipes,
            ...repoRecipes.map((entry) => entry.recipe)
        ],
        sources: [
            { kind: 'built-in-json', recipeIds: builtInRecipes.map((entry) => entry.recipeId) },
            ...repoRecipes.map((entry) => entry.source)
        ]
    };
}
function normalizeRecipe(value) {
    if (value?.schemaId !== 'atm.teamRecipe.v1') {
        throw new CliError('ATM_TEAM_RECIPE_INVALID', 'Team recipe JSON must use schemaId atm.teamRecipe.v1.', { exitCode: 2 });
    }
    const recipeId = String(value?.recipeId ?? '').trim();
    if (!recipeId) {
        throw new CliError('ATM_TEAM_RECIPE_INVALID', 'Team recipe JSON requires recipeId.', { exitCode: 2 });
    }
    const agents = Array.isArray(value?.agents) ? (value.agents).map((entry) => ({
        agentId: String(entry?.agentId ?? '').trim(),
        role: String(entry?.role ?? '').trim(),
        profile: entry?.profile ? String(entry.profile).trim() : undefined,
        language: entry?.language ? String(entry.language).trim() : undefined,
        permissions: Array.isArray(entry?.permissions) ? entry.permissions.map((permission) => String(permission).trim()).filter(Boolean) : []
    })) : [];
    if (agents.length === 0 || agents.some((agent) => !agent.agentId || !agent.role)) {
        throw new CliError('ATM_TEAM_RECIPE_INVALID', `Team recipe ${recipeId} requires agents with agentId and role.`, { exitCode: 2 });
    }
    return {
        schemaId: 'atm.teamRecipe.v1',
        recipeId,
        appliesTo: Array.isArray(value?.appliesTo) ? (value.appliesTo).map(String) : undefined,
        language: value?.language ? String(value.language) : undefined,
        agents
    };
}
function selectRecipe(input) {
    if (input.requestedRecipeId) {
        const recipe = input.recipes.recipes.find((entry) => entry.recipeId === input.requestedRecipeId);
        if (!recipe) {
            throw new CliError('ATM_TEAM_RECIPE_NOT_FOUND', `Team recipe not found: ${input.requestedRecipeId}`, {
                exitCode: 2,
                details: { availableRecipeIds: input.recipes.recipes.map((entry) => entry.recipeId) }
            });
        }
        return recipe;
    }
    const language = inferTaskLanguage(input.task);
    return input.recipes.recipes.find((entry) => entry.language === language)
        ?? input.recipes.recipes.find((entry) => entry.recipeId === 'atm.default.normal.typescript')
        ?? input.recipes.recipes[0];
}
function inferTaskLanguage(task) {
    const paths = collectTaskPathHints(task);
    if (paths.some((entry) => entry.endsWith('.py') || entry.includes('pipelines/')))
        return 'python';
    if (paths.some((entry) => entry.endsWith('.cs')))
        return 'csharp';
    return 'typescript';
}
