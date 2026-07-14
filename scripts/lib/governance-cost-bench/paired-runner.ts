import { createHash } from 'node:crypto';
import {
  calculateTeamCostReceipt,
  type FxSnapshot,
  type ModelPriceCatalog,
  type SeatAllocationPolicy,
  type TeamCostReceipt
} from '../../../packages/core/src/team-runtime/pricing/cost-accounting.ts';
import type { TeamProviderBillableUsage } from '../../../packages/core/src/team-runtime/provider-contract.ts';

export type WorkloadMetricKind = 'single-task-latency' | 'batch-makespan' | 'throughput';

export type TeamRosterFingerprint = {
  readonly schemaId: 'atm.teamRosterFingerprint.v1';
  readonly roleGraph: readonly string[];
  readonly executorCollapseDecision: 'single-agent' | 'team-expanded' | 'team-collapsed';
  readonly providerModelPlan: readonly string[];
  readonly pricingCatalogVersion: string;
  readonly contextManifestHash: string;
  readonly promptCachePolicy: string;
  readonly fanOutCap: number;
  readonly quotaProbeDigest: string;
};

export type GovernanceCostSampleInput = {
  readonly sampleId: string;
  readonly workloadClass: string;
  readonly base: BenchRunInput;
  readonly outcome: BenchRunInput;
  readonly rosterFingerprint?: TeamRosterFingerprint;
};

export type BenchRunInput = {
  readonly label: string;
  readonly usage: TeamProviderBillableUsage;
  readonly durationMs: number;
  readonly batchMakespanMs: number;
  readonly throughputPerMinute: number;
  readonly queueMs: number;
  readonly retries: number;
  readonly repairs: number;
  readonly discardedWorkCount: number;
  readonly validatorCount: number;
  readonly allocationPolicy?: SeatAllocationPolicy;
};

export type GovernanceCostBenchReport = {
  readonly schemaId: 'atm.governanceCostBenchReport.v1';
  readonly shadowOnly: true;
  readonly catalogVersion: string;
  readonly generatedAt: string;
  readonly samples: readonly GovernanceCostSampleReport[];
  readonly cohorts: readonly GovernanceCostCohortReport[];
  readonly workloadRollups: readonly GovernanceCostWorkloadRollup[];
};

export type GovernanceCostSampleReport = {
  readonly schemaId: 'atm.governanceCostBenchSample.v1';
  readonly sampleId: string;
  readonly workloadClass: string;
  readonly cohortKey: string;
  readonly rosterFingerprint: TeamRosterFingerprint | null;
  readonly baseCost: TeamCostReceipt;
  readonly outcomeCost: TeamCostReceipt;
  readonly ratios: GovernanceCostRatios;
  readonly metrics: {
    readonly singleTaskLatencyMs: MetricPair;
    readonly batchMakespanMs: MetricPair;
    readonly throughputPerMinute: MetricPair;
  };
  readonly queue: MetricPair;
  readonly retries: MetricPair;
  readonly repairs: MetricPair;
  readonly discardedWork: MetricPair;
  readonly tokenDiagnostics: {
    readonly baseInputTokens: number;
    readonly outcomeInputTokens: number;
    readonly baseOutputTokens: number;
    readonly outcomeOutputTokens: number;
    readonly baseCacheReadTokens: number;
    readonly outcomeCacheReadTokens: number;
  };
  readonly promotionEligible: boolean;
  readonly ineligibleReasons: readonly string[];
};

export type GovernanceCostRatios = {
  readonly incrementalCashCostRatio: number;
  readonly fullyLoadedCashCostRatio: number;
  readonly listPriceEquivalentCostRatio: number;
  readonly singleTaskLatencyRatio: number;
  readonly batchMakespanRatio: number;
  readonly throughputRatio: number;
};

export type MetricPair = {
  readonly base: number;
  readonly outcome: number;
};

export type GovernanceCostCohortReport = {
  readonly cohortKey: string;
  readonly sampleIds: readonly string[];
  readonly rosterFingerprint: TeamRosterFingerprint | null;
};

export type GovernanceCostWorkloadRollup = {
  readonly workloadClass: string;
  readonly cohorts: readonly string[];
  readonly sampleIds: readonly string[];
};

export function runGovernanceCostBench(input: {
  readonly catalog: ModelPriceCatalog;
  readonly samples: readonly GovernanceCostSampleInput[];
  readonly fxSnapshot?: FxSnapshot;
  readonly generatedAt?: string;
}): GovernanceCostBenchReport {
  const reports = input.samples.map((sample) => buildSampleReport(input.catalog, sample, input.fxSnapshot));
  return {
    schemaId: 'atm.governanceCostBenchReport.v1',
    shadowOnly: true,
    catalogVersion: input.catalog.catalogVersion,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    samples: reports,
    cohorts: buildCohorts(reports),
    workloadRollups: buildRollups(reports)
  };
}

