import assert from 'node:assert/strict';
import { resolveTeamRuntimeProviderSelection } from '../role-provider-resolution.js';
import { resolveTeamStartExecutionLane, runtimeBackendAdmissionForTeam } from '../team-execution-lane.js';
import { resolveTeamActionRoute, resolveTeamFastPath, supportedTeamActionList } from '../team-route-map.js';
assert.deepEqual(resolveTeamFastPath(['handoff', '--task', 'TASK-1']), {
    kind: 'fast-path',
    fastPath: 'handoff',
    argv: ['--task', 'TASK-1'],
    cwdSource: 'option-or-process'
});
assert.deepEqual(resolveTeamFastPath(['broker', 'resolve']), {
    kind: 'fast-path',
    fastPath: 'broker',
    argv: ['resolve'],
    cwdSource: 'process'
});
assert.equal(resolveTeamFastPath(['plan']), null);
assert.deepEqual(resolveTeamActionRoute('wave', ['--task', 'TASK-1']), {
    kind: 'special-action',
    action: 'wave',
    argv: ['--task', 'TASK-1']
});
assert.deepEqual(resolveTeamActionRoute('status', []), { kind: 'status', action: 'status' });
assert.deepEqual(resolveTeamActionRoute('release', []), { kind: 'lifecycle', action: 'release' });
assert.deepEqual(resolveTeamActionRoute('patrol', []), { kind: 'patrol', action: 'patrol' });
assert.deepEqual(resolveTeamActionRoute('start', []), { kind: 'planning', action: 'start' });
assert.ok(supportedTeamActionList().includes('broker resolve'));
assert.deepEqual(resolveTeamStartExecutionLane({
    executeRequested: false,
    providerExecutionCount: 0,
    providerResultOk: []
}), {
    executeRequested: false,
    providerExecutionCount: 0,
    executionBlocked: false,
    messageCode: 'ATM_TEAM_STARTED',
    messageLevel: 'info',
    messageText: 'Team run started. Runtime state was written, but no agents were spawned.'
});
assert.equal(resolveTeamStartExecutionLane({
    executeRequested: true,
    providerExecutionCount: 0,
    providerResultOk: []
}).messageCode, 'ATM_TEAM_EXECUTION_BLOCKED');
assert.equal(resolveTeamStartExecutionLane({
    executeRequested: true,
    providerExecutionCount: 2,
    providerResultOk: [true, true]
}).messageCode, 'ATM_TEAM_STARTED_EXECUTED');
assert.equal(runtimeBackendAdmissionForTeam({
    runtimeMode: 'broker-only',
    providerId: null,
    executionSurface: 'broker-governance',
    capabilities: []
}).ok, true);
assert.equal(runtimeBackendAdmissionForTeam({
    runtimeMode: 'real-agent',
    providerId: 'openai',
    executionSurface: 'agent-runtime',
    capabilities: [{
            providerId: 'openai',
            status: 'ready',
            runtimeModes: ['real-agent'],
            executionSurfaces: ['agent-runtime'],
            manifestPath: 'integrations/openai/manifest.json'
        }]
}).ok, true);
const providerSelection = resolveTeamRuntimeProviderSelection({
    roleName: 'validator',
    runtimeMode: 'broker-only',
    providerId: 'openai',
    sdkId: 'responses',
    modelId: 'gpt-5',
    selectionConfig: {
        repoDefault: {
            providerId: 'openai',
            sdkId: 'responses',
            modelId: 'gpt-5-mini',
            runtimeMode: 'broker-only'
        },
        roleOverrides: {
            validator: {
                providerId: 'anthropic',
                sdkId: 'messages',
                modelId: 'claude-sonnet',
                runtimeMode: 'real-agent'
            }
        }
    }
});
assert.equal(providerSelection.runtimeMode, 'real-agent');
assert.equal(providerSelection.providerId, 'anthropic');
console.log(JSON.stringify({ ok: true, assertions: 17 }, null, 2));
