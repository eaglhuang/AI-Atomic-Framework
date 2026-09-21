import { createHash } from 'node:crypto';
import { brokerAdapterMigration } from '../types.js';
import { resolveAdapter } from './registry.js';
/**
 * Deterministic plan id: sha256 over the sorted request ids, mirroring
 * merge-plan.ts buildDeterministicMergePlanId.
 */
export function buildDeterministicPlanId(requestIds) {
    const digest = createHash('sha256')
        .update([...requestIds].sort((left, right) => left.localeCompare(right)).join('\n'))
        .digest('hex');
    return `batch-${digest.slice(0, 16)}`;
}
function fileDescriptorFor(request) {
    // The planner is content-agnostic about CAS; it only needs the structural
    // shape to parse. Callers that have on-disk content pass it via the request's
    // value pipeline; here we parse an empty-but-valid document only when content
    // is unavailable. In practice the registry adapters only need filePath for
    // conflict-key derivation, and parse is invoked lazily by canMerge/merge.
    return { filePath: request.filePath, content: request.content ?? '{}' };
}
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
export function planMutationBatch(input) {
    const planned = [];
    const blocked = [];
    for (const request of input.requests) {
        const content = input.fileContents?.[request.filePath];
        const file = content !== undefined
            ? { filePath: request.filePath, content }
            : fileDescriptorFor(request);
        const adapter = resolveAdapter(input.registry, file);
        try {
            const parsed = adapter.parse(file);
            const mutation = adapter.normalize(request);
            const conflictKeys = adapter.getConflictKeys(mutation, parsed);
            planned.push({ request, adapterId: adapter.id, mutation, parsed, conflictKeys });
        }
        catch (error) {
            void error;
            blocked.push(request.requestId);
        }
    }
    const byFile = new Map();
    for (const entry of planned) {
        const bucket = byFile.get(entry.request.filePath);
        if (bucket) {
            bucket.push(entry);
        }
        else {
            byFile.set(entry.request.filePath, [entry]);
        }
    }
    const batches = [];
    const queued = [];
    const requestConflictKeys = [];
    const sortedFiles = [...byFile.keys()].sort((left, right) => left.localeCompare(right));
    for (const filePath of sortedFiles) {
        const entries = [...byFile.get(filePath)].sort((left, right) => left.request.requestId.localeCompare(right.request.requestId));
        const adapter = resolveAdapter(input.registry, fileDescriptorFor(entries[0].request));
        const parsed = entries[0].parsed;
        // Greedy single batch per file: accumulate requests while the adapter keeps
        // the batch non-conflicting. Any request that would make the batch conflict
        // is QUEUED (deferred to a subsequent serialized round), never silently
        // dropped and never merged into the conflicting batch.
        const current = [];
        for (const entry of entries) {
            const candidate = [...current, entry];
            const decision = adapter.canMerge(candidate.map((item) => item.mutation), parsed);
            if (decision.verdict === 'conflict') {
                if (current.length === 0) {
                    current.push(entry);
                }
                else {
                    queued.push(entry.request.requestId);
                }
            }
            else {
                current.push(entry);
            }
        }
        if (current.length > 0) {
            const decision = adapter.canMerge(current.map((entry) => entry.mutation), parsed);
            const verdict = decision.verdict === 'commutative-merge' ? 'commutative-merge' : 'mergeable';
            requestConflictKeys.push(...current.map((entry) => ({
                requestId: entry.request.requestId,
                conflictKeys: entry.conflictKeys
            })));
            batches.push({
                filePath,
                adapterId: adapter.id,
                verdict,
                requestIds: current.map((entry) => entry.request.requestId),
                conflictKeys: decision.conflictKeys
            });
        }
    }
    const allRequestIds = input.requests.map((request) => request.requestId);
    return {
        schemaId: 'atm.mutationBatchPlan.v1',
        specVersion: '0.1.0',
        migration: brokerAdapterMigration(),
        planId: buildDeterministicPlanId(allRequestIds),
        batches,
        queued: [...queued].sort((left, right) => left.localeCompare(right)),
        blocked: [...blocked].sort((left, right) => left.localeCompare(right)),
        requestConflictKeys: requestConflictKeys.sort((left, right) => left.requestId.localeCompare(right.requestId))
    };
}
