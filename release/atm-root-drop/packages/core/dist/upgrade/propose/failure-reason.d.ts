/**
 * Gate failure-reason renderers for upgrade proposals.
 *
 * Extracted from `packages/core/src/upgrade/propose.ts` per the
 * `propose.SPLIT_PLAN.md` Layer 3 split. Two small string-rendering
 * helpers — the lowest-coupling slice of propose.ts.
 *
 * Surface contract: the returned strings are embedded in upgrade
 * proposal JSON (invariant I2) and surface in CLI output. Behavior
 * preserved byte-for-byte.
 */
export declare function gateFailureSummary(gateName: any, report: any): string;
export declare function qualityComparisonFailureReason(report: any): string;
