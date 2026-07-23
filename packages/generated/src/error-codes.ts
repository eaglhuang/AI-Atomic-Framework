/**
 * Stable ErrorCode constants for post-compose semantic validation.
 * Exact registry metadata lives in docs/governance/error-code-registry.json and
 * is projected by `npm run generate:error-codes` into
 * packages/core/src/error-code-registry.generated.ts.
 *
 * Downstream cards (for example ATM-GOV-0254) must import these constants
 * instead of inventing string literals or a local fallback taxonomy.
 */

export const ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_FAILED =
  'ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_FAILED' as const;

export const ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE =
  'ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE' as const;

export type PostComposeSemanticValidationErrorCode =
  | typeof ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_FAILED
  | typeof ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE;

export {
  ATM_ERROR_CODE_REGISTRY,
  ATM_ERROR_CODE_REGISTRY_DIGEST
} from '../../core/src/error-code-registry.generated.ts';
