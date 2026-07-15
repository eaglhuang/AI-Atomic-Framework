import assert from 'node:assert/strict';
import { buildReviewAgentSignature } from '../../../packages/cli/src/commands/team.ts';

export function runReviewAgentSignatureValidatorCase(taskCase: string): boolean {
  if (taskCase !== 'review-agent-signature') return false;

  const signature = buildReviewAgentSignature({
    taskId: 'TASK-TEAM-0059',
    implementer: { providerId: 'openai', modelId: 'gpt-5-mini', modelCertificationId: 'cert-openai-mini' },
    reviewer: { providerId: 'claude-code', modelId: 'claude-sonnet', modelCertificationId: 'cert-claude-sonnet' },
    reviewedDiffHash: 'sha256:reviewed-diff',
    policy: 'different-provider',
    findings: ['missing tests around close gate']
  });
  assert.equal(signature.schemaId, 'atm.reviewAgentSignature.v1');
  assert.equal(signature.signatureStatus, 'formal-signature');
  assert.equal(signature.permission, 'review.signature.write');
  assert.equal(signature.modelCertificationId, 'cert-claude-sonnet');
  assert.equal(signature.earlyWarning[0].category, 'missing-tests');
  const advisory = buildReviewAgentSignature({
    taskId: 'TASK-TEAM-0059',
    implementer: { providerId: 'openai', modelId: 'gpt-5-mini', modelCertificationId: 'cert-openai-mini' },
    reviewer: { providerId: 'openai', modelId: 'gpt-5-mini' },
    reviewedDiffHash: 'sha256:reviewed-diff',
    policy: 'different-provider'
  });
  assert.equal(advisory.signatureStatus, 'advisory-note');
  assert.equal(advisory.permission, null);
  console.log('[validate-team-agents] ok (review-agent-signature)');
  return true;
}
