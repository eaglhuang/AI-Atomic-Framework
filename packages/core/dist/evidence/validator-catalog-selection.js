/**
 * Validator catalog selection bridge and resumable probe scheduler.
 *
 * A task card already says what it changed — required case ids, declared
 * validators, public seams, causal impact edges. The catalog already says what
 * each test proves. What was missing is the bridge: turning "this is my impact
 * cone" into "these probes, and no others", with a stated reason for every case
 * that was left out.
 *
 * Two properties make that bridge trustworthy:
 *
 *   - Omission is explicit. A validator that is not run must carry a reason
 *     code, so a thin selection is auditable rather than merely fast.
 *   - A required case with no catalog mapping fails closed. Silently selecting
 *     nothing for it would report a clean run over an unproven boundary.
 *
 * The scheduler exists because probes are executed by something slower and less
 * reliable than this process. A run that is interrupted must resume without
 * repeating completed work or dropping pending work, and data that could not be
 * gathered must surface as an evidence request instead of a pass.
 *
 * Pure and I/O-free: callers supply the catalog snapshot and observations.
 */
import { createHash } from 'node:crypto';
export const VALIDATOR_CATALOG_SELECTION_SCHEMA_ID = 'atm.validatorCatalogSelection.v1';
export const RESUMABLE_PROBE_SCHEDULE_SCHEMA_ID = 'atm.resumableProbeSchedule.v1';
export const ATM_VALIDATOR_CATALOG_MAPPING_MISSING = 'ATM_VALIDATOR_CATALOG_MAPPING_MISSING';
export const ATM_PROBE_DATA_UNAVAILABLE = 'ATM_PROBE_DATA_UNAVAILABLE';
/** Where the shard files a repair has to touch actually live. */
const CASE_GROUP_SHARD_ROOT = 'tests/catalog/groups';
export function selectValidatorCatalogEntries(input) {
    const request = input.request;
    const requiredCaseIds = new Set(normalizeList(request.requiredTestCaseIds));
    const declaredCommands = new Set(request.validatorRefs.map((ref) => text(ref.command)).filter(Boolean));
    const declaredCaseIds = new Set(request.validatorRefs.map((ref) => text(ref.caseId)).filter(Boolean));
    const seams = new Set(normalizeList(request.changedPublicSeams));
    const edges = new Set(normalizeList(request.causalImpactEdges));
    const selected = [];
    const omitted = [];
    for (const entry of input.catalog) {
        const reasons = [];
        if (requiredCaseIds.has(entry.caseId))
            reasons.push('task-required-case');
        if (declaredCaseIds.has(entry.caseId) || (entry.command && declaredCommands.has(entry.command))) {
            reasons.push('declared-validator-ref');
        }
        if (entry.supportedSeams.some((seam) => seams.has(text(seam))))
            reasons.push('seam-overlap');
        if (entry.coversImpactEdges.some((edge) => edges.has(text(edge))))
            reasons.push('impact-edge-overlap');
        if (reasons.length === 0) {
            omitted.push({
                caseId: entry.caseId,
                groupId: entry.groupId,
                reasonCode: 'outside-impact-cone',
                reason: 'No required case id, declared validator, changed seam or causal impact edge reaches this case.'
            });
            continue;
        }
        selected.push({
            caseId: entry.caseId,
            groupId: entry.groupId,
            command: entry.command,
            responsibility: entry.responsibility,
            reasons
        });
    }
    const mappedCaseIds = new Set(input.catalog.map((entry) => entry.caseId));
    const unmappedRequiredCaseIds = [...requiredCaseIds].filter((caseId) => !mappedCaseIds.has(caseId)).sort();
    selected.sort((left, right) => left.caseId.localeCompare(right.caseId));
    omitted.sort((left, right) => left.caseId.localeCompare(right.caseId));
    return {
        schemaId: VALIDATOR_CATALOG_SELECTION_SCHEMA_ID,
        specVersion: '0.1.0',
        taskId: text(request.taskId),
        ok: unmappedRequiredCaseIds.length === 0,
        selected,
        omitted,
        unmappedRequiredCaseIds,
        // A required case the catalog does not know about cannot be scheduled, so
        // the selection reports the gap instead of quietly proving less.
        failClosed: unmappedRequiredCaseIds.length === 0 ? null : {
            code: ATM_VALIDATOR_CATALOG_MAPPING_MISSING,
            summary: `Task ${text(request.taskId)} requires ${unmappedRequiredCaseIds.length} test case id(s) with no catalog mapping: ${unmappedRequiredCaseIds.join(', ')}.`,
            requiredCommand: `node atm.mjs evidence validators --task ${text(request.taskId)} --list --json`,
            repairHint: `Register the missing case id(s) in a group shard under ${CASE_GROUP_SHARD_ROOT}/ before selecting probes.`
        },
        selectionDigest: digest({
            taskId: text(request.taskId),
            selected: selected.map((entry) => ({ caseId: entry.caseId, reasons: entry.reasons })),
            omitted: omitted.map((entry) => ({ caseId: entry.caseId, reasonCode: entry.reasonCode })),
            unmappedRequiredCaseIds
        })
    };
}
export function planResumableProbeSchedule(input) {
    const probes = input.selection.selected.map((entry) => ({
        probeId: `probe:${entry.caseId}`,
        caseId: entry.caseId,
        command: entry.command,
        status: 'pending',
        attempts: 0,
        detail: null
    }));
    return assembleSchedule({
        taskId: input.selection.taskId,
        scheduleId: text(input.scheduleId),
        probes,
        duplicateObservationIds: [],
        unknownObservationIds: []
    });
}
/**
 * Fold observations into a schedule. Resume is a pure function of the schedule
 * plus what was observed, so an interrupted run reaches the same state whether
 * it is replayed in one pass or resumed a step at a time.
 */
