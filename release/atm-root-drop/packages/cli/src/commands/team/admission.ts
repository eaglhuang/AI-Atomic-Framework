import { createHash } from 'node:crypto';
import type { TeamProviderId } from '../../../../core/src/team-runtime/provider-contract.ts';

export type TeamAdmissionDecision = 'open-team' | 'downgrade' | 'single-agent';

export type TeamAdmissionWorkGroup = {
  readonly groupId: string;
  readonly files: readonly string[];
  readonly capability: string;
  readonly mutuallyExclusive: boolean;
};

export type TeamAdmissionModelOption = {
  readonly providerId: TeamProviderId;
  readonly modelId: string;
  readonly plan: string;
  readonly capability: string;
  readonly dataPolicy: 'public-ok' | 'private-ok';
  readonly risk: 'low' | 'medium' | 'high';
  readonly costPerUnit: number;
};

export type TeamAdmissionProjection = {
  readonly schemaId: 'atm.teamAdmissionProjection.v1';
  readonly decision: TeamAdmissionDecision;
  readonly reason: string;
  readonly workerCount: number;
  readonly selectedModels: readonly {
    readonly groupId: string;
    readonly providerId: TeamProviderId;
    readonly modelId: string;
    readonly plan: string;
  }[];
  readonly fanOutCap: number;
  readonly quotaProbe: {
    readonly ok: boolean;
    readonly digest: string | null;
    readonly estimatedQueueWaitSeconds: number;
  };
  readonly spending: {
    readonly perWorkerCeiling: number;
    readonly totalCeiling: number;
    readonly stopLossThreshold: number;
  };
  readonly downgradeRoute: 'single-agent' | 'smaller-team' | 'cheaper-model-mix';
  readonly projected: {
    readonly fullyLoadedCostRatio: number | null;
    readonly timeRatio: number | null;
    readonly tokenRatio: number | null;
    readonly qualityParity: boolean;
    readonly noWorseRepairResidue: boolean;
  };
  readonly promotionEligible: boolean;
  readonly boundedExperiment: boolean;
  readonly optimizationReason: string;
  readonly nextExperimentTarget: string | null;
};

export function projectTeamAdmission(input: {
  readonly workloadClass: string | null;
  readonly productionDefault: boolean;
  readonly workGroups: readonly TeamAdmissionWorkGroup[];
  readonly sharedBottleneckFiles: readonly string[];
  readonly modelOptions: readonly TeamAdmissionModelOption[];
  readonly fanOutCap: number | null;
  readonly quotaProbeDigest: string | null;
  readonly quotaOk: boolean;
  readonly estimatedQueueWaitSeconds: number;
  readonly perWorkerSpendingCeiling: number;
  readonly totalSpendingCeiling: number;
  readonly stopLossThreshold: number;
  readonly pricingCatalogFresh: boolean;
  readonly subscriptionAllocationComplete: boolean;
  readonly providerUsageComplete: boolean;
  readonly teamRosterFingerprintDigest: string | null;
  readonly fullyLoadedCostRatio: number | null;
  readonly timeRatio: number | null;
  readonly tokenRatio: number | null;
  readonly qualityParity: boolean;
  readonly noWorseRepairResidue: boolean;
}): TeamAdmissionProjection {
  const collapsedGroups = collapseAdmissionGroups(input.workGroups);
  const deterministicInputsReady = Boolean(
    input.fanOutCap
    && input.fanOutCap > 0
    && input.quotaProbeDigest
    && input.teamRosterFingerprintDigest
    && input.pricingCatalogFresh
  );
  const costInputsComplete = input.providerUsageComplete && input.subscriptionAllocationComplete;
  const mutuallyExclusiveGroups = collapsedGroups.filter((group) => group.mutuallyExclusive);
  const hasEnoughParallelGroups = mutuallyExclusiveGroups.length >= 2;
  const sharedBottleneckFiles = [...new Set(input.sharedBottleneckFiles.map(normalizePath).filter(Boolean))];
  const boundedExperiment = !input.workloadClass;
  const selectedModels = mutuallyExclusiveGroups.flatMap((group) => {
    const model = chooseCheapestQualifiedModel(input.modelOptions, group.capability);
    return model
      ? [{
        groupId: group.groupId,
        providerId: model.providerId,
        modelId: model.modelId,
        plan: model.plan
      }]
      : [];
  });
  const thresholdOk = input.productionDefault
    ? (input.fullyLoadedCostRatio !== null && input.fullyLoadedCostRatio <= 0.80
      && input.timeRatio !== null && input.timeRatio <= 0.75
      && input.qualityParity
      && input.noWorseRepairResidue)
    : true;
  const promotionEligible = deterministicInputsReady
    && costInputsComplete
    && input.quotaOk
    && hasEnoughParallelGroups
    && sharedBottleneckFiles.length === 0
    && selectedModels.length === mutuallyExclusiveGroups.length
    && !boundedExperiment
    && thresholdOk;

  const blocker = firstAdmissionBlocker({
    deterministicInputsReady,
    costInputsComplete,
    quotaOk: input.quotaOk,
    hasEnoughParallelGroups,
    sharedBottleneckFiles,
    selectedModelCount: selectedModels.length,
    expectedModelCount: mutuallyExclusiveGroups.length,
    thresholdOk,
    boundedExperiment
  });
  const decision: TeamAdmissionDecision = !blocker
    ? 'open-team'
    : shouldShrinkInsteadOfSingleAgent(blocker) ? 'downgrade' : 'single-agent';
  const optimizationReason = blocker ?? 'Projected Team execution beats cost/time thresholds with quality parity.';
  return {
    schemaId: 'atm.teamAdmissionProjection.v1',
    decision,
    reason: optimizationReason,
    workerCount: decision === 'open-team' ? Math.min(mutuallyExclusiveGroups.length, input.fanOutCap ?? 0) : 1,
    selectedModels,
    fanOutCap: input.fanOutCap ?? 0,
    quotaProbe: {
      ok: input.quotaOk,
      digest: input.quotaProbeDigest,
      estimatedQueueWaitSeconds: input.estimatedQueueWaitSeconds
    },
    spending: {
      perWorkerCeiling: input.perWorkerSpendingCeiling,
      totalCeiling: input.totalSpendingCeiling,
      stopLossThreshold: input.stopLossThreshold
    },
    downgradeRoute: decision === 'downgrade' ? 'cheaper-model-mix' : 'single-agent',
    projected: {
      fullyLoadedCostRatio: input.fullyLoadedCostRatio,
      timeRatio: input.timeRatio,
      tokenRatio: input.tokenRatio,
      qualityParity: input.qualityParity,
      noWorseRepairResidue: input.noWorseRepairResidue
    },
    promotionEligible,
    boundedExperiment,
    optimizationReason,
    nextExperimentTarget: decision === 'open-team' ? null : nextExperimentTargetFor(blocker)
  };
}

