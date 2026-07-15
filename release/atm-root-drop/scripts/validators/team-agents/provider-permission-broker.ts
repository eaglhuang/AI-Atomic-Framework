import assert from 'node:assert/strict';
import {
  createDefaultTeamPermissionPolicy,
  decideTeamPermission
} from '../../../packages/core/src/team-runtime/permission-broker.ts';

export function runProviderPermissionBrokerValidatorCase(taskCase: string): boolean {
  if (taskCase !== 'provider-permission-broker') return false;
  const policy = createDefaultTeamPermissionPolicy();
  const allow = decideTeamPermission(policy, {
    permission: 'exec.validator',
    providerId: 'openai',
    scopedPaths: ['packages/cli/src/commands/team.ts']
  });
  assert.equal(allow.ok, true);
  const deny = decideTeamPermission(policy, {
    permission: 'git.write',
    providerId: 'gemini',
    scopedPaths: []
  });
  assert.equal(deny.ok, false);
  console.log('[validate-team-agents] ok (provider-permission-broker)');
  return true;
}
