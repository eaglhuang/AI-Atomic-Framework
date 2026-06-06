import type { AtomBehavior, AtomBehaviorOutput } from '@ai-atomic-framework/plugin-sdk';

const mapIdPattern = /^ATM-MAP-\d{4}$/;

function fail(issue: string, details: Readonly<Record<string, unknown>>): AtomBehaviorOutput {
  return {
    ok: false,
    issues: [issue],
    evidence: [
      {
        evidenceKind: 'validation',
        summary: 'Atomize behavior rejected input.',
        artifactPaths: [],
        details
      }
    ]
  };
}

function buildProposalEnvelope(payload: Record<string, unknown>) {
  return {
    schemaId: 'atm.upgradeProposal',
    proposalSource: 'ATM-2-0020',
    behaviorId: 'behavior.atomize',
    decompositionDecision: 'atom-extract',
    applyToHostProject: false,
    hostMutationAllowed: false,
    patchMode: 'dry-run',
    target: payload.target ?? { kind: 'atom' }
  };
}

export const atomizeBehavior: AtomBehavior = {
  behaviorId: 'builtin-atomize-behavior',
  actionCategories: ['behavior.atomize'],
  execute(_context, input) {
    if (input.action !== 'behavior.atomize') {
      return fail('atomize-action-mismatch', { action: input.action });
    }

    const payload = (input.payload ?? {}) as Record<string, unknown>;
    const joinMap = payload.joinMap === true;
    const membershipMapId = typeof payload.membershipMapId === 'string' ? payload.membershipMapId.trim() : '';
    if (joinMap && !mapIdPattern.test(membershipMapId)) {
      return fail('atomize-membership-map-id-invalid', {
        membershipMapId: payload.membershipMapId ?? null
      });
    }

    const proposalEnvelope = buildProposalEnvelope(payload);

    return {
      ok: true,
      registryTransition: {
        fromStatus: 'draft',
        toStatus: 'active',
        governanceTier: 'standard',
        notes: 'Atomize emits atom-extract proposal and records canonical map membership when provided.'
      },
      rollbackPlan: {
        steps: [
          'discard dry-run atomize patch envelope',
          'require ATM-2-0021 approval before any host apply'
        ]
      },
      issues: [],
      evidence: [
        {
          evidenceKind: 'validation',
          summary: 'Atomize behavior emitted dry-run proposal envelope with atom-extract decision.',
          artifactPaths: [],
          details: {
            proposalEnvelope,
            canonicalMembershipMapId: joinMap ? membershipMapId : null
          }
        }
      ]
    };
  }
};

export default atomizeBehavior;
