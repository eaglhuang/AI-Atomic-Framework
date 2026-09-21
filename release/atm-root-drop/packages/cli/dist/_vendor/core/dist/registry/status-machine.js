export const registryEntryStatuses = ['draft', 'validated', 'active', 'transitioning', 'deprecated', 'expired', 'quarantined'];
export const registryGovernanceTiers = ['foundation', 'governed', 'standard', 'experimental'];
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
    'behavior.atomize',
    'experience.extract-skill',
    'experience.amend-skill',
    'experience.memory-nudge'
];
export const registryMutabilityPolicies = ['mutable', 'frozen-after-release', 'immutable'];
export const registryReviewDispositions = ['approve', 'non-fatal-reject', 'fatal-reject'];
export const registryTransitionRules = {
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
    },
    'experience.extract-skill': {
        entryTypes: ['atom', 'map'],
        fromStatuses: ['active'],
        toStatus: 'active',
        allowedMutabilityPolicies: ['mutable', 'frozen-after-release', 'immutable']
    },
    'experience.amend-skill': {
        entryTypes: ['atom', 'map'],
        fromStatuses: ['active'],
        toStatus: 'active',
        allowedMutabilityPolicies: ['mutable', 'frozen-after-release', 'immutable']
    },
    'experience.memory-nudge': {
        entryTypes: ['atom', 'map'],
        fromStatuses: ['active'],
        toStatus: 'active',
        allowedMutabilityPolicies: ['mutable', 'frozen-after-release', 'immutable']
    }
};
export function isRegistryEntryStatus(value) {
    return registryEntryStatuses.includes(String(value));
}
export function isRegistryGovernanceTier(value) {
    return registryGovernanceTiers.includes(String(value));
}
export function normalizeRegistryEntryStatus(value) {
    const text = String(value ?? '').trim();
    if (isRegistryEntryStatus(text)) {
        return text;
    }
    throw new Error(`Unsupported registry status: ${text || '<empty>'}`);
}
export function normalizeRegistryGovernanceTier(value) {
    const text = String(value ?? '').trim();
    if (isRegistryGovernanceTier(text)) {
        return text;
    }
    throw new Error(`Unsupported registry governance tier: ${text || '<empty>'}`);
}
export function resolveRegistryDefaultGovernanceTier(status, entryType) {
    if (status === 'quarantined') {
        return 'governed';
    }
    return 'standard';
}
export function resolveRegistryEntryLabel(entry) {
    if (typeof entry.mapId === 'string' && entry.mapId.trim().length > 0) {
        return entry.mapId.trim();
    }
    if (typeof entry.atomId === 'string' && entry.atomId.trim().length > 0) {
        return entry.atomId.trim();
    }
    return '';
}
export function evaluateRegistryTransition(input) {
    const entryLabel = resolveRegistryEntryLabel(input);
    const governanceTier = normalizeRegistryGovernanceTier(input.governanceTier ?? resolveRegistryDefaultGovernanceTier(input.status, input.entryType));
    const rule = registryTransitionRules[input.action];
    const sourceStatuses = normalizeSourceStatuses(input);
    const mutabilityPolicy = normalizeMutabilityPolicy(input.mutabilityPolicy);
    const issues = [];
    let toStatus = rule?.toStatus ?? null;
    let secondaryStatuses = rule?.secondaryStatuses ?? [];
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
export function evaluateReviewDisposition(input) {
    const entryLabel = resolveRegistryEntryLabel(input);
    const governanceTier = normalizeRegistryGovernanceTier(input.governanceTier ?? resolveRegistryDefaultGovernanceTier(input.status, input.entryType));
    const fromStatus = normalizeRegistryEntryStatus(input.status);
    const issues = [];
    let toStatus = fromStatus;
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
function normalizeSourceStatuses(input) {
    if (Array.isArray(input.sourceStatuses) && input.sourceStatuses.length > 0) {
        return input.sourceStatuses.map((status) => normalizeRegistryEntryStatus(status));
    }
    return [normalizeRegistryEntryStatus(input.status)];
}
function normalizeStageStatuses(input) {
    if (!Array.isArray(input.stageStatuses) || input.stageStatuses.length === 0) {
        return [];
    }
    return input.stageStatuses.map((status) => normalizeRegistryEntryStatus(status));
}
function normalizeMutabilityPolicy(value) {
    const text = String(value ?? 'mutable').trim();
    if (registryMutabilityPolicies.includes(text)) {
        return text;
    }
    throw new Error(`Unsupported registry mutability policy: ${text || '<empty>'}`);
}
function buildTransitionEvaluation(entryLabel, entryType, action, fromStatuses, toStatus, secondaryStatuses, governanceTier, issues, policeAction, pendingQuarantineRequest) {
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
