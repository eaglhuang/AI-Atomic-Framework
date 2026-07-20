import { resourceListsOverlap } from '../resource-overlap.js';
// Route every axis through the shared pattern-aware matcher (ATM-GOV-0206 / 0215).
// Do not reintroduce Array.includes / Set.has over resource-key lists here; the
// call-site inventory guard test will fail if the exact-match pattern reappears.
export function hasSharedWriteSurface(intent, active) {
    return resourceListsOverlap('file', intent.targetFiles, active.resourceKeys.files)
        || resourceListsOverlap('generator', intent.sharedSurfaces.generators, active.resourceKeys.generators)
        || resourceListsOverlap('projection', intent.sharedSurfaces.projections, active.resourceKeys.projections)
        || resourceListsOverlap('registry', intent.sharedSurfaces.registries, active.resourceKeys.registries)
        || resourceListsOverlap('validator', intent.sharedSurfaces.validators, active.resourceKeys.validators)
        || resourceListsOverlap('artifact', intent.sharedSurfaces.artifacts, active.resourceKeys.artifacts);
}
