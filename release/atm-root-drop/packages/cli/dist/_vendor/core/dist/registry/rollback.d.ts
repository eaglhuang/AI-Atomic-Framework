import type { ApplyRegistryRollbackOptions, ApplyRegistryRollbackResult } from './rollback-types.js';
export * from './rollback-types.js';
export { resolveMapWorkbenchPath } from './rollback-map.js';
export { resolveRollbackBehavior, validateRollbackProof } from './rollback-proof.js';
export declare function applyRegistryRollback(options: ApplyRegistryRollbackOptions): ApplyRegistryRollbackResult;
