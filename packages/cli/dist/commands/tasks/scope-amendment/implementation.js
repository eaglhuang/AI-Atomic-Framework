import { rearbitrateLinkedSurfaceScope } from '../../../../../core/dist/scope/linked-surface/index.js';
export function buildScopeAmendmentRearbitration(input) {
    const current = new Set(input.currentScope.map((surface) => surface.replace(/\\/g, '/')));
    const amendmentPaths = input.closure.requiredSurfaces.filter((surface) => !current.has(surface));
    const rearbitration = rearbitrateLinkedSurfaceScope({
        closure: input.closure,
        ticketReadSet: input.ticketReadSet,
        ticketWriteSet: input.ticketWriteSet
    });
    return {
        schemaId: 'atm.scopeAmendment.linkedSurfaceRearbitration.v1',
        ok: amendmentPaths.length === 0 && !rearbitration.required,
        errorCode: rearbitration.errorCode,
        amendmentPaths,
        rearbitration
    };
}
