/**
 * Stable ErrorCode constants for post-compose semantic validation.
 * Exact registry metadata lives in docs/governance/error-code-registry.json and
 * is projected by `npm run generate:error-codes` into
 * packages/core/src/error-code-registry.generated.ts.
 *
 * Downstream cards (for example ATM-GOV-0254) must import these constants
 * instead of inventing string literals or a local fallback taxonomy.
 */

export {
  ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_FAILED,
  ATM_BROKER_COMPOSE_SEMANTIC_VALIDATION_UNAVAILABLE,
  type PostComposeSemanticCode as PostComposeSemanticValidationErrorCode
} from '../../core/src/broker/post-compose-semantic-validation-policy.ts';

export {
  ATM_ERROR_CODE_REGISTRY,
  ATM_ERROR_CODE_REGISTRY_DIGEST
} from '../../core/src/error-code-registry.generated.ts';
