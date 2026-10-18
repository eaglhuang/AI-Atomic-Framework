import { makeEvidenceRef, makePoliceFinding, makePoliceFamilyReport, sanitizeId } from '../shared.js';
export function runAtomizationPolice(input = {}) {
    const findings = [];
    for (const segment of input.legacyRoutePlan?.segments ?? []) {
        if (segment.recommendedBehavior !== 'atomize' && segment.recommendedBehavior !== 'infect') {
            continue;
        }
        findings.push(makePoliceFinding({
            findingId: `police.atomization.${segment.recommendedBehavior}.${sanitizeId(segment.symbolName)}`,
            policeFamily: 'atomization',
            severity: 'advisory',
            trigger: 'legacy-route-plan-candidate',
            scope: `${input.legacyRoutePlan?.targetFile ?? 'legacy'}#${segment.symbolName}`,
            action: 'needs-review',
            routeHint: `behavior.${segment.recommendedBehavior}`,
            readModel: 'LegacyRoutePlan.segments',
            message: `${segment.symbolName} is eligible for ${segment.recommendedBehavior} dry-run planning.`,
            evidenceRefs: [makeEvidenceRef('caller-graph-snapshot', 'read-model')],
            metadata: {
                segment
            }
        }));
    }
    if (input.dryRunResult) {
        const dryRunResult = input.dryRunResult;
        const dryRunExtra = dryRunResult.extra && typeof dryRunResult.extra === 'object' && !Array.isArray(dryRunResult.extra)
            ? dryRunResult.extra
            : null;
        const dryRunPatch = (dryRunExtra?.dryRunPatch ?? dryRunResult.dryRunPatch);
        const neutrality = (dryRunExtra?.neutrality ?? dryRunResult.neutrality);
        const contractFailures = [];
        if (!dryRunPatch) {
            contractFailures.push('missing-dry-run-patch');
        }
        else {
            if (dryRunPatch.dryRun !== true)
                contractFailures.push('dryRun-must-be-true');
            if (dryRunPatch.applyToHostProject === true)
                contractFailures.push('applyToHostProject-must-not-be-true');
            if (dryRunPatch.hostMutationAllowed === true)
                contractFailures.push('hostMutationAllowed-must-not-be-true');
            if (dryRunPatch.patchMode !== 'dry-run')
                contractFailures.push('patchMode-must-be-dry-run');
        }
        if (dryRunResult.ok === false) {
            contractFailures.push('adapter-result-not-ok');
        }
        if ((neutrality?.violationCount ?? 0) > 0 || neutrality?.ok === false) {
            contractFailures.push('neutrality-scan-failed');
        }
        if (contractFailures.length > 0) {
            findings.push(makePoliceFinding({
                findingId: 'police.atomization.dry-run-guard.blocker',
                policeFamily: 'atomization',
                severity: 'block',
                trigger: 'dry-run-proposal-guard',
                scope: typeof dryRunPatch?.contractId === 'string' ? dryRunPatch.contractId : 'atomization-dry-run',
                action: 'request-human-review',
                routeHint: 'behavior.atomize',
                readModel: 'ProjectAdapterDryRunPatchContract',
                message: `Atomization dry-run guard failed: ${contractFailures.join(', ')}.`,
                evidenceRefs: [
                    makeEvidenceRef('dry-run-patch', 'police-artifact'),
                    makeEvidenceRef('neutrality-scan', 'police-artifact')
                ],
                metadata: {
                    contractFailures,
                    dryRunPatch,
                    neutrality
                }
            }));
        }
    }
    return makePoliceFamilyReport({
        family: 'atomization',
        mode: 'advisory',
        status: 'pass',
        findings,
        sourceValidator: 'runAtomizationPolice'
    });
}