export function resumeProbeSchedule(input) {
    const byId = new Map(input.schedule.probes.map((probe) => [probe.probeId, probe]));
    const duplicates = [];
    const unknown = [];
    for (const observation of input.observations) {
        const probe = byId.get(text(observation.probeId));
        if (!probe) {
            // Adopting a probe this schedule never planned would let unrelated work
            // count towards this task's coverage.
            unknown.push(text(observation.probeId));
            continue;
        }
        // An observation that restates the status a probe already has is a
        // re-delivery, not a second attempt. `pending` is never observed, so this
        // cannot swallow a first result.
        if (probe.status === observation.status) {
            duplicates.push(probe.probeId);
            continue;
        }
        byId.set(probe.probeId, {
            ...probe,
            status: observation.status,
            attempts: probe.attempts + 1,
            detail: normalizeNullable(observation.detail)
        });
    }
    return assembleSchedule({
        taskId: input.schedule.taskId,
        scheduleId: input.schedule.scheduleId,
        probes: input.schedule.probes.map((probe) => byId.get(probe.probeId) ?? probe),
        duplicateObservationIds: duplicates.sort(),
        unknownObservationIds: unknown.sort()
    });
}
function assembleSchedule(input) {
    const counts = { completed: 0, pending: 0, unavailable: 0, failed: 0 };
    for (const probe of input.probes)
        counts[probe.status] += 1;
    // Unresolved means "still owed": pending work first, then data that could not
    // be gathered. Both keep the run resumable; neither may read as complete.
    const owed = input.probes.find((probe) => probe.status === 'pending')
        ?? input.probes.find((probe) => probe.status === 'unavailable')
        ?? null;
    const evidenceRequests = input.probes
        .filter((probe) => probe.status === 'unavailable')
        .map((probe) => ({
        code: ATM_PROBE_DATA_UNAVAILABLE,
        probeId: probe.probeId,
        caseId: probe.caseId,
        summary: probe.detail
            ? `Probe ${probe.caseId} could not be observed: ${probe.detail}.`
            : `Probe ${probe.caseId} could not be observed.`,
        requiredCommand: `node atm.mjs evidence run --task ${input.taskId} --actor <id> --command "${probe.command ?? probe.caseId}" --json`
    }));
    const verdict = counts.failed > 0
        ? 'blocked'
        : owed ? 'incomplete' : 'complete';
    const body = {
        taskId: input.taskId,
        scheduleId: input.scheduleId,
        probes: input.probes,
        cursor: {
            nextProbeId: owed?.probeId ?? null,
            completed: counts.completed,
            pending: counts.pending,
            unavailable: counts.unavailable,
            failed: counts.failed
        },
        verdict
    };
    return {
        schemaId: RESUMABLE_PROBE_SCHEDULE_SCHEMA_ID,
        specVersion: '0.1.0',
        ...body,
        // A blocked run is terminal because a failing probe is a result; an
        // incomplete one stays open because work or data is still owed.
        terminal: verdict !== 'incomplete',
        evidenceRequests,
        duplicateObservationIds: input.duplicateObservationIds,
        unknownObservationIds: input.unknownObservationIds,
        scheduleDigest: digest(body)
    };
}
function normalizeList(values) {
    return [...new Set(values.map(text).filter(Boolean))].sort();
}
function digest(value) {
    return `sha256:${createHash('sha256').update(stableStringify(value)).digest('hex')}`;
}
function stableStringify(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
    const record = value;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
function text(value) {
    return String(value ?? '').trim();
}
function normalizeNullable(value) {
    const normalized = text(value);
    return normalized.length > 0 ? normalized : null;
}
