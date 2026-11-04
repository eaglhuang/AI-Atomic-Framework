import type { BaseCompositionResult } from './steward-base-composer.js';
import type { PatchProposal } from './types.js';
/**
 * JSON anchors permit overlapping patch context only for prefix-disjoint paths.
 * Render original patch bytes, never JSON.stringify: a conservative single-span
 * splice per proposal preserves whitespace, line endings, key order and EOF.
 * Any uncertainty returns control to the strict immutable-base text composer.
 */
export declare function composeJsonPointerPatches(before: string, proposals: readonly PatchProposal[]): BaseCompositionResult | null;
