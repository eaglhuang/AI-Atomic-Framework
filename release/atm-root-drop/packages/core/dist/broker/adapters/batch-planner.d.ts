import { type MutationBatchPlan, type MutationRequest } from '../types.ts';
import { type AdapterRegistry } from './registry.ts';
/**
 * Deterministic plan id: sha256 over the sorted request ids, mirroring
 * merge-plan.ts buildDeterministicMergePlanId.
 */
export declare function buildDeterministicPlanId(requestIds: readonly string[]): string;
/**
 * Plans how a set of mutation requests can be batched per file (TASK-CID-0097).
 *
 * Steps:
 *  1. resolve the owning adapter for each request (most-specific first);
 *  2. normalize each request and derive its conflict keys;
 *  3. group requests by filePath;
 *  4. within each file, greedily add requests to a batch as long as the adapter's
 *     canMerge over the accumulated batch stays non-conflict (disjoint =>
 *     mergeable, commutative ops => commutative-merge). The first request that
 *     would make the batch conflict is queued, and the remainder of that file's
 *     requests are re-evaluated against a fresh batch.
 *  5. deterministic ordering throughout (files sorted, requests sorted by id).
 */
export declare function planMutationBatch(input: {
    readonly registry: AdapterRegistry;
    readonly requests: readonly MutationRequest[];
    readonly fileContents?: Readonly<Record<string, string>>;
}): MutationBatchPlan;
