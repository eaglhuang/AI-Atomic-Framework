import type { ApplyRegistryRollbackOptions, ApplyRegistryRollbackResult } from './rollback-types.ts';
export * from './rollback-types.ts';
export { resolveMapWorkbenchPath } from './rollback-map.ts';
export { resolveRollbackBehavior, validateRollbackProof } from './rollback-proof.ts';
export declare function applyRegistryRollback(options: ApplyRegistryRollbackOptions): ApplyRegistryRollbackResult;
