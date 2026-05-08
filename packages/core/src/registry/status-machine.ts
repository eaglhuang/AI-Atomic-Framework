import type { MapRegistryEntryRecord, RegistryEntryRecord, RegistryEntryStatus, RegistryGovernanceTier } from '../index';

export const registryEntryStatuses = ['draft', 'validated', 'active', 'transitioning', 'deprecated', 'expired', 'quarantined'] as const;

export const registryGovernanceTiers = ['constitutional', 'governed', 'standard', 'experimental'] as const;

export const registryTransitionActions = [
  'transition.propose',
  'transition.promote',
  'transition.quarantine',
  'behavior.split',
  'behavior.merge',
  'behavior.dedup-merge',
  'behavior.evolve',
  'behavior.sweep',
  'behavior.expire',
  'behavior.polymorphize',
  'behavior.compose',
  'behavior.infect',
  'behavior.atomize'
] as const;

export const registryMutabilityPolicies = ['mutable', 'frozen-after-release', 'immutable'] as const;

export const registryReviewDispositions = ['approve', 'non-fatal-reject', 'fatal-reject'] as const;

export type RegistryTransitionAction = typeof registryTransitionActions[number];

export type RegistryMutabilityPolicy = typeof registryMutabilityPolicies[number];

export type RegistryReviewDisposition = typeof registryReviewDispositions[number];

export interface RegistryTransitionRule {
  readonly entryTypes: readonly ('atom' | 'map')[];
  readonly fromStatuses: readonly RegistryEntryStatus[];
  readonly toStatus: RegistryEntryStatus;
  readonly secondaryStatuses?: readonly RegistryEntryStatus[];
  readonly minSourceCount?: number;
  readonly maxSourceCount?: number;
  readonly policeOnly?: boolean;
  readonly requiresZeroCallers?: boolean;
  readonly requiresTtlExpired?: boolean;
  readonly allowedMutabilityPolicies?: readonly RegistryMutabilityPolicy[];
}

export const registryTransitionRules: Readonly<Record<RegistryTransitionAction, RegistryTransitionRule>> = {
  'transition.propose': {
    entryTypes: ['atom', 'map'],
    fromStatuses: ['draft'],
    toStatus: 'validated',
    allowedMutabilityPolicies: ['mutable']
  },
  'transition.promote': {
    entryTypes: ['atom', 'map'],
    fromStatuses: ['validated'],
    toStatus: 'active',
    allowedMutabilityPolicies: ['mutable']
  },
  'transition.quarantine': {
    entryTypes: ['atom', 'map'],
    fromStatuses: ['draft', 'validated', 'active', 'transitioning', 'deprecated', 'expired'],
    toStatus: 'quarantined',
    policeOnly: true,
    allowedMutabilityPolicies: ['mutable', 'frozen-after-release', 'immutable']
  },
  'behavior.split': {
    entryTypes: ['atom'],
    fromStatuses: ['active'],
    toStatus: 'active',
    allowedMutabilityPolicies: ['mutable']
  },
  'behavior.merge': {
    entryTypes: ['atom'],
    fromStatuses: ['active'],
    toStatus: 'active',
    secondaryStatuses: ['deprecated'],
    minSourceCount: 2,
    allowedMutabilityPolicies: ['mutable']
  },
  'behavior.dedup-merge': {
    entryTypes: ['atom'],
    fromStatuses: ['active'],
    toStatus: 'active',
    secondaryStatuses: ['deprecated'],
    minSourceCount: 2,
    maxSourceCount: 2,
    allowedMutabilityPolicies: ['mutable']
  },
  'behavior.evolve': {
    entryTypes: ['atom'],
    fromStatuses: ['active'],
    toStatus: 'active',
    allowedMutabilityPolicies: ['mutable', 'frozen-after-release']
  },
  'behavior.sweep': {
    entryTypes: ['atom', 'map'],
    fromStatuses: ['active'],
    toStatus: 'deprecated',
    requiresZeroCallers: true,
    allowedMutabilityPolicies: ['mutable', 'immutable']
  },
  'behavior.expire': {
    entryTypes: ['atom', 'map'],
    fromStatuses: ['deprecated'],
    toStatus: 'expired',
    requiresTtlExpired: true,
    allowedMutabilityPolicies: ['mutable', 'immutable']
  },
  'behavior.polymorphize': {
    entryTypes: ['atom'],
    fromStatuses: ['active'],
    toStatus: 'active',
    secondaryStatuses: ['validated'],
    allowedMutabilityPolicies: ['mutable']
  },
  'behavior.compose': {
    entryTypes: ['map'],
    fromStatuses: ['active'],
    toStatus: 'active',
    minSourceCount: 2,
    allowedMutabilityPolicies: ['mutable']
  },
  'behavior.infect': {
    entryTypes: ['atom'],
    fromStatuses: ['active'],
    toStatus: 'active',
    allowedMutabilityPolicies: ['mutable']
  },
  'behavior.atomize': {
    entryTypes: ['atom'],
    fromStatuses: ['draft'],
    toStatus: 'active',
    secondaryStatuses: ['validated'],
    allowedMutabilityPolicies: ['mutable']
  }
};

