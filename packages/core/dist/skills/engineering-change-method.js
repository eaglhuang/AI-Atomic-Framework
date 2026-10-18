import { createHash } from 'node:crypto';
export const ENGINEERING_CHANGE_METHOD_PROFILE_SCHEMA_ID = 'atm.engineeringChangeMethodProfile.v1';
export const ENGINEERING_CHANGE_METHOD_FIDELITY_RECEIPT_SCHEMA_ID = 'atm.engineeringChangeMethodFidelityReceipt.v1';
export function selectEngineeringChangeMethodProfiles(profiles, input) {
    const haystack = [
        input.changeSummary,
        ...(input.changedPublicSeams ?? []),
        ...(input.observedSignals ?? [])
    ].join('\n').toLowerCase();
    const requested = new Set(input.requestedMethods ?? []);
    const selected = profiles
        .filter((profile) => requested.has(profile.id) || profile.triggerEvidence.some((trigger) => haystack.includes(trigger.toLowerCase())))
        .map((profile) => profile.id);
    return {
        schemaId: 'atm.engineeringChangeMethodSelection.v1',
        selectedProfileIds: selected,
        skippedProfileIds: profiles.map((profile) => profile.id).filter((id) => !selected.includes(id)),
        reasons: selected.length > 0 ? selected.map((id) => `selected:${id}`) : ['no-method-profile-triggered'],
        profileDigest: digestJson(profiles)
    };
}
export function evaluateEngineeringChangeMethodFidelity(input) {
    const observations = new Set(input.observations.map(normalize));
    const evidenceRefs = new Set(input.evidenceRefs.map(normalize));
    const counterexamplesCleared = new Set(input.counterexamplesCleared.map(normalize));
    const rollbackRefs = new Set(input.rollbackRefs.map(normalize));
    const missing = [];
    const antiPatterns = [];
    if (!input.taskId.trim())
        missing.push('task-id');
    requireAll('required-observation', input.profile.requiredObservations, observations, missing);
    requireAll('completion-evidence', input.profile.completionEvidence, evidenceRefs, missing);
    requireAll('counterexample-cleared', input.profile.counterexamples, counterexamplesCleared, missing);
    requireAll('rollback', input.profile.rollback, rollbackRefs, missing);
    if (input.profile.id === 'expand-contract') {
        if (!hasObservation(input.observations, 'expand step'))
            missing.push('expand-contract:expand-step');
        if (!hasObservation(input.observations, 'independently green migration batch'))
            missing.push('expand-contract:independently-green-migration-batches');
        if (!input.oldFormUsageQueryRef)
            missing.push('expand-contract:old-form-usage-query');
        if (!input.zeroCallerGateRef)
            missing.push('expand-contract:zero-caller-contract-gate');
    }
    if (input.profile.id === 'tdd-oracle-fidelity') {
        if ((input.independentOracleRefs ?? []).length === 0)
            missing.push('tdd-oracle:independent-source');
        if (hasObservation(input.observations, 'private method'))
            antiPatterns.push('tdd-oracle:private-method-test');
        if (hasObservation(input.observations, 'internal mock'))
            antiPatterns.push('tdd-oracle:internal-mock');
        if (hasObservation(input.observations, 'tautological'))
            antiPatterns.push('tdd-oracle:tautological-test');
    }
    if (input.profile.id === 'review-smell-heuristics' && !input.smellHeuristicPolicyRef) {
        missing.push('review-smell:replaceable-heuristic-policy-ref');
    }
    if (input.profile.id === 'merge-conflict-intent') {
        if ((input.bothSideIntentRefs ?? []).length < 2)
            missing.push('merge-conflict:both-side-intent-provenance');
        if (!hasObservation(input.observations, 'abort safely') && !hasObservation(input.observations, 'fail closed')) {
            missing.push('merge-conflict:safe-abort-or-fail-closed');
        }
        if (hasObservation(input.observations, 'ours/theirs'))
            antiPatterns.push('merge-conflict:mandates-ours-theirs');
    }
    const valid = missing.length === 0 && antiPatterns.length === 0;
    return {
        schemaId: ENGINEERING_CHANGE_METHOD_FIDELITY_RECEIPT_SCHEMA_ID,
        specVersion: '0.1.0',
        migration: {
            strategy: 'none',
            fromVersion: null,
            notes: 'Initial engineering change method fidelity receipt.'
        },
        taskId: input.taskId.trim(),
        profileId: input.profile.id,
        valid,
        admission: valid ? 'admit-method' : 'fail-closed',
        missing,
        antiPatterns,
        receiptDigest: digestJson({
            taskId: input.taskId,
            profileId: input.profile.id,
            observations: input.observations,
            evidenceRefs: input.evidenceRefs,
            counterexamplesCleared: input.counterexamplesCleared,
            rollbackRefs: input.rollbackRefs
        })
    };
}
function requireAll(label, required, actual, missing) {
    for (const value of required) {
        if (!actual.has(normalize(value)))
            missing.push(`${label}:${value}`);
    }
}
function hasObservation(values, needle) {
    return values.some((value) => normalize(value).includes(normalize(needle)));
}
function normalize(value) {
    return String(value ?? '').trim().toLowerCase();
}
function digestJson(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
