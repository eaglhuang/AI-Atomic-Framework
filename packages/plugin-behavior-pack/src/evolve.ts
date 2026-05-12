import { EVOLVE_DELEGATION_TARGET, type AtomBehavior, type AtomBehaviorOutput } from '@ai-atomic-framework/plugin-sdk';

function fail(issue: string, details: Readonly<Record<string, unknown>> = {}): AtomBehaviorOutput {
  return {
    ok: false,
    issues: [issue],
    evidence: [
      {
        evidenceKind: 'validation',
        summary: 'Evolve behavior failed delegation precondition.',
        artifactPaths: [],
        details
      }
    ]
  };
}

export const evolveBehavior: AtomBehavior = {
  behaviorId: 'builtin-evolve-behavior',
  actionCategories: ['behavior.evolve'],
  execute(_context, input) {
    if (input.action !== 'behavior.evolve') {
      return fail('evolve-action-mismatch', { action: input.action });
    }
    return {
      ok: true,
      delegatedTo: EVOLVE_DELEGATION_TARGET,
      registryTransition: {
        fromStatus: 'active',
        toStatus: 'active',
        governanceTier: 'standard',
        notes: 'Evolve delegates through ATM-2-0020 proposal gate before promotion.'
      },
      issues: [],
      evidence: [
        {
          evidenceKind: 'validation',
          summary: 'Evolve behavior delegated to ProposeAtomicUpgrade contract.',
          artifactPaths: [],
          details: {
            delegatedTo: EVOLVE_DELEGATION_TARGET
          }
        }
      ]
    };
  }
};

export default evolveBehavior;
