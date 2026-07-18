import { unique } from './files.js';
export function parseResourceSet(input) {
    return {
        files: unique(input),
        atomCids: [],
        virtualAtomCids: [],
        validators: [],
        artifacts: []
    };
}
export function validateRouteContext(value) {
    const errors = [];
    if (!value || typeof value !== 'object') {
        return { ok: false, errors: ['/ must be object'] };
    }
    const record = value;
    if (record.schemaId !== 'atm.routeContext.v1') {
        errors.push('/schemaId must be atm.routeContext.v1');
    }
    if (record.specVersion !== '0.1.0') {
        errors.push('/specVersion must be 0.1.0');
    }
    for (const [field, fieldValue] of Object.entries({
        routeId: record.routeId,
        taskId: record.taskId,
        actorId: record.actorId,
        openedAt: record.openedAt
    })) {
        if (typeof fieldValue !== 'string' || fieldValue.length === 0) {
            errors.push(`/${field} must be a non-empty string`);
        }
    }
    if (typeof record.routeId === 'string' && !/^route-[A-Za-z0-9._:-]+$/.test(record.routeId)) {
        errors.push('/routeId must start with route- and contain only route id characters');
    }
    if (!['read', 'write', 'review', 'steward', 'release-sync'].includes(String(record.claimIntent))) {
        errors.push('/claimIntent must be a supported route claim intent');
    }
    if (!['open', 'admitted', 'frozen', 'waiting', 'blocked', 'ready-to-apply', 'closed', 'abandoned'].includes(String(record.state))) {
        errors.push('/state must be a supported route context state');
    }
    if (!record.lease || typeof record.lease !== 'object') {
        errors.push('/lease must be an object');
    }
    if (!isResourceSet(record.declaredReadSet)) {
        errors.push('/declaredReadSet must be a route resource set');
    }
    if (!isResourceSet(record.declaredWriteSet)) {
        errors.push('/declaredWriteSet must be a route resource set');
    }
    if (!Array.isArray(record.targetAtomCids)) {
        errors.push('/targetAtomCids must be an array');
    }
    if (!Array.isArray(record.targetVirtualAtomCids)) {
        errors.push('/targetVirtualAtomCids must be an array');
    }
    if (!Array.isArray(record.blockedBy)) {
        errors.push('/blockedBy must be an array');
    }
    if (record.patchEnvelopeRef !== null && typeof record.patchEnvelopeRef !== 'string') {
        errors.push('/patchEnvelopeRef must be string or null');
    }
    return errors.length === 0
        ? { ok: true, value: record }
        : { ok: false, errors };
}
function isResourceSet(value) {
    if (!value || typeof value !== 'object') {
        return false;
    }
    const record = value;
    return Array.isArray(record.files)
        && Array.isArray(record.atomCids)
        && Array.isArray(record.virtualAtomCids)
        && Array.isArray(record.validators)
        && Array.isArray(record.artifacts);
}
