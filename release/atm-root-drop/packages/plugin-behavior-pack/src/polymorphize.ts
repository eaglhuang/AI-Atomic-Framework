import type { AtomBehavior, AtomBehaviorOutput } from '@ai-atomic-framework/plugin-sdk';

function fail(issue: string, details: Readonly<Record<string, unknown>>): AtomBehaviorOutput {
  return {
    ok: false,
    issues: [issue],
    evidence: [
      {
        evidenceKind: 'validation',
        summary: 'Polymorphize behavior input is invalid.',
        artifactPaths: [],
        details
      }
    ]
  };
}

export const polymorphizeBehavior: AtomBehavior = {
  behaviorId: 'builtin-polymorphize-behavior',
  actionCategories: ['behavior.polymorphize'],
  execute(_context, input) {
    if (input.action !== 'behavior.polymorphize') {
      return fail('polymorphize-action-mismatch', { action: input.action });
    }
    const payload = (input.payload ?? {}) as Record<string, unknown>;
    const variantId = typeof payload.variantId === 'string' ? payload.variantId.trim() : '';
    if (!variantId) {
      return fail('polymorphize-missing-variant-id', { variantId: payload.variantId ?? null });
    }
    return {
      ok: true,
      registryTransition: {
        fromStatus: 'active',
        toStatus: 'active',
        governanceTier: 'standard',
        notes: 'Polymorphize records validated variant routing without changing atom status.'
      },
      issues: [],
      evidence: [
        {
          evidenceKind: 'validation',
          summary: 'Polymorphize behavior accepted variant routing contract.',
          artifactPaths: [],
          details: {
            variantId
          }
        }
      ]
    };
  }
};

export default polymorphizeBehavior;
