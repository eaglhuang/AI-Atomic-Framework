import { inferLinkedSurfaceClosure } from '../../../../../core/dist/scope/linked-surface/index.js';
export function buildLinkedSurfaceScopePreflight(input) {
    const closure = inferLinkedSurfaceClosure({
        rootScope: input.existingScope,
        edges: input.edges,
        registeredProducerIds: input.registeredProducerIds
    });
    const existing = new Set(input.existingScope.map((surface) => surface.replace(/\\/g, '/')));
    const requiredAdditions = closure.requiredSurfaces.filter((surface) => !existing.has(surface));
    return {
        schemaId: 'atm.scopePreflight.linkedSurface.v1',
        ok: requiredAdditions.length === 0 && closure.unavailableSurfaces.length === 0,
        errorCode: requiredAdditions.length > 0 ? 'ATM_SCOPE_AMENDMENT_REQUIRED' : null,
        existingScope: [...existing].sort(),
        requiredAdditions,
        optionalSurfaces: closure.optionalSurfaces,
        unavailableSurfaces: closure.unavailableSurfaces,
        closure,
        brokerOverlapFacts: {
            readSet: [...(input.brokerReadSet ?? input.existingScope)].sort(),
            writeSet: [...(input.brokerWriteSet ?? input.existingScope)].sort()
        }
    };
}
