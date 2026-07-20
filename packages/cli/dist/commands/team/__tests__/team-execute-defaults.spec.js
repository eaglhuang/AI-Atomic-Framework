import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mergeTeamProviderSelectionConfig, resolveTeamProviderSelection } from '../../../../../core/dist/team-runtime/provider-selection.js';
import { createTempWorkspace, initializeGitRepository } from '../../../temp-workspace.js';
import { buildProviderNeutralRoleSkillPackManifest, runTeam, runTeamProviderExecution } from '../../team.js';
import { resolveTeamStartExecutionLane } from '../team-execution-lane.js';
const l1Recipe = {
    schemaId: 'atm.teamRecipe.v1',
    recipeId: 'atm.default.fast',
    appliesTo: ['fast'],
    agents: [
        { agentId: 'coordinator', role: 'coordinator', profile: 'atm.coordinator.v1', permissions: ['task.lifecycle'] },
        { agentId: 'atomization-planner', role: 'atomizationPlanner', profile: 'atm.atomizationPlanner.v1', permissions: ['file.read'] },
        { agentId: 'implementer', role: 'implementer', profile: 'atm.implementer.generic.v1', permissions: ['file.write'] },
        { agentId: 'validator', role: 'validator', profile: 'atm.validator.v1', permissions: ['exec.validator'] }
    ]
};
function testCliGlobalDefaultPopulatesEveryActiveRole() {
    const selectionConfig = mergeTeamProviderSelectionConfig({
        repoConfig: {
            repoDefault: {
                providerId: 'openai',
                sdkId: 'responses',
                modelId: 'gpt-5-mini',
                runtimeMode: 'broker-only'
            },
            roleOverrides: {}
        },
        cliGlobalDefault: {
            providerId: 'openai',
            sdkId: 'responses',
            modelId: 'gpt-5.4-mini',
            runtimeMode: 'real-agent'
        }
    });
    const manifest = buildProviderNeutralRoleSkillPackManifest({
        recipe: l1Recipe,
        selectionConfig
    });
    assert.equal(manifest.roles.length, 4, 'L1 roster must include four active roles');
    for (const entry of manifest.roles) {
        assert.equal(entry.selectedProvider.providerId, 'openai');
        assert.equal(entry.selectedProvider.modelId, 'gpt-5.4-mini');
        assert.equal(entry.selectedProvider.runtimeMode, 'real-agent');
        assert.equal(entry.selectedProvider.source, 'cli-global-default');
    }
}
function testRoleProviderOverrideStillWinsOverGlobalDefault() {
    const selectionConfig = mergeTeamProviderSelectionConfig({
        repoConfig: {
            repoDefault: {
                providerId: 'openai',
                sdkId: 'responses',
                modelId: 'gpt-5-mini',
                runtimeMode: 'broker-only'
            },
            roleOverrides: {}
        },
        cliGlobalDefault: {
            providerId: 'openai',
            sdkId: 'responses',
            modelId: 'gpt-global',
            runtimeMode: 'real-agent'
        },
        cliRoleOverrides: ['validator=anthropic:claude-sonnet:anthropic-messages:real-agent']
    });
    const validator = resolveTeamProviderSelection('validator', selectionConfig);
    assert.equal(validator.source, 'cli-role-override');
    assert.equal(validator.providerId, 'anthropic');
    const implementer = resolveTeamProviderSelection('implementer', selectionConfig);
    assert.equal(implementer.source, 'cli-global-default');
    assert.equal(implementer.runtimeMode, 'real-agent');
}
async function testProviderExecutionUsesGlobalDefaultsForAllRoles() {
    const selectionConfig = mergeTeamProviderSelectionConfig({
        cliGlobalDefault: {
            providerId: 'openai',
            sdkId: 'responses',
            modelId: 'gpt-test',
            runtimeMode: 'real-agent'
        }
    });
    const manifest = buildProviderNeutralRoleSkillPackManifest({
        recipe: l1Recipe,
        selectionConfig
    });
    const execution = await runTeamProviderExecution({
        cwd: process.cwd(),
        taskId: 'TASK-TEAM-EXEC-DEFAULTS',
        teamRunId: 'team-exec-defaults',
        recipe: l1Recipe,
        runtimeContract: {
            schemaId: 'atm.teamRuntimeContract.v1',
            runtimeMode: 'real-agent',
            runtimeLanguage: 'node',
            runtimeAdapterId: 'nodejs-team-worker',
            providerId: 'openai',
            sdkId: 'responses',
            modelId: 'gpt-test',
            agentsSpawned: true,
            executionSurface: 'agent-runtime',
            selectionReason: 'test',
            workerAdapter: {},
            artifactHandoff: {},
            retryBudget: {},
            commitLane: {},
            brokerSubagent: {},
            editorSubagentBridge: {}
        },
        runtimePilot: { schemaId: 'atm.teamRuntimePilot.v1', mode: 'direct-provider' },
        roleSelections: manifest.roles.map((entry) => ({
            role: entry.role,
            selectedProvider: entry.selectedProvider
        })),
        scopedPaths: ['docs/example.md'],
        executor: async () => ({
            ok: true,
            statusCode: 200,
            outputText: JSON.stringify({ output_text: 'ok' }),
            outputArtifacts: [],
            retryable: false,
            summary: 'deterministic provider response',
            executionMode: 'vendor-api'
        })
    });
    assert.equal(execution.blockedReason, null);
    assert.equal(execution.results.length, 4, 'top-level defaults must execute every active roster role');
}
function testEmptyExecutionSetFailsClosed() {
    const lane = resolveTeamStartExecutionLane({
        executeRequested: true,
        providerExecutionCount: 0,
        providerResultOk: []
    });
    assert.equal(lane.executionBlocked, true);
    assert.equal(lane.messageCode, 'ATM_TEAM_EXECUTION_BLOCKED');
}
async function testTeamStartExecuteWithGlobalDefaultsPopulatesRoles() {
    const cwd = createTempWorkspace('atm-team-execute-defaults-start-');
    initializeGitRepository(cwd);
    const taskId = 'TASK-TEAM-EXEC-DEFAULTS-START';
    mkdirSync(path.join(cwd, '.atm', 'history', 'tasks'), { recursive: true });
    mkdirSync(path.join(cwd, 'docs'), { recursive: true });
    writeFileSync(path.join(cwd, '.atm', 'history', 'tasks', `${taskId}.json`), `${JSON.stringify({
        schemaVersion: 'atm.workItem.v0.2',
        workItemId: taskId,
        title: 'Execute defaults start fixture',
        status: 'running',
        targetRepo: 'AI-Atomic-Framework',
        scopePaths: ['docs/execute-defaults-start.md'],
        deliverables: ['docs/execute-defaults-start.md'],
        validators: ['validator']
    }, null, 2)}\n`, 'utf8');
    writeFileSync(path.join(cwd, 'docs', 'execute-defaults-start.md'), '# Fixture\n', 'utf8');
    const started = await runTeam([
        'start', '--task', taskId, '--actor', 'validator', '--cwd', cwd,
        '--execute', '--provider', 'openai', '--runtime-mode', 'real-agent', '--model', 'gpt-test', '--json'
    ]);
    const evidence = started.evidence;
    assert.equal(evidence.runtimeContract?.runtimeMode, 'real-agent');
    assert.match(String(evidence.runtimeContract?.selectionReason ?? ''), /cli-global-default/);
    assert.ok((evidence.providerOrchestration?.results?.length ?? 0) > 0, 'global defaults must populate provider execution roles');
    assert.notEqual(evidence.providerOrchestration?.blockedReason, 'broker-only-runtime-never-spawns');
}
testCliGlobalDefaultPopulatesEveryActiveRole();
testRoleProviderOverrideStillWinsOverGlobalDefault();
await testProviderExecutionUsesGlobalDefaultsForAllRoles();
testEmptyExecutionSetFailsClosed();
await testTeamStartExecuteWithGlobalDefaultsPopulatesRoles();
console.log(JSON.stringify({ ok: true, spec: 'team-execute-defaults.spec.ts', assertions: 5 }, null, 2));
