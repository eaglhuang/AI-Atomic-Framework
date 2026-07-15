import assert from 'node:assert/strict';
import { buildReviewAgentSignature, evaluateReviewerIndependence } from '../../../packages/cli/src/commands/team.ts';

export function runReviewerIndependenceEarlyWarningValidatorCase(taskCase: string): boolean {
  if (taskCase !== 'reviewer-independence-early-warning') return false;

  assert.equal(evaluateReviewerIndependence({
    implementer: { providerId: 'openai', modelId: 'gpt-5-mini', modelCertificationId: 'cert-a' },
    reviewer: { providerId: 'claude-code', modelId: 'claude-sonnet', modelCertificationId: 'cert-b' },
    policy: 'different-provider'
  }).ok, true);
  assert.equal(evaluateReviewerIndependence({
    implementer: { providerId: 'openai', modelId: 'gpt-5-mini', modelCertificationId: 'cert-a' },
    reviewer: { providerId: 'openai', modelId: 'gpt-5-large', modelCertificationId: 'cert-b' },
    policy: 'different-provider'
  }).ok, false);
  assert.equal(evaluateReviewerIndependence({
    implementer: { providerId: 'openai', modelId: 'gpt-5-mini', modelCertificationId: 'cert-a' },
    reviewer: { providerId: 'openai', modelId: 'claude-sonnet', modelCertificationId: 'cert-b' },
    policy: 'different-model-family'
  }).ok, true);
  assert.equal(evaluateReviewerIndependence({
    implementer: { providerId: 'openai', modelId: 'gpt-5-mini', modelCertificationId: 'cert-a' },
    reviewer: { providerId: 'openai', modelId: 'gpt-5-mini', modelCertificationId: 'cert-b' },
    policy: 'different-certification'
  }).ok, true);
  const signature = buildReviewAgentSignature({
    taskId: 'TASK-TEAM-0060',
    implementer: { providerId: 'openai', modelId: 'gpt-5-mini', modelCertificationId: 'cert-a' },
    reviewer: { providerId: 'claude-code', modelId: 'claude-sonnet', modelCertificationId: 'cert-b' },
    reviewedDiffHash: 'sha256:early-warning',
    policy: 'different-provider',
    findings: ['scope drift in generated file', 'rollback gap missing']
  });
  assert.deepEqual(signature.earlyWarning.map((entry: any) => entry.category), ['scope-drift', 'rollback-gap']);
  console.log('[validate-team-agents] ok (reviewer-independence-early-warning)');
  return true;
}
