import { createHash } from 'node:crypto';
export const STATE_REPLAY_SCHEMA_ID = 'atm.stateReplay.v1';
export const STATE_REPLAY_SPEC_VERSION = '0.2.0';
export const replayDogfoodSignals = ['cross-lane-shared-index', 'close-deferral', 'active-batch-routing'];
export function sealReplayObservation(observation) {
    return digest(canonicalObservation(observation));
}
export function replayState(input) {
    const observations = [...(input.observations ?? [])].sort((left, right) => text(left.incidentId).localeCompare(text(right.incidentId)));
    const requiredFamilies = unique(input.requiredFamilies ?? []);
    const requiredSignals = uniqueSignals(input.requiredDogfoodSignals ?? []);
    const verdicts = observations.map(classifyObservation);
    const presentFamilies = new Set(observations.map((item) => text(item.family)));
    for (const family of requiredFamilies.filter((family) => !presentFamilies.has(family))) {
        verdicts.push({ incidentId: `missing-family:${family}`, family, verdict: 'missing', diagnostics: ['required-family-missing'] });
    }
    const observedSignals = uniqueSignals(observations
        .filter((item, index) => verdicts[index]?.verdict === 'repaired')
        .flatMap((item) => item.dogfoodWitness ? [item.dogfoodWitness.signal] : []));
    const diagnostics = verdicts.flatMap((entry) => entry.diagnostics);
    if (!isDigest(input.authorityDigest))
        diagnostics.push('authority-missing-or-invalid');
    for (const signal of requiredSignals.filter((signal) => !observedSignals.includes(signal)))
        diagnostics.push(`required-dogfood-signal-missing:${signal}`);
    const result = {
        schemaId: STATE_REPLAY_SCHEMA_ID,
        specVersion: STATE_REPLAY_SPEC_VERSION,
        authorityDigest: text(input.authorityDigest),
        status: diagnostics.length === 0 ? 'proven' : 'blocked',
        verdicts: [...verdicts].sort((left, right) => left.incidentId.localeCompare(right.incidentId)),
        requiredFamilies,
        requiredDogfoodSignals: requiredSignals,
        observedDogfoodSignals: observedSignals,
        nonClaims: ['replay-is-not-close-authority', 'replay-does-not-authorize-plan4-close', 'fixture-only-replay-cannot-prove-dogfood'],
        historicalIncidentIds: observations.filter((item) => item.historical).map((item) => text(item.incidentId)).filter(Boolean).sort(),
        diagnostics: unique(diagnostics),
        resultDigest: '',
    };
    return { ...result, resultDigest: digest({ ...result, resultDigest: undefined }) };
}
export const replayStateReplay = replayState;
export function validateStateReplay(result) {
    const diagnostics = [];
    if (result.schemaId !== STATE_REPLAY_SCHEMA_ID || result.specVersion !== STATE_REPLAY_SPEC_VERSION)
        diagnostics.push('invalid-schema');
    if (!isDigest(result.authorityDigest))
        diagnostics.push('invalid-authority-digest');
    if (!result.nonClaims.includes('replay-does-not-authorize-plan4-close'))
        diagnostics.push('missing-close-authority-non-claim');
    const expectedDigest = digest({ ...result, resultDigest: undefined });
    if (result.resultDigest !== expectedDigest)
        diagnostics.push('result-digest-mismatch');
    if (result.status === 'proven' && (result.diagnostics.length || result.verdicts.some((entry) => entry.verdict !== 'repaired')))
        diagnostics.push('proven-result-has-blockers');
    return { ok: diagnostics.length === 0, diagnostics };
}
function classifyObservation(observation) {
    const diagnostics = [];
    if (!text(observation.incidentId) || !text(observation.family))
        diagnostics.push('missing-identity');
    if (!observation.supported)
        diagnostics.push('unsupported-family');
    if (observation.sealDigest !== sealReplayObservation(withoutSeal(observation)))
        diagnostics.push('observation-seal-mismatch');
    for (const field of ['sourceCommit', 'runnerDigest', 'treeDigest', 'provenanceDigest', 'fixtureDigest']) {
        const expected = text(observation.expected?.[field]);
        const observed = text(observation.observed?.[field]);
        if (!expected || !observed)
            diagnostics.push(`missing-${bindingName(field)}`);
        else if (expected !== observed)
            diagnostics.push(`mismatch-${bindingName(field)}`);
    }
    if (observation.expected?.repairDigest && observation.observed?.repairDigest && observation.expected.repairDigest !== observation.observed.repairDigest)
        diagnostics.push('repair-regressed');
    if (observation.fixtureOnly === true)
        diagnostics.push('fixture-only-replay');
    let verdict = 'repaired';
    if (diagnostics.includes('unsupported-family'))
        verdict = 'unsupported';
    else if (diagnostics.some((item) => item.startsWith('missing-')))
        verdict = 'missing';
    else if (diagnostics.includes('observation-seal-mismatch'))
        verdict = 'forged';
    else if (diagnostics.some((item) => item.startsWith('mismatch-')))
        verdict = observation.historical ? 'stale' : 'forged';
    else if (diagnostics.includes('repair-regressed'))
        verdict = 'regressed';
    else if (diagnostics.includes('fixture-only-replay'))
        verdict = 'unsupported';
    return { incidentId: text(observation.incidentId), family: text(observation.family), verdict, diagnostics: unique(diagnostics) };
}
function validWitness(witness) {
    return Boolean(witness && replayDogfoodSignals.includes(witness.signal) && unique(witness.laneIds).length >= 2 && isDigest(witness.eventDigest));
}
function canonicalObservation(observation) {
    return {
        incidentId: text(observation.incidentId), family: text(observation.family), historical: observation.historical === true, supported: observation.supported === true, fixtureOnly: observation.fixtureOnly === true,
        expected: canonicalBinding(observation.expected), observed: canonicalBinding(observation.observed),
        dogfoodWitness: observation.dogfoodWitness ? { signal: observation.dogfoodWitness.signal, laneIds: unique(observation.dogfoodWitness.laneIds), eventDigest: text(observation.dogfoodWitness.eventDigest) } : null,
    };
}
function canonicalBinding(binding) { return { sourceCommit: text(binding?.sourceCommit), runnerDigest: text(binding?.runnerDigest), treeDigest: text(binding?.treeDigest), provenanceDigest: text(binding?.provenanceDigest), fixtureDigest: text(binding?.fixtureDigest), repairDigest: binding?.repairDigest ? text(binding.repairDigest) : undefined }; }
function withoutSeal(observation) { const { sealDigest: _sealDigest, ...rest } = observation; return rest; }
function bindingName(field) { return field.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`); }
function unique(values) { return [...new Set(values.map(text).filter(Boolean))].sort(); }
function uniqueSignals(values) { return [...new Set(values.filter((value) => replayDogfoodSignals.includes(value)))].sort(); }
function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function isDigest(value) { return /^sha256:[a-f0-9]{64}$/i.test(text(value)); }
function digest(value) { return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`; }
