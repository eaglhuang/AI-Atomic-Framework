const mapIdPattern = /^ATM-MAP-\d{4}$/;
function success(summary, details, mapId) {
    return {
        ok: true,
        registryTransition: {
            fromStatus: 'active',
            toStatus: 'active',
            governanceTier: 'standard',
            notes: 'Split source atom into sub-atoms under governed behavior flow.'
        },
        issues: [],
        evidence: [
            {
                evidenceKind: 'validation',
                summary,
                artifactPaths: [],
                details: mapId ? { ...details, delegatedMapId: mapId } : details
            }
        ]
    };
}
function failure(issue, summary, details = {}) {
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
export const splitBehavior = {
    behaviorId: 'builtin-split-behavior',
    actionCategories: ['behavior.split'],
    async execute(context, input) {
        if (input.action !== 'behavior.split') {
            return failure('split-action-mismatch', 'Split behavior received a non-split action.', { action: input.action });
        }
        const payload = (input.payload ?? {});
        const demandTrigger = payload.demandTrigger;
        const reportId = typeof demandTrigger?.reportId === 'string' ? demandTrigger.reportId : null;
        const shouldProduceMap = payload.produceMap === true || Array.isArray(payload.subAtoms);
        if (!shouldProduceMap) {
            return success('Split behavior dry-run accepted without map emission.', {
                evidenceSource: 'caller-distribution-report',
                reportId
            });
        }
        const generator = payload.generateAtomicMap;
        if (typeof generator !== 'function') {
            return failure('split-map-generator-missing', 'Split behavior requested sub-atom map but no map generator delegate was provided.', {
                reportId
            });
        }
        const mapRequest = {
            members: Array.isArray(payload.members) ? payload.members : [],
            edges: Array.isArray(payload.edges) ? payload.edges : [],
            entrypoints: Array.isArray(payload.entrypoints) ? payload.entrypoints : [],
            qualityTargets: typeof payload.qualityTargets === 'object' && payload.qualityTargets !== null ? payload.qualityTargets : { requiredChecks: 1 }
        };
        const mapResult = await generator(mapRequest, {
            repositoryRoot: context.repositoryRoot,
            dryRun: true
        });
        const mapId = typeof mapResult?.mapId === 'string' ? mapResult.mapId : '';
        if (mapResult?.ok !== true || !mapIdPattern.test(mapId)) {
            return failure('split-map-generator-invalid-result', 'Split behavior delegate did not return a canonical ATM map id.', {
                reportId,
                mapResult
            });
        }
        return success('Split behavior delegated map creation to generateAtomicMap().', {
            evidenceSource: 'caller-distribution-report',
            reportId,
            delegatedTo: 'generateAtomicMap'
        }, mapId);
    }
};
export default splitBehavior;