function buildSampleReport(catalog: ModelPriceCatalog, sample: GovernanceCostSampleInput, fxSnapshot?: FxSnapshot): GovernanceCostSampleReport {
  const baseCost = calculateTeamCostReceipt({ catalog, usage: sample.base.usage, fxSnapshot, seatAllocationPolicy: sample.base.allocationPolicy });
  const outcomeCost = calculateTeamCostReceipt({ catalog, usage: sample.outcome.usage, fxSnapshot, seatAllocationPolicy: sample.outcome.allocationPolicy });
  const cohortKey = sample.rosterFingerprint ? fingerprint(sample.rosterFingerprint) : `single:${sample.workloadClass}`;
  const ratios = {
    incrementalCashCostRatio: ratio(outcomeCost.incrementalCashCost, baseCost.incrementalCashCost),
    fullyLoadedCashCostRatio: ratio(outcomeCost.fullyLoadedCashCost, baseCost.fullyLoadedCashCost),
    listPriceEquivalentCostRatio: ratio(outcomeCost.listPriceEquivalentCost, baseCost.listPriceEquivalentCost),
    singleTaskLatencyRatio: ratio(sample.outcome.durationMs, sample.base.durationMs),
    batchMakespanRatio: ratio(sample.outcome.batchMakespanMs, sample.base.batchMakespanMs),
    throughputRatio: ratio(sample.base.throughputPerMinute, sample.outcome.throughputPerMinute)
  };
  const ineligibleReasons = [
    ...baseCost.incompleteReasons.map((reason) => `base:${reason}`),
    ...outcomeCost.incompleteReasons.map((reason) => `outcome:${reason}`)
  ];
  return {
    schemaId: 'atm.governanceCostBenchSample.v1',
    sampleId: sample.sampleId,
    workloadClass: sample.workloadClass,
    cohortKey,
    rosterFingerprint: sample.rosterFingerprint ?? null,
    baseCost,
    outcomeCost,
    ratios,
    metrics: {
      singleTaskLatencyMs: { base: sample.base.durationMs, outcome: sample.outcome.durationMs },
      batchMakespanMs: { base: sample.base.batchMakespanMs, outcome: sample.outcome.batchMakespanMs },
      throughputPerMinute: { base: sample.base.throughputPerMinute, outcome: sample.outcome.throughputPerMinute }
    },
    queue: { base: sample.base.queueMs, outcome: sample.outcome.queueMs },
    retries: { base: sample.base.retries, outcome: sample.outcome.retries },
    repairs: { base: sample.base.repairs, outcome: sample.outcome.repairs },
    discardedWork: { base: sample.base.discardedWorkCount, outcome: sample.outcome.discardedWorkCount },
    tokenDiagnostics: {
      baseInputTokens: sample.base.usage.inputTokens ?? 0,
      outcomeInputTokens: sample.outcome.usage.inputTokens ?? 0,
      baseOutputTokens: sample.base.usage.outputTokens ?? 0,
      outcomeOutputTokens: sample.outcome.usage.outputTokens ?? 0,
      baseCacheReadTokens: sample.base.usage.cacheReadTokens ?? 0,
      outcomeCacheReadTokens: sample.outcome.usage.cacheReadTokens ?? 0
    },
    promotionEligible: ineligibleReasons.length === 0,
    ineligibleReasons
  };
}

function buildCohorts(samples: readonly GovernanceCostSampleReport[]): GovernanceCostCohortReport[] {
  const byKey = new Map<string, GovernanceCostSampleReport[]>();
  for (const sample of samples) byKey.set(sample.cohortKey, [...(byKey.get(sample.cohortKey) ?? []), sample]);
  return [...byKey.entries()].map(([cohortKey, entries]) => ({
    cohortKey,
    sampleIds: entries.map((entry) => entry.sampleId),
    rosterFingerprint: entries[0]?.rosterFingerprint ?? null
  }));
}

function buildRollups(samples: readonly GovernanceCostSampleReport[]): GovernanceCostWorkloadRollup[] {
  const byWorkload = new Map<string, GovernanceCostSampleReport[]>();
  for (const sample of samples) byWorkload.set(sample.workloadClass, [...(byWorkload.get(sample.workloadClass) ?? []), sample]);
  return [...byWorkload.entries()].map(([workloadClass, entries]) => ({
    workloadClass,
    cohorts: [...new Set(entries.map((entry) => entry.cohortKey))],
    sampleIds: entries.map((entry) => entry.sampleId)
  }));
}

function fingerprint(value: TeamRosterFingerprint): string {
  return `roster:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function ratio(outcome: number, base: number): number {
  if (base === 0) return outcome === 0 ? 1 : Number.POSITIVE_INFINITY;
  return Number((outcome / base).toFixed(6));
}
