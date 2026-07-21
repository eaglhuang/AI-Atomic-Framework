import {
  inferLinkedSurfaceClosure,
  type LinkedSurfaceClosureReceipt,
  type LinkedSurfaceEdge
} from '../../../../../core/src/scope/linked-surface/index.ts';

export type LinkedSurfaceScopePreflightReceipt = Readonly<{
  schemaId: 'atm.scopePreflight.linkedSurface.v1';
  ok: boolean;
  errorCode: 'ATM_SCOPE_AMENDMENT_REQUIRED' | null;
  existingScope: readonly string[];
  requiredAdditions: readonly string[];
  optionalSurfaces: readonly string[];
  unavailableSurfaces: readonly string[];
  closure: LinkedSurfaceClosureReceipt;
  brokerOverlapFacts: {
    readonly readSet: readonly string[];
    readonly writeSet: readonly string[];
  };
}>;

export function buildLinkedSurfaceScopePreflight(input: {
  readonly existingScope: readonly string[];
  readonly edges: readonly LinkedSurfaceEdge[];
  readonly registeredProducerIds: readonly string[];
  readonly brokerReadSet?: readonly string[];
  readonly brokerWriteSet?: readonly string[];
}): LinkedSurfaceScopePreflightReceipt {
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
