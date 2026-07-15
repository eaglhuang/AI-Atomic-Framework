import assert from 'node:assert/strict';

import { buildTeamArtifactHandoffEvidence } from '../../../packages/cli/src/commands/evidence.ts';
import {
  buildTeamArtifactHandoffContract,
  buildTeamRetryBudgetContract,
  buildTeamRuntimeContract,
  validateTeamArtifactHandoff
} from '../../../packages/cli/src/commands/team.ts';

export async function runArtifactHandoffRetryValidatorCase(taskCase: string): Promise<boolean> {
  if (taskCase !== 'artifact-handoff-retry') return false;

  const contract = buildTeamRuntimeContract({
    runtimeMode: 'editor-subagent',
    recipe: {
      schemaId: 'atm.teamRecipe.v1',
      recipeId: 'atm.artifact-handoff.fixture',
      language: 'typescript',
      agents: [
        {
          agentId: 'implementer-typescript',
          role: 'implementer',
          profile: 'atm.implementer.typescript.v1',
          language: 'typescript',
          permissions: ['file.write']
        },
        {
          agentId: 'validator',
          role: 'validator',
          profile: 'atm.validator.v1',
          permissions: ['exec.validator']
        }
      ]
    },
    allowedFiles: ['packages/cli/src/commands/team.ts'],
    evidenceRequired: 'command-backed'
  });

  assert.equal(contract.artifactHandoff.schemaId, 'atm.teamArtifactHandoffContract.v1');
  assert.deepEqual(contract.artifactHandoff.requiredRoles, ['evidence-collector', 'implementer', 'reviewer', 'validator']);
  for (const role of contract.artifactHandoff.requiredRoles) {
    const roleContract = contract.artifactHandoff.roleContracts.find((entry: any) => entry.role === role);
    assert.ok(roleContract, `missing role artifact contract for ${role}`);
    assert.ok(roleContract.consumesFrom.length > 0, `${role} must declare consumed artifacts`);
    assert.ok(roleContract.producesTo.length > 0, `${role} must declare artifact destinations`);
    assert.ok(roleContract.requiredArtifacts.length > 0, `${role} must declare required artifacts`);
  }

  const missingFindings = validateTeamArtifactHandoff({
    roleContracts: contract.artifactHandoff.roleContracts,
    producedArtifacts: ['implementation-diff']
  });
  assert.ok(
    missingFindings.some((entry: any) => entry.code === 'missing-required-artifact' && entry.blocking === true),
    'missing required artifacts must produce blocking findings'
  );

  const completeHandoff = buildTeamArtifactHandoffContract({
    recipe: {
      schemaId: 'atm.teamRecipe.v1',
      recipeId: 'atm.artifact-handoff.complete',
      agents: []
    },
    producedArtifacts: [
      'implementation-diff',
      'implementation-notes',
      'review-findings',
      'validator-results',
      'command-backed-evidence',
      'closure-packet'
    ]
  });
  assert.equal(completeHandoff.closeAllowed, true);
  assert.deepEqual(completeHandoff.findings, []);

  const budget = buildTeamRetryBudgetContract({
    maxReworkCycles: 2,
    maxValidatorReruns: 3,
    maxReviewerReturns: 1,
    usedReworkCycles: 2,
    escalationTarget: 'captain'
  });
  assert.equal(budget.maxReworkCycles, 2);
  assert.equal(budget.maxValidatorReruns, 3);
  assert.equal(budget.maxReviewerReturns, 1);
  assert.equal(budget.status, 'escalation-required');
  assert.equal(budget.escalationTarget, 'captain');

  const evidence = buildTeamArtifactHandoffEvidence({
    producedArtifacts: ['implementation-diff', 'validator-results'],
    missingArtifacts: ['review-findings'],
    retryBudgetStatus: budget.status,
    escalationTarget: budget.escalationTarget,
    closeAllowed: false
  });
  assert.equal(evidence.schemaId, 'atm.teamArtifactHandoffEvidence.v1');
  assert.equal(evidence.retryBudgetStatus, 'escalation-required');
  assert.equal(evidence.escalationTarget, 'captain');
  assert.equal(evidence.closeAllowed, false);

  const implementerEnvelope = contract.editorSubagentBridge.roleEnvelopes.find((entry: any) => entry.role === 'implementer');
  assert.ok(implementerEnvelope, 'editor bridge must carry role artifact metadata');
  assert.deepEqual(implementerEnvelope.artifactMetadata.requiredArtifacts, ['implementation-diff', 'implementation-notes']);
  assert.ok(implementerEnvelope.artifactMetadata.consumesFrom.includes('task-card'));
  assert.ok(implementerEnvelope.artifactMetadata.producesTo.includes('validator'));

  console.log('[validate-team-agents] ok (artifact-handoff-retry)');
  return true;
}
