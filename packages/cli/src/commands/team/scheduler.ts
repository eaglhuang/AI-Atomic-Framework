import { createHash } from 'node:crypto';
import { createTeamContextManifest, type TeamContextManifest } from '../../../../core/src/team-runtime/context-manifest.ts';
import { createTeamContributionManifest, createCleanContextReviewerReceipt, type TeamContributionManifest } from '../../../../core/src/team-runtime/contribution-manifest.ts';
import type { TeamProviderId } from '../../../../core/src/team-runtime/provider-contract.ts';

export type TeamWorkGroup = {
  readonly groupId: string;
  readonly role: string;
  readonly independent: boolean;
  readonly dependencies?: readonly string[];
  readonly allowedFiles: readonly string[];
  readonly capability: string;
};

export type TeamModelOption = {
  readonly providerId: TeamProviderId;
  readonly modelId: string;
  readonly plan: string;
  readonly capability: string;
  readonly costPerUnit: number;
};

export type TeamShadowSchedule = {
  readonly schemaId: 'atm.teamShadowSchedule.v1';
  readonly taskId: string;
  readonly shadowOnly: true;
  readonly baseCommit: string;
  readonly scopeEpoch: number;
  readonly catalogVersion: string;
  readonly fanOutCap: number;
  readonly spendingCeiling: number;
  readonly quotaProbeDigest: string;
  readonly reservations: readonly TeamReservation[];
  readonly rosterFingerprint: TeamRosterFingerprint;
  readonly dagStreamingReadyGroups: readonly string[];
  readonly reviewerLane: TeamReviewerLane | null;
};

export type TeamReservation = {
  readonly reservationId: string;
  readonly groupId: string;
  readonly roles: readonly string[];
  readonly dependencies: readonly string[];
  readonly collapsedExecutor: boolean;
  readonly contextManifest: TeamContextManifest;
  readonly provider: {
    readonly providerId: TeamProviderId;
    readonly modelId: string;
    readonly plan: string;
  };
  readonly sealedInputs: {
    readonly baseCommit: string;
    readonly scopeEpoch: number;
    readonly contextManifestDigest: string;
    readonly spendingCeiling: number;
  };
  readonly reversible: true;
};

export type TeamReviewerLane = {
  readonly enabled: true;
  readonly contextManifest: TeamContextManifest;
  readonly cleanContext: true;
  readonly barrierRequired: true;
};

export type TeamRosterFingerprint = {
  readonly schemaId: 'atm.teamRosterFingerprint.v1';
  readonly roleGraph: readonly string[];
  readonly executorCollapseDecision: 'single-agent' | 'team-expanded' | 'team-collapsed';
  readonly providerModelPlan: readonly string[];
  readonly pricingCatalogVersion: string;
  readonly contextManifestHashes: readonly string[];
  readonly promptCachePolicy: string;
  readonly fanOutCap: number;
  readonly quotaProbeDigest: string;
  readonly digest: string;
};

export function createTeamShadowSchedule(input: {
  readonly taskId: string;
  readonly baseCommit: string;
  readonly scopeEpoch: number;
  readonly workGroups: readonly TeamWorkGroup[];
  readonly modelOptions: readonly TeamModelOption[];
  readonly catalogVersion: string;
  readonly fanOutCap: number;
  readonly spendingCeiling: number;
  readonly quotaProbeDigest: string;
  readonly acceptanceCriteria: readonly string[];
  readonly promptCachePolicy?: 'stable-prefix-preferred' | 'cache-disabled';
  readonly cleanContextReviewer?: boolean;
}): TeamShadowSchedule {
  const collapsedGroups = collapseNonIndependentGroups(input.workGroups);
  const reservations = collapsedGroups.map((group) => createReservation(input, group));
  const reviewerLane = input.cleanContextReviewer
    ? createReviewerLane(input)
    : null;
  const rosterFingerprint = createRosterFingerprint({
    catalogVersion: input.catalogVersion,
    fanOutCap: input.fanOutCap,
    promptCachePolicy: input.promptCachePolicy ?? 'stable-prefix-preferred',
    quotaProbeDigest: input.quotaProbeDigest,
    reservations,
    reviewerLane,
    collapsed: collapsedGroups.some((group) => group.roles.length > 1)
  });
  return {
    schemaId: 'atm.teamShadowSchedule.v1',
    taskId: input.taskId,
    shadowOnly: true,
    baseCommit: input.baseCommit,
    scopeEpoch: input.scopeEpoch,
    catalogVersion: input.catalogVersion,
    fanOutCap: input.fanOutCap,
    spendingCeiling: input.spendingCeiling,
    quotaProbeDigest: input.quotaProbeDigest,
    reservations,
    rosterFingerprint,
    dagStreamingReadyGroups: reservations
      .filter((reservation) => reservation.dependencies.length === 0)
      .map((reservation) => reservation.groupId),
    reviewerLane
  };
}

export function createShadowContribution(input: {
  readonly taskId: string;
  readonly reservation: TeamReservation;
  readonly overlay: unknown;
  readonly changedFiles: readonly string[];
  readonly reviewerLane?: TeamReviewerLane | null;
}): TeamContributionManifest {
  const contribution = createTeamContributionManifest({
    taskId: input.taskId,
    role: input.reservation.roles.join('+'),
    workerId: input.reservation.reservationId,
    baseCommit: input.reservation.sealedInputs.baseCommit,
    contextManifestDigest: input.reservation.contextManifest.digest,
    overlay: input.overlay,
    changedFiles: input.changedFiles
  });
  if (!input.reviewerLane) return contribution;
  const reviewerReceipt = createCleanContextReviewerReceipt({
    reviewerRole: 'clean-context-reviewer',
    contributionDigest: contribution.overlayDigest,
    reviewerContextDigest: input.reviewerLane.contextManifest.digest
  });
  return { ...contribution, reviewerReceipt };
}

