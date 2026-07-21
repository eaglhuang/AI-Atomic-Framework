export const linkedSurfaceClosureSchemaId = 'atm.linkedSurfaceClosure.v1';

export interface LinkedSurfaceClosureSchemaContract {
  readonly schemaId: typeof linkedSurfaceClosureSchemaId;
  readonly specVersion: '0.1.0';
  readonly rootScope: readonly string[];
  readonly requiredSurfaces: readonly string[];
  readonly optionalSurfaces: readonly string[];
  readonly unavailableSurfaces: readonly string[];
  readonly traversalOrder: readonly string[];
  readonly closureDigest: string;
  readonly findings: readonly {
    readonly code: 'ATM_SCOPE_AMENDMENT_REQUIRED' | 'ATM_LINKED_SURFACE_OPTIONAL' | 'ATM_LINKED_SURFACE_UNSUPPORTED' | 'ATM_LINKED_SURFACE_CYCLE';
    readonly surface: string;
    readonly edgeId: string | null;
    readonly producerId: string | null;
    readonly message: string;
  }[];
}
