/**
 * Mutation adapter, replayable lineage, and equivalence governance.
 *
 * Plan 4.0 mutation evidence must come from a pinned adapter that only runs
 * inside an ATM-GOV-0285-selected probe window. Observations become replayable
 * lineage records (mutant id, killed/survived, score bounds, seed/digest) and
 * survivors are classified as equivalent or non-equivalent.
 *
 * Raw adapter "pass" never authorizes close. Unsupported or inconclusive
 * adapters fail closed. Downstream family matching (ATM-GOV-0293) may consume
 * lineage as supporting evidence only — never as the sole matching authority.
 *
 * Pure and I/O-free: callers supply the probe window and observations.
 */
import { createHash } from 'node:crypto';
export const MUTATION_ADAPTER_SCHEMA_ID = 'atm.mutationAdapter.v1';
export const MUTATION_LINEAGE_SCHEMA_ID = 'atm.mutationLineage.v1';
export const MUTATION_EQUIVALENCE_GOVERNANCE_SCHEMA_ID = 'atm.mutationEquivalenceGovernance.v1';
export const MUTATION_FAMILY_MATCH_EVIDENCE_SCHEMA_ID = 'atm.mutationLineageFamilyMatchEvidence.v1';
export const PINNED_IN_PROCESS_MUTATION_ADAPTER_ID = 'atm.mutation.adapter.inProcessFixture.v1';
export const ATM_MUTATION_ADAPTER_UNSUPPORTED = 'ATM_MUTATION_ADAPTER_UNSUPPORTED';
export const ATM_MUTATION_ADAPTER_INCONCLUSIVE = 'ATM_MUTATION_ADAPTER_INCONCLUSIVE';
export const ATM_MUTATION_PROBE_WINDOW_VIOLATION = 'ATM_MUTATION_PROBE_WINDOW_VIOLATION';
export const ATM_MUTATION_LINEAGE_REPLAY_MISMATCH = 'ATM_MUTATION_LINEAGE_REPLAY_MISMATCH';
export function createPinnedInProcessMutationAdapter(input) {
    const pin = text(input.pin);
    if (!pin) {
        throw new Error('Pinned mutation adapter requires a non-empty pin.');
    }
    return {
        schemaId: MUTATION_ADAPTER_SCHEMA_ID,
        adapterId: PINNED_IN_PROCESS_MUTATION_ADAPTER_ID,
        pin,
        capability: input.capability ?? 'supported',
        detail: input.detail ?? null
    };
}
export function classifySurvivorEquivalence(input) {
    if (input.outcome === 'killed')
        return 'not-applicable';
    const observed = text(input.behavioralDigest);
    const original = text(input.originalBehavioralDigest);
    if (!observed || !original)
        return 'non-equivalent';
    return observed === original ? 'equivalent' : 'non-equivalent';
}
export function runMutationAdapter(input) {
    const taskId = text(input.probeWindow.taskId);
    const selectionDigest = text(input.probeWindow.selectionDigest);
    const allowed = new Set(input.probeWindow.allowedProbeIds.map((id) => text(id)).filter(Boolean));
    const adapterId = text(input.adapter.adapterId);
    const adapterPin = text(input.adapter.pin);
    if (input.adapter.capability === 'unsupported') {
        return terminalFailClosed({
            taskId,
            selectionDigest,
            adapterId,
            adapterPin,
            code: ATM_MUTATION_ADAPTER_UNSUPPORTED,
            summary: `Mutation adapter ${adapterId} is unsupported for this runtime.`,
            repairHint: 'Install or select a pinned supported mutation adapter before scoring mutants.'
        });
    }
    if (input.adapter.capability === 'inconclusive') {
        return terminalFailClosed({
            taskId,
            selectionDigest,
            adapterId,
            adapterPin,
            code: ATM_MUTATION_ADAPTER_INCONCLUSIVE,
            summary: `Mutation adapter ${adapterId} returned an inconclusive capability status.`,
            repairHint: 'Re-run with a conclusive pinned adapter; inconclusive results must not pass.'
        });
    }
    if (!selectionDigest || allowed.size === 0) {
        return terminalFailClosed({
            taskId,
            selectionDigest,
            adapterId,
            adapterPin,
            code: ATM_MUTATION_PROBE_WINDOW_VIOLATION,
            summary: 'Mutation adapter requires a non-empty ATM-GOV-0285 selection digest and allowed probe ids.',
            repairHint: 'Obtain a validator-catalog selection / resumable probe schedule before mutation.'
        });
    }
    const outside = input.observations
        .map((obs) => text(obs.probeId))
        .filter((probeId) => !allowed.has(probeId));
    if (outside.length > 0) {
        return terminalFailClosed({
            taskId,
            selectionDigest,
            adapterId,
            adapterPin,
            code: ATM_MUTATION_PROBE_WINDOW_VIOLATION,
            summary: `Mutation observations reference probe id(s) outside the selected window: ${[...new Set(outside)].sort().join(', ')}.`,
            repairHint: 'Restrict mutation execution to ATM-GOV-0285-selected probe ids only.'
        });
    }
    const sorted = [...input.observations].sort((a, b) => text(a.mutantId).localeCompare(text(b.mutantId)));
    const preliminary = sorted.map((obs) => {
        const equivalence = classifySurvivorEquivalence(obs);
        return {
            mutantId: text(obs.mutantId),
            probeId: text(obs.probeId),
            outcome: obs.outcome,
            equivalence,
            seed: text(obs.seed)
        };
    });
    const bounds = computeBounds(preliminary);
    const records = preliminary.map((entry) => {
        const digest = digestValue({
            mutantId: entry.mutantId,
            probeId: entry.probeId,
            outcome: entry.outcome,
            equivalence: entry.equivalence,
            seed: entry.seed,
            selectionDigest,
            adapterId,
            adapterPin,
            lowerBound: bounds.lowerBound,
            upperBound: bounds.upperBound
        });
        return {
            mutantId: entry.mutantId,
            probeId: entry.probeId,
            outcome: entry.outcome,
            equivalence: entry.equivalence,
            lowerBound: bounds.lowerBound,
            upperBound: bounds.upperBound,
            seed: entry.seed,
            digest: `sha256:${digest}`
        };
    });
    const lineageDigest = `sha256:${digestValue({
        taskId,
        selectionDigest,
        adapterId,
        adapterPin,
        bounds,
        records: records.map((record) => ({
            mutantId: record.mutantId,
            probeId: record.probeId,
            outcome: record.outcome,
            equivalence: record.equivalence,
            seed: record.seed,
            digest: record.digest
        }))
    })}`;
    return {
        schemaId: MUTATION_LINEAGE_SCHEMA_ID,
        specVersion: '0.1.0',
        adapterSchemaId: MUTATION_ADAPTER_SCHEMA_ID,
        equivalenceSchemaId: MUTATION_EQUIVALENCE_GOVERNANCE_SCHEMA_ID,
        taskId,
        selectionDigest,
        adapterId,
        adapterPin,
        ok: true,
        // Even a clean mutation run never becomes close authority by itself.
        verdict: 'evidence-ready',
        closeAuthorization: 'denied',
        failClosed: null,
        records,
        bounds,
        lineageDigest
    };
}
export function replayMutationLineage(input) {
    // Replay identity is the lineage digest of the sealed stream. Recompute from
    // records alone so auditors do not need the original adapter process.
    const first = `sha256:${digestValue({
        taskId: input.report.taskId,
        selectionDigest: input.report.selectionDigest,
        adapterId: input.report.adapterId,
        adapterPin: input.report.adapterPin,
        bounds: input.report.bounds,
        records: input.report.records.map((record) => ({
            mutantId: record.mutantId,
            probeId: record.probeId,
            outcome: record.outcome,
            equivalence: record.equivalence,
            seed: record.seed,
            digest: record.digest
        }))
    })}`;
    const second = `sha256:${digestValue({
        taskId: input.report.taskId,
        selectionDigest: input.report.selectionDigest,
        adapterId: input.report.adapterId,
        adapterPin: input.report.adapterPin,
        bounds: input.report.bounds,
        records: input.report.records.map((record) => ({
            mutantId: record.mutantId,
            probeId: record.probeId,
            outcome: record.outcome,
            equivalence: record.equivalence,
            seed: record.seed,
            digest: record.digest
        }))
    })}`;
    const ok = first === input.report.lineageDigest && first === second;
    return {
        ok,
        deterministic: first === second,
        expectedLineageDigest: input.report.lineageDigest,
        recomputedLineageDigest: first,
        failClosed: ok
            ? null
            : {
                code: ATM_MUTATION_LINEAGE_REPLAY_MISMATCH,
                summary: 'Mutation lineage digest does not replay from sealed records.',
                repairHint: 'Refuse close and re-run the pinned adapter inside the selected probe window.'
            }
    };
}
export function toFamilyMatchEvidence(report) {
    return {
        schemaId: MUTATION_FAMILY_MATCH_EVIDENCE_SCHEMA_ID,
        specVersion: '0.1.0',
        lineageDigest: report.lineageDigest,
        soleMatchingAuthority: false,
        authorityRole: 'supporting-evidence-only',
        mayStrengthenOrWeakenConfidence: true,
        survivors: report.records
            .filter((record) => record.outcome === 'survived')
            .map((record) => ({
            mutantId: record.mutantId,
            equivalence: record.equivalence === 'equivalent' ? 'equivalent' : 'non-equivalent',
            digest: record.digest
        })),
        killedMutantIds: report.records
            .filter((record) => record.outcome === 'killed')
            .map((record) => record.mutantId)
            .sort()
    };
}
function computeBounds(entries) {
    const total = entries.length;
    let killed = 0;
    let survived = 0;
    let equivalent = 0;
    let nonEquivalent = 0;
    for (const entry of entries) {
        if (entry.outcome === 'killed') {
            killed += 1;
            continue;
        }
        survived += 1;
        if (entry.equivalence === 'equivalent')
            equivalent += 1;
        else
            nonEquivalent += 1;
    }
    // Lower bound treats every survivor as harmful; upper bound forgives equivalents.
    const lowerBound = total === 0 ? 0 : killed / total;
    const upperBound = total === 0 ? 0 : (killed + equivalent) / total;
    return {
        killed,
        survived,
        equivalent,
        nonEquivalent,
        total,
        lowerBound,
        upperBound
    };
}
function terminalFailClosed(input) {
    const bounds = {
        killed: 0,
        survived: 0,
        equivalent: 0,
        nonEquivalent: 0,
        total: 0,
        lowerBound: 0,
        upperBound: 0
    };
    const failClosed = {
        code: input.code,
        summary: input.summary,
        repairHint: input.repairHint
    };
    return {
        schemaId: MUTATION_LINEAGE_SCHEMA_ID,
        specVersion: '0.1.0',
        adapterSchemaId: MUTATION_ADAPTER_SCHEMA_ID,
        equivalenceSchemaId: MUTATION_EQUIVALENCE_GOVERNANCE_SCHEMA_ID,
        taskId: input.taskId,
        selectionDigest: input.selectionDigest,
        adapterId: input.adapterId,
        adapterPin: input.adapterPin,
        ok: false,
        verdict: 'fail-closed',
        closeAuthorization: 'denied',
        failClosed,
        records: [],
        bounds,
        lineageDigest: `sha256:${digestValue({
            taskId: input.taskId,
            selectionDigest: input.selectionDigest,
            adapterId: input.adapterId,
            failClosed
        })}`
    };
}
function text(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function digestValue(value) {
    return createHash('sha256').update(stableStringify(value)).digest('hex');
}
function stableStringify(value) {
    if (value === null || typeof value !== 'object')
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
    const record = value;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`;
}
