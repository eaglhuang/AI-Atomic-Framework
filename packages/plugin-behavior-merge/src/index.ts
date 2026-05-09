import type { AtomBehavior, AtomBehaviorOutput } from '../../plugin-sdk/src/behavior.ts';

function failure(issue: string, details: Readonly<Record<string, unknown>> = {}): AtomBehaviorOutput {
  return {
    ok: false,
    issues: [issue],
    evidence: [
      {
        evidenceKind: 'validation',
        summary: 'Merge behavior validation failed.',
        artifactPaths: [],
        details
      }
    ]
  };
}

export const behavior: AtomBehavior = {
  behaviorId: 'builtin-merge-behavior',
  actionCategories: ['behavior.merge'],
  execute(_context, input) {
    if (input.action !== 'behavior.merge') {
      return failure('merge-action-mismatch', { action: input.action });
    }
    const payload = (input.payload ?? {}) as Record<string, unknown>;
    const sourceAtomIds = Array.isArray(payload.sourceAtomIds)
      ? payload.sourceAtomIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    if (sourceAtomIds.length < 2) {
      return failure('merge-source-count-too-low', { sourceAtomIds });
    }
    return {
      ok: true,
      registryTransition: {
        fromStatus: 'active',
        toStatus: 'active',
        governanceTier: 'standard',
        notes: 'Merge selected source atoms and deprecate merged sources in governance flow.'
      },
      issues: [],
      evidence: [
        {
          evidenceKind: 'validation',
          summary: 'Merge behavior accepted source atoms for dry-run merge plan.',
          artifactPaths: [],
          details: {
            sourceAtomIds
          }
        }
      ]
    };
  }
};

export default behavior;
