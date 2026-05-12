import type { AtomBehavior, AtomBehaviorOutput } from '@ai-atomic-framework/plugin-sdk';

const mapIdPattern = /^ATM-MAP-\d{4}$/;

function failure(issue: string, summary: string, details: Readonly<Record<string, unknown>> = {}): AtomBehaviorOutput {
  return {
    ok: false,
    issues: [issue],
    evidence: [
      {
        evidenceKind: 'validation',
        summary,
        artifactPaths: [],
        details
      }
    ]
  };
}

export const composeBehavior: AtomBehavior = {
  behaviorId: 'builtin-compose-behavior',
  actionCategories: ['behavior.compose'],
  async execute(context, input) {
    if (input.action !== 'behavior.compose') {
      return failure('compose-action-mismatch', 'Compose behavior received a non-compose action.', { action: input.action });
    }

    const payload = (input.payload ?? {}) as Record<string, unknown>;
    const generator = payload.generateAtomicMap as ((request: Record<string, unknown>, options: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>) | undefined;
    if (typeof generator !== 'function') {
      return failure('compose-map-generator-missing', 'Compose behavior requires generateAtomicMap delegate.', {
        reason: 'missing payload.generateAtomicMap'
      });
    }

    const request = {
      members: Array.isArray(payload.members) ? payload.members : [],
      edges: Array.isArray(payload.edges) ? payload.edges : [],
      entrypoints: Array.isArray(payload.entrypoints) ? payload.entrypoints : [],
      qualityTargets: typeof payload.qualityTargets === 'object' && payload.qualityTargets !== null ? payload.qualityTargets : { requiredChecks: 1 }
    };
    const delegated = await generator(request, {
      repositoryRoot: context.repositoryRoot,
      dryRun: true
    });

    const mapId = typeof delegated?.mapId === 'string' ? delegated.mapId : '';
    if (delegated?.ok !== true || !mapIdPattern.test(mapId)) {
      return failure('compose-map-generator-invalid-result', 'Compose behavior delegate did not return canonical ATM-MAP id.', {
        delegated
      });
    }

    return {
      ok: true,
      registryTransition: {
        fromStatus: 'active',
        toStatus: 'active',
        governanceTier: 'standard',
        notes: 'Compose behavior delegated map entry creation to AtomicMapGenerator.'
      },
      issues: [],
      evidence: [
        {
          evidenceKind: 'validation',
          summary: 'Compose behavior delegated map creation to generateAtomicMap().',
          artifactPaths: [],
          details: {
            delegatedTo: 'generateAtomicMap',
            mapId,
            requestShape: {
              memberCount: Array.isArray(request.members) ? request.members.length : 0,
              edgeCount: Array.isArray(request.edges) ? request.edges.length : 0
            }
          }
        }
      ]
    };
  }
};

export default composeBehavior;
