import assert from 'node:assert/strict';
import { mergeTeamProviderSelectionConfig } from '../../../../../core/dist/team-runtime/provider-selection.js';
import { buildTeamRuntimeContract } from '../../team.js';
import { resolveTeamRuntimeProviderSelection } from '../role-provider-resolution.js';
const repoBrokerOnly = {
    repoDefault: {
        providerId: 'openai',
        sdkId: 'responses',
        modelId: 'gpt-5-mini',
        runtimeMode: 'broker-only'
    },
    roleOverrides: {}
};
function testExplicitRuntimeModeOverridesRepoDefault() {
    const runtime = buildTeamRuntimeContract({
        runtimeMode: 'real-agent',
        providerId: 'openai',
        sdkId: 'responses',
        modelId: 'gpt-test',
        roleName: 'coordinator',
        selectionConfig: mergeTeamProviderSelectionConfig({ repoConfig: repoBrokerOnly })
    });
    assert.equal(runtime.runtimeMode, 'real-agent');
    assert.equal(runtime.providerId, 'openai');
    assert.equal(runtime.modelId, 'gpt-test');
    assert.match(runtime.selectionReason, /real-agent selected/);
}
function testExplicitRuntimeModeOverridesMergedRepoDefaultInProviderSelection() {
    const selection = resolveTeamRuntimeProviderSelection({
        roleName: 'coordinator',
        selectionConfig: mergeTeamProviderSelectionConfig({ repoConfig: repoBrokerOnly }),
        runtimeMode: 'real-agent',
        providerId: 'anthropic',
        sdkId: 'anthropic-messages',
        modelId: 'claude-test',
        explicitRuntimeMode: true,
        explicitProviderId: true,
        explicitSdkId: true,
        explicitModelId: true
    });
    assert.equal(selection.runtimeMode, 'real-agent');
    assert.equal(selection.providerId, 'anthropic');
    assert.equal(selection.sdkId, 'anthropic-messages');
    assert.equal(selection.modelId, 'claude-test');
    assert.equal(selection.selectionDecision?.source, 'repo-default');
}
function testRoleOverrideStillBeatsExplicitGlobalRuntime() {
    const runtime = buildTeamRuntimeContract({
        runtimeMode: 'real-agent',
        providerId: 'openai',
        sdkId: 'responses',
        modelId: 'global-model',
        roleName: 'implementer',
        selectionConfig: mergeTeamProviderSelectionConfig({
            repoConfig: {
                ...repoBrokerOnly,
                roleOverrides: {
                    implementer: {
                        providerId: 'anthropic',
                        sdkId: 'anthropic-messages',
                        modelId: 'role-model',
                        runtimeMode: 'editor-subagent'
                    }
                }
            }
        })
    });
    assert.equal(runtime.runtimeMode, 'editor-subagent');
    assert.equal(runtime.providerId, 'anthropic');
    assert.equal(runtime.modelId, 'role-model');
    assert.match(runtime.selectionReason, /selection=role-override/);
}
function testCliGlobalDefaultOverridesImplicitRepoDefault() {
    const runtime = buildTeamRuntimeContract({
        runtimeMode: 'real-agent',
        providerId: 'openai',
        sdkId: 'responses',
        modelId: 'gpt-global',
        roleName: 'coordinator',
        selectionConfig: mergeTeamProviderSelectionConfig({
            repoConfig: repoBrokerOnly,
            cliGlobalDefault: {
                providerId: 'openai',
                sdkId: 'responses',
                modelId: 'gpt-global',
                runtimeMode: 'real-agent'
            }
        })
    });
    assert.equal(runtime.runtimeMode, 'real-agent');
    assert.match(runtime.selectionReason, /selection=cli-global-default/);
}
testExplicitRuntimeModeOverridesRepoDefault();
testExplicitRuntimeModeOverridesMergedRepoDefaultInProviderSelection();
testRoleOverrideStillBeatsExplicitGlobalRuntime();
testCliGlobalDefaultOverridesImplicitRepoDefault();
console.log(JSON.stringify({ ok: true, spec: 'team-runtime-precedence.spec.ts', assertions: 4 }, null, 2));
