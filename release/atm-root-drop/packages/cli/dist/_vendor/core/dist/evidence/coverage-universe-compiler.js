import { createHash } from 'node:crypto';
import { createObligationInventory } from './obligation-inventory.js';
export const COVERAGE_UNIVERSE_SCHEMA_ID = 'atm.coverageUniverse.v1';
export const COVERAGE_UNIVERSE_COMPILER_ID = 'atm.coverageUniverseCompiler.v1';
export class CoverageUniverseCompiler {
    compile(input) {
        return compileCoverageUniverse(input);
    }
}
export function compileCoverageUniverse(input) {
    const model = normalizeModel(input.model);
    const normalizedInputs = normalizeObligationInputs(input.obligations);
    const inventory = createObligationInventory({
        inventoryId: `${normalizeText(input.universeId)}:obligations`,
        modelId: model.modelId,
        generatedAt: normalizeText(input.generatedAt),
        entries: normalizedInputs.map((entry) => ({
            obligationId: canonicalObligationId(entry),
            semanticFamily: entry.semanticFamily,
            owningSeam: entry.owningSeam,
            lifecycleStatus: entry.reachabilityStatus === 'excluded' ? 'excluded' : 'active',
            sourceRefs: entry.sourceRefs,
            validatorRefs: entry.validatorRefs,
            description: entry.description,
            observedAt: entry.observedAt
        }))
    });
    const inventoryEntriesById = new Map(inventory.entries.map((entry) => [entry.obligationId, entry]));
    const entries = normalizedInputs
        .map((entry) => {
        const obligationId = canonicalObligationId(entry);
        const inventoryEntry = inventoryEntriesById.get(obligationId);
        if (!inventoryEntry) {
            throw new Error(`Coverage universe compiler lost obligation ${obligationId}`);
        }
        return {
            obligationId,
            semanticKey: entry.semanticKey,
            semanticFamily: entry.semanticFamily,
            owningSeam: entry.owningSeam,
            reachabilityStatus: entry.reachabilityStatus,
            sourceRefs: entry.sourceRefs,
            validatorRefs: entry.validatorRefs,
            description: entry.description,
            exclusionReason: entry.exclusionReason,
            inventoryEntryDigest: inventoryEntry.entryDigest,
            gapKind: gapKindFor(entry.reachabilityStatus)
        };
    })
        .sort((left, right) => left.obligationId.localeCompare(right.obligationId));
    const gapCandidates = entries
        .filter((entry) => entry.gapKind !== 'none')
        .map((entry) => ({
        obligationId: entry.obligationId,
        semanticFamily: entry.semanticFamily,
        owningSeam: entry.owningSeam,
        reachabilityStatus: entry.reachabilityStatus,
        reason: gapReason(entry),
        candidateTestCaseId: candidateTestCaseId(entry)
    }));
    const reachabilitySummary = summarizeReachability(entries);
    const universeDigest = digestCanonical({
        universeId: normalizeText(input.universeId),
        model,
        inventoryDigest: inventory.inventoryDigest,
        entries: entries.map((entry) => ({
            obligationId: entry.obligationId,
            semanticKey: entry.semanticKey,
            semanticFamily: entry.semanticFamily,
            owningSeam: entry.owningSeam,
            reachabilityStatus: entry.reachabilityStatus,
            sourceRefs: entry.sourceRefs,
            validatorRefs: entry.validatorRefs,
            description: entry.description,
            exclusionReason: entry.exclusionReason,
            inventoryEntryDigest: entry.inventoryEntryDigest,
            gapKind: entry.gapKind
        })),
        gapCandidates,
        reachabilitySummary
    });
    return {
        schemaId: COVERAGE_UNIVERSE_SCHEMA_ID,
        specVersion: '0.1.0',
        compilerId: COVERAGE_UNIVERSE_COMPILER_ID,
        universeId: normalizeText(input.universeId),
        generatedAt: normalizeText(input.generatedAt),
        model,
        entries,
        obligationInventory: inventory,
        gapCandidates,
        reachabilitySummary,
        universeDigest
    };
}
function canonicalObligationId(input) {
    const readable = [
        slug(input.semanticFamily),
        slug(input.owningSeam),
        slug(input.semanticKey)
    ].filter(Boolean).join('.');
    const digest = digestCanonical({
        semanticKey: input.semanticKey,
        semanticFamily: input.semanticFamily,
        owningSeam: input.owningSeam,
        sourceRefs: input.sourceRefs
    }).slice('sha256:'.length, 'sha256:'.length + 12);
    return `atm.obligation:${readable}:${digest}`;
}
function normalizeObligationInputs(values) {
    return values
        .map((entry) => ({
        semanticKey: normalizeText(entry.semanticKey),
        semanticFamily: normalizeText(entry.semanticFamily),
        owningSeam: normalizeText(entry.owningSeam),
        reachabilityStatus: entry.reachabilityStatus,
        sourceRefs: normalizeSourceRefs(entry.sourceRefs),
        validatorRefs: normalizeValidatorRefs(entry.validatorRefs),
        description: normalizeNullableText(entry.description),
        observedAt: normalizeNullableText(entry.observedAt),
        exclusionReason: normalizeNullableText(entry.exclusionReason)
    }))
        .filter((entry) => entry.semanticKey && entry.semanticFamily && entry.owningSeam)
        .sort((left, right) => left.semanticFamily.localeCompare(right.semanticFamily)
        || left.owningSeam.localeCompare(right.owningSeam)
        || left.semanticKey.localeCompare(right.semanticKey));
}
function normalizeModel(input) {
    return {
        modelId: normalizeText(input.modelId),
        modelVersion: normalizeNullableText(input.modelVersion),
        modelDigest: normalizeNullableText(input.modelDigest)
    };
}
function normalizeSourceRefs(values = []) {
    return values
        .map((entry) => ({ kind: entry.kind, ref: normalizeText(entry.ref) }))
        .filter((entry) => entry.ref)
        .sort((left, right) => left.kind.localeCompare(right.kind) || left.ref.localeCompare(right.ref));
}
function normalizeValidatorRefs(values = []) {
    return values
        .map((entry) => ({ command: normalizeText(entry.command), caseId: normalizeNullableText(entry.caseId) }))
        .filter((entry) => entry.command)
        .sort((left, right) => left.command.localeCompare(right.command) || String(left.caseId ?? '').localeCompare(String(right.caseId ?? '')));
}
function gapKindFor(status) {
    if (status === 'reachable')
        return 'none';
    if (status === 'unreachable')
        return 'gap';
    return status;
}
function gapReason(entry) {
    if (entry.reachabilityStatus === 'unreachable')
        return 'Obligation is known but no reachable validator or execution path covers it.';
    if (entry.reachabilityStatus === 'unsupported')
        return 'Obligation belongs to a seam the current model cannot exercise.';
    if (entry.reachabilityStatus === 'excluded')
        return entry.exclusionReason ?? 'Obligation is explicitly excluded from this coverage universe.';
    return 'Obligation reachability is unknown and needs discovery or test generation.';
}
function candidateTestCaseId(entry) {
    const digest = digestCanonical({
        obligationId: entry.obligationId,
        reachabilityStatus: entry.reachabilityStatus,
        owningSeam: entry.owningSeam
    }).slice('sha256:'.length, 'sha256:'.length + 8);
    return `test_candidate_${slug(entry.semanticFamily)}_${slug(entry.owningSeam)}_${digest}`;
}
function summarizeReachability(entries) {
    const summary = {
        reachable: 0,
        unreachable: 0,
        unsupported: 0,
        excluded: 0,
        unknown: 0
    };
    for (const entry of entries) {
        summary[entry.reachabilityStatus] += 1;
    }
    return summary;
}
function digestCanonical(value) {
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
function slug(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);
}
function normalizeText(value) {
    return String(value ?? '').trim();
}
function normalizeNullableText(value) {
    const normalized = normalizeText(value);
    return normalized.length > 0 ? normalized : null;
}