function collapseNonIndependentGroups(groups: readonly TeamWorkGroup[]): Array<TeamWorkGroup & { roles: readonly string[] }> {
  const independent = groups.filter((group) => group.independent).map((group) => ({ ...group, roles: [group.role] }));
  const collapsed = groups.filter((group) => !group.independent);
  if (collapsed.length === 0) return independent;
  return [
    ...independent,
    {
      groupId: collapsed.map((group) => group.groupId).join('+'),
      role: collapsed.map((group) => group.role).join('+'),
      roles: collapsed.map((group) => group.role),
      independent: false,
      dependencies: [...new Set(collapsed.flatMap((group) => group.dependencies ?? []))],
      allowedFiles: [...new Set(collapsed.flatMap((group) => group.allowedFiles))],
      capability: collapsed.map((group) => group.capability).sort().join('+')
    }
  ];
}

function createReservation(input: Parameters<typeof createTeamShadowSchedule>[0], group: TeamWorkGroup & { roles: readonly string[] }): TeamReservation {
  const model = chooseCheapestModel(input.modelOptions, group.capability);
  const contextManifest = createTeamContextManifest({
    taskId: input.taskId,
    role: group.roles.join('+'),
    baseCommit: input.baseCommit,
    scopeEpoch: input.scopeEpoch,
    allowedFiles: group.allowedFiles,
    acceptanceCriteria: input.acceptanceCriteria,
    requiredDependencies: group.dependencies ?? [],
    promptCachePolicy: input.promptCachePolicy ?? 'stable-prefix-preferred',
    stablePromptPrefix: `${input.taskId}:${group.capability}`
  });
  return {
    reservationId: `res-${sha256(`${group.groupId}:${contextManifest.digest}`).slice(0, 12)}`,
    groupId: group.groupId,
    roles: group.roles,
    dependencies: [...(group.dependencies ?? [])].sort(),
    collapsedExecutor: group.roles.length > 1,
    contextManifest,
    provider: {
      providerId: model.providerId,
      modelId: model.modelId,
      plan: model.plan
    },
    sealedInputs: {
      baseCommit: input.baseCommit,
      scopeEpoch: input.scopeEpoch,
      contextManifestDigest: contextManifest.digest,
      spendingCeiling: input.spendingCeiling
    },
    reversible: true
  };
}

function createReviewerLane(input: Parameters<typeof createTeamShadowSchedule>[0]): TeamReviewerLane {
  return {
    enabled: true,
    cleanContext: true,
    barrierRequired: true,
    contextManifest: createTeamContextManifest({
      taskId: input.taskId,
      role: 'clean-context-reviewer',
      baseCommit: input.baseCommit,
      scopeEpoch: input.scopeEpoch,
      allowedFiles: [],
      acceptanceCriteria: input.acceptanceCriteria,
      requiredDependencies: ['base', 'contribution-manifest', 'diff'],
      promptCachePolicy: input.promptCachePolicy ?? 'stable-prefix-preferred',
      stablePromptPrefix: `${input.taskId}:clean-reviewer`
    })
  };
}

function chooseCheapestModel(options: readonly TeamModelOption[], capability: string): TeamModelOption {
  const qualified = options.filter((option) => option.capability === capability || capability.includes(option.capability));
  const candidates = qualified.length ? qualified : options;
  const selected = [...candidates].sort((left, right) => left.costPerUnit - right.costPerUnit)[0];
  if (!selected) throw new Error(`No model option available for capability ${capability}.`);
  return selected;
}

function createRosterFingerprint(input: {
  readonly catalogVersion: string;
  readonly fanOutCap: number;
  readonly promptCachePolicy: string;
  readonly quotaProbeDigest: string;
  readonly reservations: readonly TeamReservation[];
  readonly reviewerLane: TeamReviewerLane | null;
  readonly collapsed: boolean;
}): TeamRosterFingerprint {
  const executorCollapseDecision: TeamRosterFingerprint['executorCollapseDecision'] = input.reservations.length === 1
    ? 'single-agent'
    : input.collapsed
      ? 'team-collapsed'
      : 'team-expanded';
  const body = {
    roleGraph: [
      ...input.reservations.map((reservation) => reservation.roles.join('+')),
      ...(input.reviewerLane ? ['clean-context-reviewer'] : [])
    ],
    executorCollapseDecision,
    providerModelPlan: input.reservations.map((reservation) => `${reservation.provider.providerId}:${reservation.provider.modelId}:${reservation.provider.plan}`),
    pricingCatalogVersion: input.catalogVersion,
    contextManifestHashes: [
      ...input.reservations.map((reservation) => reservation.contextManifest.digest),
      ...(input.reviewerLane ? [input.reviewerLane.contextManifest.digest] : [])
    ],
    promptCachePolicy: input.promptCachePolicy,
    fanOutCap: input.fanOutCap,
    quotaProbeDigest: input.quotaProbeDigest
  };
  return {
    schemaId: 'atm.teamRosterFingerprint.v1',
    ...body,
    digest: `sha256:${sha256(JSON.stringify(body))}`
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
