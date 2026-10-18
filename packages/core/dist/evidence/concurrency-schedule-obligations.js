import { createHash } from 'node:crypto';
export const CONCURRENCY_SCHEDULE_SCHEMA_ID = 'atm.concurrencyScheduleObligationsResult.v1';
/** One deep seam: normalize, reduce and derive obligations from one sealed schedule authority. */
export function reduceConcurrencySchedule(input) {
    const normalized = normalize(input);
    const diagnostics = [];
    if (!normalized.scheduleId)
        diagnostics.push(error('ATM_SCHEDULE_ID_MISSING', 'scheduleId is required.', 'scheduleId'));
    if (!normalized.authority.authorityId || !normalized.authority.digest)
        diagnostics.push(error('ATM_SCHEDULE_AUTHORITY_INCOMPLETE', 'A sealed authority id and digest are required.', 'authority', 'seal the schedule input authority'));
    if (!normalized.authority.sealed)
        diagnostics.push(error('ATM_SCHEDULE_AUTHORITY_UNSEALED', 'Schedule reduction requires a sealed authority.', 'authority.sealed', 'seal the schedule input authority before reduction'));
    if (!normalized.operations.length)
        diagnostics.push(error('ATM_SCHEDULE_INPUT_INCOMPLETE', 'At least one operation is required.', 'operations', 'restore the deterministic schedule fixture'));
    const ids = new Set(normalized.operations.map((entry) => entry.operationId));
    for (const operation of normalized.operations)
        for (const dependency of operation.dependsOn ?? [])
            if (!ids.has(dependency))
                diagnostics.push(error('ATM_SCHEDULE_DEPENDENCY_UNRESOLVED', `Operation ${operation.operationId} depends on missing ${dependency}.`, operation.operationId, 'restore the missing operation or remove the stale dependency'));
    if (new Set(normalized.operations.map((entry) => entry.operationId)).size !== normalized.operations.length)
        diagnostics.push(error('ATM_SCHEDULE_OPERATION_DUPLICATE', 'Operation ids must be unique.', 'operations', 'deduplicate the schedule fixture'));
    const classes = buildClasses(normalized.operations);
    const edges = buildEdges(normalized.operations);
    const reduced = topologicalReduction(normalized.operations, edges, diagnostics);
    const obligations = edges.map((edge) => ({ obligationId: `obligation_${digest(edge.join('|')).slice(7, 23)}`, operationIds: edge, kind: 'conflict', status: 'satisfied' }));
    const inputDigest = digest(normalized);
    const status = diagnostics.some((entry) => entry.severity === 'error') ? (diagnostics.some((entry) => entry.code.includes('UNSEALED') || entry.code.includes('AUTHORITY')) ? 'stale' : 'blocked') : 'reduced';
    return { schemaId: CONCURRENCY_SCHEDULE_SCHEMA_ID, specVersion: '0.1.0', scheduleId: normalized.scheduleId, resultId: `schedule_result_${inputDigest.slice(7, 23)}`, authority: normalized.authority, status, reducedSchedule: reduced, independenceClasses: classes, obligations, diagnostics, provenance: { inputDigest, operationCount: normalized.operations.length, reductionCount: Math.max(0, normalized.operations.length - reduced.length) } };
}
export const createConcurrencyScheduleObligations = reduceConcurrencySchedule;
export const reducePartialOrder = reduceConcurrencySchedule;
export function replayConcurrencySchedule(input, expected) { const result = reduceConcurrencySchedule(input); return { deterministic: JSON.stringify(result) === JSON.stringify(expected), result }; }
export function validateConcurrencyScheduleResult(result) { const diagnostics = []; if (result.schemaId !== CONCURRENCY_SCHEDULE_SCHEMA_ID)
    diagnostics.push(error('ATM_SCHEDULE_SCHEMA_INVALID', 'Unexpected schedule schema id.', 'schemaId')); if (!/^schedule_result_[0-9a-f]{16}$/.test(result.resultId))
    diagnostics.push(error('ATM_SCHEDULE_RESULT_ID_INVALID', 'resultId must derive from the input digest.', 'resultId')); if (result.status === 'reduced' && result.diagnostics.some((entry) => entry.severity === 'error'))
    diagnostics.push(error('ATM_SCHEDULE_FALSE_GREEN', 'A reduced schedule cannot contain error diagnostics.', 'status')); return { ok: diagnostics.length === 0, diagnostics }; }
function normalize(input) { return { scheduleId: text(input?.scheduleId), authority: { authorityId: text(input?.authority?.authorityId), sealed: input?.authority?.sealed === true, digest: text(input?.authority?.digest), version: input?.authority?.version == null ? null : text(input.authority.version) }, operations: [...(input?.operations ?? [])].map((entry) => ({ operationId: text(entry.operationId), reads: [...(entry.reads ?? [])].map(text).filter(Boolean).sort(), writes: [...(entry.writes ?? [])].map(text).filter(Boolean).sort(), dependsOn: [...(entry.dependsOn ?? [])].map(text).filter(Boolean).sort(), sourceRef: entry.sourceRef == null ? null : text(entry.sourceRef) })).sort((a, b) => a.operationId.localeCompare(b.operationId)), requestedAt: input?.requestedAt == null ? null : text(input.requestedAt) }; }
function buildEdges(operations) { const edges = []; for (let i = 0; i < operations.length; i++)
    for (let j = i + 1; j < operations.length; j++) {
        const left = operations[i], right = operations[j];
        const leftResources = new Set([...(left.reads ?? []), ...(left.writes ?? [])]);
        const rightResources = new Set([...(right.reads ?? []), ...(right.writes ?? [])]);
        const conflict = [...leftResources].some((resource) => left.writes?.includes(resource) && (right.reads?.includes(resource) || right.writes?.includes(resource)) || right.writes?.includes(resource) && left.reads?.includes(resource));
        if (conflict || right.dependsOn?.includes(left.operationId) || left.dependsOn?.includes(right.operationId))
            edges.push([left.operationId, right.operationId]);
    } return edges; }
function buildClasses(operations) { const groups = new Map(); for (const operation of operations) {
    const signature = [...(operation.reads ?? []), '|', ...(operation.writes ?? [])].join(',');
    groups.set(signature, [...(groups.get(signature) ?? []), operation.operationId]);
} return [...groups].map(([signature, operationIds]) => ({ classId: `independent_${digest(signature).slice(7, 23)}`, operationIds: operationIds.sort() })).sort((a, b) => a.classId.localeCompare(b.classId)); }
function topologicalReduction(operations, edges, diagnostics) { const indegree = new Map(operations.map((entry) => [entry.operationId, 0])); for (const [left, right] of edges)
    indegree.set(right, (indegree.get(right) ?? 0) + 1); const output = []; const pending = new Set(operations.map((entry) => entry.operationId)); while (pending.size) {
    const ready = [...pending].filter((id) => (indegree.get(id) ?? 0) === 0).sort();
    if (!ready.length) {
        diagnostics.push(error('ATM_SCHEDULE_DEPENDENCY_CYCLE', 'Schedule dependency graph contains a cycle.', 'operations', 'repair the dependency cycle before reducing'));
        break;
    }
    const selected = ready[0];
    output.push(selected);
    pending.delete(selected);
    for (const [left, right] of edges)
        if (left === selected)
            indegree.set(right, (indegree.get(right) ?? 1) - 1);
} return output; }
function digest(value) { return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`; }
function text(value) { return String(value ?? '').trim(); }
function error(code, message, ref, repairCommand = null) { return { code, severity: 'error', message, ref, repairCommand }; }
