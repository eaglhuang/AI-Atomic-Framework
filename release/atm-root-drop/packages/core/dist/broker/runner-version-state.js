export function createRunnerVersionStream(streamId) {
    return {
        schemaId: 'atm.runnerVersionStream.v1',
        specVersion: '0.1.0',
        migration: { strategy: 'none', fromVersion: null, notes: 'Runner version stream baseline.' },
        streamId,
        state: 'in-dev',
        lease: { heldBy: null, heldUntil: null },
        history: []
    };
}
const ALLOWED = {
    'in-dev': ['cut-rc'],
    'rc-stabilizing': ['freeze-rc', 'rollback-rc'],
    'rc-frozen': ['publish', 'rollback-rc'],
    published: ['retire'],
    retired: []
};
const RESULT = {
    'cut-rc': 'rc-stabilizing',
    'freeze-rc': 'rc-frozen',
    publish: 'published',
    'rollback-rc': 'in-dev',
    retire: 'retired'
};
export function transitionRunnerVersion(record, transition, actorId, at = new Date().toISOString()) {
    if (!ALLOWED[record.state].includes(transition)) {
        return {
            ok: false,
            reason: `transition ${transition} is not allowed from state ${record.state}`,
            record
        };
    }
    if (!actorId.trim()) {
        return { ok: false, reason: 'actorId is required for a state transition', record };
    }
    const fromState = record.state;
    const toState = RESULT[transition];
    return {
        ok: true,
        reason: `state ${fromState} -> ${toState}`,
        record: {
            ...record,
            state: toState,
            history: [...record.history, { at, transition, fromState, toState, actorId }]
        }
    };
}
export function acquireRunnerVersionLease(record, actorId, ttlSeconds, now = new Date().toISOString()) {
    if (record.state !== 'in-dev' && record.state !== 'rc-stabilizing') {
        return {
            ok: false,
            reason: `cannot lease a stream in state ${record.state}`,
            record
        };
    }
    const heldUntil = new Date(new Date(now).getTime() + ttlSeconds * 1000).toISOString();
    return {
        ok: true,
        reason: `lease granted to ${actorId} until ${heldUntil}`,
        record: { ...record, lease: { heldBy: actorId, heldUntil } }
    };
}