function collapseAdmissionGroups(groups: readonly TeamAdmissionWorkGroup[]): TeamAdmissionWorkGroup[] {
  const byFiles = new Map<string, TeamAdmissionWorkGroup>();
  for (const group of groups) {
    const filesKey = group.files.map(normalizePath).sort().join('|');
    const key = group.mutuallyExclusive ? `${group.capability}:${filesKey}` : `collapsed:${filesKey || group.groupId}`;
    const previous = byFiles.get(key);
    byFiles.set(key, previous
      ? {
        groupId: `${previous.groupId}+${group.groupId}`,
        files: [...new Set([...previous.files, ...group.files].map(normalizePath))].sort(),
        capability: previous.capability === group.capability ? previous.capability : `${previous.capability}+${group.capability}`,
        mutuallyExclusive: previous.mutuallyExclusive && group.mutuallyExclusive
      }
      : { ...group, files: group.files.map(normalizePath).sort() });
  }
  return [...byFiles.values()];
}

function chooseCheapestQualifiedModel(options: readonly TeamAdmissionModelOption[], capability: string): TeamAdmissionModelOption | null {
  return [...options]
    .filter((option) => capability.includes(option.capability) || option.capability === capability)
    .filter((option) => option.dataPolicy === 'private-ok')
    .filter((option) => option.risk !== 'high')
    .sort((left, right) => left.costPerUnit - right.costPerUnit)[0] ?? null;
}

function firstAdmissionBlocker(input: {
  readonly deterministicInputsReady: boolean;
  readonly costInputsComplete: boolean;
  readonly quotaOk: boolean;
  readonly hasEnoughParallelGroups: boolean;
  readonly sharedBottleneckFiles: readonly string[];
  readonly selectedModelCount: number;
  readonly expectedModelCount: number;
  readonly thresholdOk: boolean;
  readonly boundedExperiment: boolean;
}): string | null {
  if (!input.hasEnoughParallelGroups) return 'Team requires at least two mutually exclusive file groups.';
  if (input.sharedBottleneckFiles.length > 0) return `Shared bottleneck blocks the critical path: ${input.sharedBottleneckFiles.join(', ')}.`;
  if (!input.deterministicInputsReady) return 'Fan-out cap, quota probe, pricing catalog or TeamRosterFingerprint is not deterministic.';
  if (!input.costInputsComplete) return 'Provider usage or subscription allocation is incomplete, so promotion is ineligible.';
  if (!input.quotaOk) return 'Provider quota probe failed.';
  if (input.selectedModelCount !== input.expectedModelCount) return 'No cheapest capability-qualified provider/model could be selected under policy constraints.';
  if (input.boundedExperiment) return 'Unknown workload class is limited to a bounded experiment.';
  if (!input.thresholdOk) return 'Projected or actual Team cost/time/quality thresholds no longer hold.';
  return null;
}

function shouldShrinkInsteadOfSingleAgent(reason: string): boolean {
  return /threshold|quota|provider\/model|policy/i.test(reason);
}

function nextExperimentTargetFor(reason: string | null): string | null {
  if (!reason) return null;
  return `Reduce fan-out or model mix, then rerun projection: ${reason}`;
}

function normalizePath(filePath: string): string {
  return filePath.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

export function digestTeamAdmissionProjection(projection: TeamAdmissionProjection): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(projection)).digest('hex')}`;
}