export interface RegistryTransitionContext {
  readonly entryType: 'atom' | 'map';
  readonly atomId?: string;
  readonly mapId?: string;
  readonly status: RegistryEntryStatus;
  readonly action: RegistryTransitionAction;
  readonly governanceTier?: RegistryGovernanceTier | string | null;
  readonly sourceStatuses?: readonly RegistryEntryStatus[];
  readonly mutabilityPolicy?: RegistryMutabilityPolicy | string | null;
  readonly callerCount?: number;
  readonly ttlExpired?: boolean;
  readonly policeAction?: boolean;
  readonly stageStatuses?: readonly RegistryEntryStatus[];
}

export interface RegistryTransitionEvaluation {
  readonly ok: boolean;
  readonly entryLabel: string;
  readonly entryType: 'atom' | 'map';
  readonly action: RegistryTransitionAction;
  readonly fromStatuses: readonly RegistryEntryStatus[];
  readonly toStatus: RegistryEntryStatus | null;
  readonly secondaryStatuses: readonly RegistryEntryStatus[];
  readonly governanceTier: RegistryGovernanceTier;
  readonly issues: readonly string[];
  readonly policeAction: boolean;
  readonly pendingQuarantineRequest: boolean;
}

export interface RegistryReviewDispositionContext {
  readonly entryType: 'atom' | 'map';
  readonly atomId?: string;
  readonly mapId?: string;
  readonly status: RegistryEntryStatus;
  readonly governanceTier?: RegistryGovernanceTier | string | null;
  readonly reviewDisposition: RegistryReviewDisposition;
  readonly policeAction?: boolean;
}

export interface RegistryReviewDispositionEvaluation {
  readonly ok: boolean;
  readonly entryLabel: string;
  readonly entryType: 'atom' | 'map';
  readonly reviewDisposition: RegistryReviewDisposition;
  readonly fromStatus: RegistryEntryStatus;
  readonly toStatus: RegistryEntryStatus;
  readonly governanceTier: RegistryGovernanceTier;
  readonly pendingQuarantineRequest: boolean;
  readonly issues: readonly string[];
}

export function isRegistryEntryStatus(value: unknown): value is RegistryEntryStatus {
  return registryEntryStatuses.includes(String(value) as RegistryEntryStatus);
}

export function isRegistryGovernanceTier(value: unknown): value is RegistryGovernanceTier {
  return registryGovernanceTiers.includes(String(value) as RegistryGovernanceTier);
}

export function normalizeRegistryEntryStatus(value: unknown): RegistryEntryStatus {
  const text = String(value ?? '').trim();
  if (isRegistryEntryStatus(text)) {
    return text;
  }
  throw new Error(`Unsupported registry status: ${text || '<empty>'}`);
}

export function normalizeRegistryGovernanceTier(value: unknown): RegistryGovernanceTier {
  const text = String(value ?? '').trim();
  if (isRegistryGovernanceTier(text)) {
    return text;
  }
  throw new Error(`Unsupported registry governance tier: ${text || '<empty>'}`);
}

export function resolveRegistryDefaultGovernanceTier(status: RegistryEntryStatus, entryType: 'atom' | 'map'): RegistryGovernanceTier {
  if (status === 'quarantined') {
    return 'governed';
  }
  return 'standard';
}

export function resolveRegistryEntryLabel(entry: {
  readonly atomId?: string;
  readonly mapId?: string;
}): string {
  if (typeof entry.mapId === 'string' && entry.mapId.trim().length > 0) {
    return entry.mapId.trim();
  }
  if (typeof entry.atomId === 'string' && entry.atomId.trim().length > 0) {
    return entry.atomId.trim();
  }
  return '';
}

