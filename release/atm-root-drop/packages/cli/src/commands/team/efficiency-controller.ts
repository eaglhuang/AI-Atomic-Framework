import { createHash } from 'node:crypto';

export type TeamEfficiencyRouting = 'promote-production' | 'prefer-team' | 'bounded-experiment' | 'scale-down' | 'single-agent';

export type TeamEfficiencyScaleDownAction =
  | 'none'
  | 'collapse-roles'
  | 'cheaper-qualified-model'
  | 'shrink-team-size'
  | 'disable-team-for-workload';

export type TeamEfficiencyRatios = {
  readonly fullyLoadedCostRatio: number | null;
  readonly wallClockRatio: number | null;
  readonly tokenRatio: number | null;
  readonly repairResidueRatio: number | null;
};

export type TeamEfficiencyTelemetry = {
  readonly contextInflation: boolean;
  readonly cacheMiss: boolean;
  readonly retries: number;
  readonly quotaOk: boolean;
  readonly queueWaitInflationRatio: number | null;
  readonly spendingCeilingRisk: boolean;
};

export type TeamEfficiencyControllerDecision = {
  readonly schemaId: 'atm.teamEfficiencyControllerDecision.v1';
  readonly routing: TeamEfficiencyRouting;
  readonly promotionEligible: boolean;
  readonly preferredRouting: boolean;
  readonly breakthroughTarget: boolean;
  readonly boundedExperiment: boolean;
  readonly cohortKey: string;
  readonly scaleDownAction: TeamEfficiencyScaleDownAction;
  readonly reasonCodes: readonly string[];
  readonly bottleneckCause: string | null;
  readonly optimizationBacklogTarget: string | null;
  readonly tokenDiagnosticReasonCodes: readonly string[];
};

export function evaluateTeamEfficiency(input: {
  readonly workloadClass: string | null;
  readonly rosterFingerprintDigest: string;
  readonly modelMixDigest: string;
  readonly contextManifestDigest: string;
  readonly promptCachePolicy: string;
  readonly fanOutCap: number;
  readonly quotaProbeDigest: string;
  readonly pricingCatalogVersion: string;
  readonly priceEvidenceFresh: boolean;
  readonly usageEvidenceComplete: boolean;
  readonly qualityParity: boolean;
  readonly noWorseRepairResidue: boolean;
  readonly stopLossTriggered: boolean;
  readonly ratios: TeamEfficiencyRatios;
  readonly telemetry: TeamEfficiencyTelemetry;
}): TeamEfficiencyControllerDecision {
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
  const routing: TeamEfficiencyRouting = scaleDownAction !== 'none'
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

export function createTeamEfficiencyIncident(input: {
  readonly sampleId: string;
  readonly decision: TeamEfficiencyControllerDecision;
  readonly ratios: TeamEfficiencyRatios;
  readonly generatedAt?: string;
}) {
  return {
    schemaId: 'atm.teamEfficiencyIncident.v1' as const,
    specVersion: '0.1.0',
    migration: { strategy: 'additive', fromVersion: null, notes: 'ATM-GOV-0140 efficiency controller incident' },
    incidentId: `team-eff-${sha256(`${input.sampleId}:${input.decision.cohortKey}:${input.decision.routing}`).slice(0, 12)}`,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    severity: input.decision.promotionEligible ? 'advisory' as const : 'blocking' as const,
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

function efficiencyReasonCodes(input: Parameters<typeof evaluateTeamEfficiency>[0]): string[] {
  const reasons: string[] = [];
  if (!input.workloadClass) reasons.push('unknown-workload-class');
  if (!input.priceEvidenceFresh) reasons.push('missing-or-stale-price-evidence');
  if (!input.usageEvidenceComplete) reasons.push('missing-provider-usage-evidence');
  if (input.stopLossTriggered) reasons.push('stop-loss-triggered');
  if (!input.telemetry.quotaOk) reasons.push('quota-or-rate-limit-failure');
  if (input.telemetry.queueWaitInflationRatio !== null && input.telemetry.queueWaitInflationRatio > 1.25) reasons.push('queue-wait-inflation');
  if (input.telemetry.spendingCeilingRisk) reasons.push('spending-ceiling-risk');
  if (input.ratios.fullyLoadedCostRatio === null || input.ratios.fullyLoadedCostRatio > 0.80) reasons.push('fully-loaded-cost-threshold-miss');
  if (input.ratios.wallClockRatio === null || input.ratios.wallClockRatio > 0.75) reasons.push('wall-clock-threshold-miss');
  if (!input.qualityParity) reasons.push('quality-parity-miss');
  if (!input.noWorseRepairResidue) reasons.push('repair-residue-regression');
  return reasons;
}

function tokenReasonCodes(telemetry: TeamEfficiencyTelemetry): string[] {
  const reasons: string[] = [];
  if (telemetry.contextInflation) reasons.push('context-inflation');
  if (telemetry.cacheMiss) reasons.push('cache-miss');
  if (telemetry.retries > 0) reasons.push('retries');
  return reasons;
}

function chooseScaleDownAction(input: Parameters<typeof evaluateTeamEfficiency>[0], reasonCodes: readonly string[]): TeamEfficiencyScaleDownAction {
  if (input.stopLossTriggered || reasonCodes.includes('spending-ceiling-risk')) return 'disable-team-for-workload';
  if (reasonCodes.includes('quota-or-rate-limit-failure') || reasonCodes.includes('queue-wait-inflation')) return 'shrink-team-size';
  if (reasonCodes.includes('fully-loaded-cost-threshold-miss')) return 'cheaper-qualified-model';
  if (reasonCodes.includes('wall-clock-threshold-miss') || reasonCodes.includes('repair-residue-regression')) return 'collapse-roles';
  return 'none';
}

function digestCohort(value: unknown): string {
  return `cohort-${sha256(JSON.stringify(value)).slice(0, 16)}`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
