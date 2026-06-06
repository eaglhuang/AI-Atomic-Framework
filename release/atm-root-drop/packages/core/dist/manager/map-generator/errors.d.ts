/**
 * Shared error helper for the map-generator submodules.
 *
 * Extracted from `packages/core/src/manager/map-generator.ts` per the
 * `map-generator.SPLIT_PLAN.md` Layer 2 split. Splitting normalize-*
 * helpers into their own files requires a shared error factory both
 * the top-level orchestrator and the normalizers can import.
 */
export type GeneratorError = Error & {
    code: string;
    details: Record<string, unknown>;
};
export declare function createGeneratorError(code: any, text: any, details?: Record<string, unknown>): GeneratorError;
