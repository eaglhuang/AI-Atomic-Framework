import { createHash } from 'node:crypto';
export function evaluateTeamEfficiency(input) {
    const cohortKey = digestCohort({
        rosterFingerprintDigest: input.rosterFingerprintDigest,
        modelMixDigest: input.modelMixDigest,
        contextManifestDigest: input.contextManifestDigest,
        promptCachePolicy: input.promptCachePolicy,
        fanOutCap: input.fanOutCap,
        quotaProbeDigest: input.quotaProbeDigest,
        pricingCatalogVersion: input.pricingCatalogVersion
    });
    const tokenDiagnosticReasonCodes = tokenReasonCodes(input.telemetry);
    const reasonCodes = efficiencyReasonCodes(input);
    const boundedExperiment = !input.workloadClass || !input.priceEvidenceFresh || !input.usageEvidenceComplete;
    const productionThresholdOk = input.ratios.fullyLoadedCostRatio !== null
        && input.ratios.fullyLoadedCostRatio <= 0.80
        && input.ratios.wallClockRatio !== null
        && input.ratios.wallClockRatio <= 0.75
        && input.qualityParity
        && input.noWorseRepairResidue
        && !input.stopLossTriggered
        && input.telemetry.quotaOk
        && !input.telemetry.spendingCeilingRisk;
    const preferredRouting = productionThresholdOk
        && input.ratios.fullyLoadedCostRatio !== null
        && input.ratios.fullyLoadedCostRatio <= 0.75
        && input.ratios.wallClockRatio !== null
        && input.ratios.wallClockRatio <= 0.65;
    const breakthroughTarget = preferredRouting
        && input.ratios.fullyLoadedCostRatio !== null
        && input.ratios.fullyLoadedCostRatio <= 0.50
        && input.ratios.wallClockRatio !== null
        && input.ratios.wallClockRatio <= 0.50;
    const scaleDownAction = chooseScaleDownAction(input, reasonCodes);
    const promotionEligible = productionThresholdOk && !boundedExperiment && scaleDownAction === 'none';
    const routing = scaleDownAction !== 'none'
        ? 'scale-down'
        : boundedExperiment
            ? 'bounded-experiment'
            : promotionEligible
                ? preferredRouting ? 'prefer-team' : 'promote-production'
                : 'single-agent';
    const bottleneckCause = reasonCodes[0] ?? null;
    return {
        schemaId: 'atm.teamEfficiencyControllerDecision.v1',
        routing,
        promotionEligible,
        preferredRouting,
        breakthroughTarget,
        boundedExperiment,
        cohortKey,
        scaleDownAction,
        reasonCodes,
        bottleneckCause,
        optimizationBacklogTarget: bottleneckCause ? `Improve Team efficiency: ${bottleneckCause}` : null,
        tokenDiagnosticReasonCodes
    };
}
export function evaluatePairedDogfoodSample(input) {
    const sample = input.sample;
    const baselineTokens = usageTokens(sample.usage?.baseline);
    const teamTokens = usageTokens(sample.usage?.team);
    const ratios = {
        fullyLoadedCostRatio: baselineTokens > 0 && teamTokens > 0 ? teamTokens / baselineTokens : null,
        wallClockRatio: sample.wallClock.baselineMs && sample.wallClock.teamMs
            ? sample.wallClock.teamMs / sample.wallClock.baselineMs
            : null,
        tokenRatio: baselineTokens > 0 && teamTokens > 0 ? teamTokens / baselineTokens : null,
        repairResidueRatio: 1
    };
    const decision = evaluateTeamEfficiency({
        workloadClass: input.workloadClass ?? 'paired-dogfood',
        rosterFingerprintDigest: stableDigest(sample.modelIdentities ?? []),
        modelMixDigest: stableDigest(sample.modelIdentities ?? []),
        contextManifestDigest: stableDigest(sample.sampleId),
        promptCachePolicy: 'sample-observed',
        fanOutCap: 6,
        quotaProbeDigest: stableDigest(sample.pricingCatalogVersion ?? 'unknown-pricing'),
        pricingCatalogVersion: sample.pricingCatalogVersion ?? 'unknown-pricing',
        priceEvidenceFresh: Boolean(sample.pricingCatalogVersion),
        usageEvidenceComplete: sample.measurementStatus === 'complete' && sample.providerBillableUsage,
        qualityParity: sample.qualityOutcome.baselinePassed === true && sample.qualityOutcome.teamPassed === true,
        noWorseRepairResidue: true,
        stopLossTriggered: false,
        ratios,
        telemetry: {
            contextInflation: ratios.tokenRatio !== null && ratios.tokenRatio > 1,
            cacheMiss: false,
            retries: 0,
            quotaOk: true,
            queueWaitInflationRatio: null,
            spendingCeilingRisk: false
        }
    });
    return {
        schemaId: 'atm.teamEfficiencyPairedSampleEvaluation.v1',
        sampleId: sample.sampleId,
        decision,
        incident: createTeamEfficiencyIncident({
            sampleId: sample.sampleId,
            decision,
            ratios,
            generatedAt: input.generatedAt
        })
    };
}
export function createTeamEfficiencyIncident(input) {
    return {
        schemaId: 'atm.teamEfficiencyIncident.v1',
        specVersion: '0.1.0',
        migration: { strategy: 'additive', fromVersion: null, notes: 'ATM-GOV-0140 efficiency controller incident' },
        incidentId: `team-eff-${sha256(`${input.sampleId}:${input.decision.cohortKey}:${input.decision.routing}`).slice(0, 12)}`,
        generatedAt: input.generatedAt ?? new Date().toISOString(),
        severity: input.decision.promotionEligible ? 'advisory' : 'blocking',
        reason: input.decision.reasonCodes.join(', ') || 'team-efficient',
        sampleId: input.sampleId,
        cohortKey: input.decision.cohortKey,
        routing: input.decision.routing,
        scaleDownAction: input.decision.scaleDownAction,
        bottleneckCause: input.decision.bottleneckCause,
        optimizationBacklogTarget: input.decision.optimizationBacklogTarget,
        tokenDiagnosticReasonCodes: input.decision.tokenDiagnosticReasonCodes,
        ratios: {
            incrementalCashCostRatio: input.ratios.fullyLoadedCostRatio ?? 0,
            fullyLoadedCashCostRatio: input.ratios.fullyLoadedCostRatio ?? 0,
            listPriceEquivalentCostRatio: input.ratios.fullyLoadedCostRatio ?? 0,
            singleTaskLatencyRatio: input.ratios.wallClockRatio ?? 0,
            batchMakespanRatio: input.ratios.wallClockRatio ?? 0,
            throughputRatio: input.ratios.wallClockRatio === null || input.ratios.wallClockRatio === 0 ? 0 : 1 / input.ratios.wallClockRatio,
            tokenRatio: input.ratios.tokenRatio ?? 0,
            repairResidueRatio: input.ratios.repairResidueRatio ?? 0
        }
    };
}
function efficiencyReasonCodes(input) {
    const reasons = [];
    if (!input.workloadClass)
        reasons.push('unknown-workload-class');
    if (!input.priceEvidenceFresh)
        reasons.push('missing-or-stale-price-evidence');
    if (!input.usageEvidenceComplete)
        reasons.push('missing-provider-usage-evidence');
    if (input.stopLossTriggered)
        reasons.push('stop-loss-triggered');
    if (!input.telemetry.quotaOk)
        reasons.push('quota-or-rate-limit-failure');
    if (input.telemetry.queueWaitInflationRatio !== null && input.telemetry.queueWaitInflationRatio > 1.25)
        reasons.push('queue-wait-inflation');
    if (input.telemetry.spendingCeilingRisk)
        reasons.push('spending-ceiling-risk');
    if (input.ratios.fullyLoadedCostRatio === null || input.ratios.fullyLoadedCostRatio > 0.80)
        reasons.push('fully-loaded-cost-threshold-miss');
    if (input.ratios.wallClockRatio === null || input.ratios.wallClockRatio > 0.75)
        reasons.push('wall-clock-threshold-miss');
    if (!input.qualityParity)
        reasons.push('quality-parity-miss');
    if (!input.noWorseRepairResidue)
        reasons.push('repair-residue-regression');
    return reasons;
}
function tokenReasonCodes(telemetry) {
    const reasons = [];
    if (telemetry.contextInflation)
        reasons.push('context-inflation');
    if (telemetry.cacheMiss)
        reasons.push('cache-miss');
    if (telemetry.retries > 0)
        reasons.push('retries');
    return reasons;
}
function chooseScaleDownAction(input, reasonCodes) {
    if (input.stopLossTriggered || reasonCodes.includes('spending-ceiling-risk'))
        return 'disable-team-for-workload';
    if (reasonCodes.includes('quota-or-rate-limit-failure') || reasonCodes.includes('queue-wait-inflation'))
        return 'shrink-team-size';
    if (reasonCodes.includes('fully-loaded-cost-threshold-miss'))
        return 'cheaper-qualified-model';
    if (reasonCodes.includes('wall-clock-threshold-miss') || reasonCodes.includes('repair-residue-regression'))
        return 'collapse-roles';
    return 'none';
}
function digestCohort(value) {
    return `cohort-${sha256(JSON.stringify(value)).slice(0, 16)}`;
}
function usageTokens(value) {
    if (!value)
        return 0;
    return (value.inputTokens ?? 0)
        + (value.outputTokens ?? 0)
        + (value.cacheReadTokens ?? 0)
        + (value.reasoningTokens ?? 0);
}
function stableDigest(value) {
    return `sha256:${sha256(JSON.stringify(value))}`;
}
function sha256(value) {
    return createHash('sha256').update(value).digest('hex');
}
