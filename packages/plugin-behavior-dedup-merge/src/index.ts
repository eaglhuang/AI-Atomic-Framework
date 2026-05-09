import type { AtomBehavior, AtomBehaviorOutput } from '../../plugin-sdk/src/behavior.ts';

function fail(issue: string, details: Readonly<Record<string, unknown>>): AtomBehaviorOutput {
  return {
    ok: false,
    issues: [issue],
    evidence: [
      {
        evidenceKind: 'validation',
        summary: 'Dedup-merge behavior failed input validation.',
        artifactPaths: [],
        details
      }
    ]
  };
}

export const behavior: AtomBehavior = {
  behaviorId: 'builtin-dedup-merge-behavior',
  actionCategories: ['behavior.dedup-merge'],
  execute(_context, input) {
    if (input.action !== 'behavior.dedup-merge') {
      return fail('dedup-merge-action-mismatch', { action: input.action });
    }
    const payload = (input.payload ?? {}) as Record<string, unknown>;
    const sourceAtomIds = Array.isArray(payload.sourceAtomIds)
      ? payload.sourceAtomIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
    if (sourceAtomIds.length !== 2) {
      return fail('dedup-merge-requires-exactly-two-sources', { sourceAtomIds });
    }
    return {
      ok: true,
      registryTransition: {
        fromStatus: 'active',
        toStatus: 'active',
        governanceTier: 'standard',
        notes: 'Dedup merge keeps canonical target and deprecates duplicate source atom.'
      },
      issues: [],
      evidence: [
        {
          evidenceKind: 'validation',
          summary: 'Dedup-merge accepted exactly two source atoms for dry-run merge plan.',
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
