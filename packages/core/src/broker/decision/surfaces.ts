import type { ActiveWriteIntent, WriteIntent } from '../types.ts';

export function hasSharedWriteSurface(intent: WriteIntent, active: ActiveWriteIntent): boolean {
  const normalizedFiles = new Set(intent.targetFiles.map(normalizeBrokerPath));
  if (active.resourceKeys.files.some((file) => normalizedFiles.has(normalizeBrokerPath(file)))) return true;
  return hasIntersection(intent.sharedSurfaces.generators, active.resourceKeys.generators)
    || hasIntersection(intent.sharedSurfaces.projections, active.resourceKeys.projections)
    || hasIntersection(intent.sharedSurfaces.registries, active.resourceKeys.registries)
    || hasIntersection(intent.sharedSurfaces.validators, active.resourceKeys.validators)
    || hasIntersection(intent.sharedSurfaces.artifacts, active.resourceKeys.artifacts);
}

export function hasIntersection(left: readonly string[], right: readonly string[]): boolean {
  const values = new Set(left);
  return right.some((value) => values.has(value));
}

export function normalizeBrokerPath(value: string): string {
  return value.trim().replace(/\\/g, '/');
}
