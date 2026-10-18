import { buildLegacyRoutePlan } from '../../guidance/legacy-route-plan.js';
import { makeEvidenceRef, makePoliceFinding, makePoliceFamilyReport, sanitizeId } from '../shared.js';
export async function runDemandPolice(input = {}) {
    const plan = input.legacyRoutePlan ?? (input.buildLegacyRoutePlanInput ? await buildLegacyRoutePlan(input.buildLegacyRoutePlanInput) : null);
    const demandThreshold = input.demandThreshold ?? input.buildLegacyRoutePlanInput?.demandThreshold ?? 6;
    const findings = [];
    for (const segment of plan?.segments ?? []) {
        if (segment.role === 'trunk') {
            continue;
        }
        const exceedsThreshold = segment.callerDemand >= demandThreshold || segment.recommendedBehavior === 'split';
        if (!exceedsThreshold) {
            continue;
        }
        findings.push(makePoliceFinding({
            findingId: `police.demand.caller-demand-threshold.${sanitizeId(segment.symbolName)}`,
            policeFamily: 'demand',
            severity: 'advisory',
            trigger: 'caller-demand-threshold',
            scope: `${plan?.targetFile ?? 'legacy'}#${segment.symbolName}`,
            action: 'needs-review',
            routeHint: 'behavior.split',
            readModel: 'LegacyRoutePlan.callerDemand',
            message: `${segment.symbolName} caller demand ${segment.callerDemand} meets split threshold ${demandThreshold}.`,
            evidenceRefs: [makeEvidenceRef('caller-graph-snapshot', 'read-model')],
            metadata: {
                demandThreshold,
                segment,
                directApplyAllowed: false
            }
        }));
    }
    return makePoliceFamilyReport({
        family: 'demand',
        mode: 'advisory',
        status: 'pass',
        findings,
        sourceValidator: 'runDemandPolice'
    });
}
