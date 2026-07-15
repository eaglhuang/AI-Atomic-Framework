import assert from 'node:assert/strict';
import { buildReviewAgentSignature, evaluateReviewQuorum } from '../../../packages/cli/src/commands/team.ts';

export function runMultiSignatureQuorumValidatorCase(taskCase: string): boolean {
  if (taskCase !== 'multi-signature-quorum') return false;

  const formalA = buildReviewAgentSignature({
    taskId: 'TASK-TEAM-0061',
    implementer: { providerId: 'openai', modelId: 'gpt-5-mini', modelCertificationId: 'cert-openai-mini' },
    reviewer: { providerId: 'claude-code', modelId: 'claude-sonnet', modelCertificationId: 'cert-claude-sonnet' },
    reviewedDiffHash: 'sha256:quorum',
    policy: 'different-provider',
    findings: ['approve']
  });
  const advisory = buildReviewAgentSignature({
    taskId: 'TASK-TEAM-0061',
    implementer: { providerId: 'openai', modelId: 'gpt-5-mini', modelCertificationId: 'cert-openai-mini' },
    reviewer: { providerId: 'openai', modelId: 'gpt-5-mini' },
    reviewedDiffHash: 'sha256:quorum',
    policy: 'different-provider',
    findings: ['approve']
  });
  const insufficient = evaluateReviewQuorum({ signatures: [formalA, advisory], requiredFormalSignatures: 2 });
  assert.equal(insufficient.ok, false);
  assert.equal(insufficient.formalSignatureCount, 1);
  assert.equal(insufficient.escalationTarget, 'Coordinator/Captain/human review');
  const formalB = buildReviewAgentSignature({
    taskId: 'TASK-TEAM-0061',
    implementer: { providerId: 'openai', modelId: 'gpt-5-mini', modelCertificationId: 'cert-openai-mini' },
    reviewer: { providerId: 'gemini', modelId: 'gemini-pro', modelCertificationId: 'cert-gemini-pro' },
    reviewedDiffHash: 'sha256:quorum',
    policy: 'different-provider',
    findings: ['approve']
  });
  assert.equal(evaluateReviewQuorum({ signatures: [formalA, formalB], requiredFormalSignatures: 2 }).ok, true);
  const conflict = evaluateReviewQuorum({
    signatures: [formalA, { ...formalB, findings: ['block'] }],
    requiredFormalSignatures: 2
  });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.conflicts.length, 1);
  console.log('[validate-team-agents] ok (multi-signature-quorum)');
  return true;
}