export function evaluateRegistryTransition(input: RegistryTransitionContext): RegistryTransitionEvaluation {
  const entryLabel = resolveRegistryEntryLabel(input);
  const governanceTier = normalizeRegistryGovernanceTier(
    input.governanceTier ?? resolveRegistryDefaultGovernanceTier(input.status, input.entryType)
  );
  const rule = registryTransitionRules[input.action];
  const sourceStatuses = normalizeSourceStatuses(input);
  const mutabilityPolicy = normalizeMutabilityPolicy(input.mutabilityPolicy);
  const issues: string[] = [];
  let toStatus: RegistryEntryStatus | null = rule?.toStatus ?? null;
  let secondaryStatuses: readonly RegistryEntryStatus[] = rule?.secondaryStatuses ?? [];
  let pendingQuarantineRequest = false;

  if (!rule) {
    issues.push('unknown-action');
    return buildTransitionEvaluation(entryLabel, input.entryType, input.action, sourceStatuses, toStatus, secondaryStatuses, governanceTier, issues, input.policeAction === true, pendingQuarantineRequest);
  }

  if (!rule.entryTypes.includes(input.entryType)) {
    issues.push('entry-type-not-supported');
  }

  if (!sourceStatuses.every((status) => rule.fromStatuses.includes(status))) {
    issues.push('source-status-not-allowed');
  }

  if (typeof rule.minSourceCount === 'number' && sourceStatuses.length < rule.minSourceCount) {
    issues.push('insufficient-source-count');
  }

  if (typeof rule.maxSourceCount === 'number' && sourceStatuses.length > rule.maxSourceCount) {
    issues.push('excess-source-count');
  }

  if (rule.allowedMutabilityPolicies && !rule.allowedMutabilityPolicies.includes(mutabilityPolicy)) {
    issues.push('mutability-policy-not-allowed');
  }

  if (rule.requiresZeroCallers === true && Number(input.callerCount ?? 0) > 0) {
    issues.push('caller-count-not-zero');
  }

  if (rule.requiresTtlExpired === true && input.ttlExpired !== true) {
    issues.push('ttl-not-expired');
  }

  if (input.status === 'quarantined' && input.action !== 'transition.quarantine') {
    issues.push('quarantined-entry-is-read-only');
  }

  if (input.ttlExpired === true && input.status === 'active' && !['behavior.sweep', 'behavior.expire', 'transition.quarantine'].includes(input.action)) {
    issues.push('ttl-expired-active-must-fail');
  }

  if (input.action === 'behavior.atomize') {
    const stageStatuses = normalizeStageStatuses(input);
    if (stageStatuses.length !== 3 || stageStatuses.join(',') !== 'draft,validated,active') {
      issues.push('atomize-pipeline-must-progress-draft-validated-active');
    }
  }

  if (input.action === 'transition.quarantine' && input.policeAction !== true) {
    issues.push('quarantine-requires-police-action');
  }

  if (input.action === 'transition.quarantine') {
    pendingQuarantineRequest = false;
  }

  return buildTransitionEvaluation(entryLabel, input.entryType, input.action, sourceStatuses, toStatus, secondaryStatuses, governanceTier, issues, input.policeAction === true, pendingQuarantineRequest);
}

export function evaluateReviewDisposition(input: RegistryReviewDispositionContext): RegistryReviewDispositionEvaluation {
  const entryLabel = resolveRegistryEntryLabel(input);
  const governanceTier = normalizeRegistryGovernanceTier(
    input.governanceTier ?? resolveRegistryDefaultGovernanceTier(input.status, input.entryType)
  );
  const fromStatus = normalizeRegistryEntryStatus(input.status);
  const issues: string[] = [];
  let toStatus: RegistryEntryStatus = fromStatus;
  let pendingQuarantineRequest = false;

  switch (input.reviewDisposition) {
    case 'approve':
      toStatus = 'active';
      break;
    case 'non-fatal-reject':
      toStatus = fromStatus;
      break;
    case 'fatal-reject':
      pendingQuarantineRequest = true;
      toStatus = fromStatus;
      if (input.policeAction === true) {
        toStatus = 'quarantined';
        pendingQuarantineRequest = false;
      }
      break;
    default:
      issues.push('unknown-review-disposition');
      break;
  }

  return {
    ok: issues.length === 0,
    entryLabel,
    entryType: input.entryType,
    reviewDisposition: input.reviewDisposition,
    fromStatus,
    toStatus,
    governanceTier,
    pendingQuarantineRequest,
    issues
  };
}

function normalizeSourceStatuses(input: RegistryTransitionContext): RegistryEntryStatus[] {
  if (Array.isArray(input.sourceStatuses) && input.sourceStatuses.length > 0) {
    return input.sourceStatuses.map((status) => normalizeRegistryEntryStatus(status));
  }
  return [normalizeRegistryEntryStatus(input.status)];
}

function normalizeStageStatuses(input: RegistryTransitionContext): RegistryEntryStatus[] {
  if (!Array.isArray(input.stageStatuses) || input.stageStatuses.length === 0) {
    return [];
  }
  return input.stageStatuses.map((status) => normalizeRegistryEntryStatus(status));
}

function normalizeMutabilityPolicy(value: RegistryMutabilityPolicy | string | null | undefined): RegistryMutabilityPolicy {
  const text = String(value ?? 'mutable').trim();
  if (registryMutabilityPolicies.includes(text as RegistryMutabilityPolicy)) {
    return text as RegistryMutabilityPolicy;
  }
  throw new Error(`Unsupported registry mutability policy: ${text || '<empty>'}`);
}

function buildTransitionEvaluation(
  entryLabel: string,
  entryType: 'atom' | 'map',
  action: RegistryTransitionAction,
  fromStatuses: readonly RegistryEntryStatus[],
  toStatus: RegistryEntryStatus | null,
  secondaryStatuses: readonly RegistryEntryStatus[],
  governanceTier: RegistryGovernanceTier,
  issues: readonly string[],
  policeAction: boolean,
  pendingQuarantineRequest: boolean
): RegistryTransitionEvaluation {
  return {
    ok: issues.length === 0,
    entryLabel,
    entryType,
    action,
    fromStatuses,
    toStatus,
    secondaryStatuses,
    governanceTier,
    issues,
    policeAction,
    pendingQuarantineRequest
  };
}
