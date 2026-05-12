import type { AtomBehavior, AtomBehaviorOutput } from '@ai-atomic-framework/plugin-sdk';

function buildProposalEnvelope(payload: Record<string, unknown>) {
  return {
    schemaId: 'atm.upgradeProposal',
    proposalSource: 'ATM-2-0020',
    behaviorId: 'behavior.infect',
    decompositionDecision: 'atom-extract',
    applyToHostProject: false,
    hostMutationAllowed: false,
    patchMode: 'dry-run',
    target: payload.target ?? { kind: 'atom' }
  };
}

export const infectBehavior: AtomBehavior = {
  behaviorId: 'builtin-infect-behavior',
  actionCategories: ['behavior.infect'],
  execute(_context, input) {
    if (input.action !== 'behavior.infect') {
      return {
        ok: false,
        issues: ['infect-action-mismatch'],
        evidence: [
          {
            evidenceKind: 'validation',
            summary: 'Infect behavior received a non-infect action.',
            artifactPaths: [],
            details: { action: input.action }
          }
        ]
      };
    }

    const payload = (input.payload ?? {}) as Record<string, unknown>;
    const proposalEnvelope = buildProposalEnvelope(payload);

    return {
      ok: true,
      registryTransition: {
        fromStatus: 'active',
        toStatus: 'active',
        governanceTier: 'standard',
        notes: 'Infect emits dry-run patch proposal and defers host mutation to review flow.'
      },
      rollbackPlan: {
        steps: [
          'discard dry-run infect patch envelope',
          'request ATM-2-0021 review before any apply'
        ]
      },
      issues: [],
      evidence: [
        {
          evidenceKind: 'validation',
          summary: 'Infect behavior wrapped dry-run patch into ATM-2-0020 proposal envelope.',
          artifactPaths: [],
          details: {
            proposalEnvelope
          }
        }
      ]
    };
  }
};

export default infectBehavior;
