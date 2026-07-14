import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultTeamPermissionPolicy, decideTeamPermission } from '../permission-broker.js';
test('team permission broker exposes a mandatory hard gate', () => {
    const policy = createDefaultTeamPermissionPolicy();
    const allowed = decideTeamPermission(policy, {
        permission: 'exec.validator',
        providerId: 'openai',
        scopedPaths: ['packages/core/src']
    });
    assert.equal(policy.hardGate, true);
    assert.equal(allowed.hardGate, true);
    assert.equal(allowed.gateId, 'ATM_TEAM_PERMISSION_HARD_GATE');
    assert.equal(allowed.ok, true);
});
test('team permission broker fails closed for missing scope', () => {
    const decision = decideTeamPermission(createDefaultTeamPermissionPolicy(), {
        permission: 'exec.validator',
        providerId: 'openai',
        scopedPaths: []
    });
    assert.equal(decision.ok, false);
    assert.equal(decision.gateId, 'ATM_TEAM_PERMISSION_HARD_GATE');
});
