import { createHash } from 'node:crypto';
export const CAUSAL_REGRESSION_FAMILY_SCHEMA_ID = 'atm.causalRegressionFamily.v1';
export const REGRESSION_FAMILY_REVISION_SCHEMA_ID = 'atm.regressionFamilyRevision.v1';
export const REGRESSION_FAMILY_CATALOG_SCHEMA_ID = 'atm.regressionFamilyCatalogProjection.v1';
export const REGRESSION_FAMILY_SELECTION_SCHEMA_ID = 'atm.regressionFamilySelection.v1';
export function observeRegressionFamily(input) {
    const n = normalizeObserve(input);
    const diagnostics = [];
    if (!n.incidentRef || !n.fingerprint || !n.rootMechanism)
        diagnostics.push('incomplete-observation');
    if (!Number.isFinite(n.confidence) || n.confidence < 0 || n.confidence > 1)
        diagnostics.push('invalid-confidence');
    if (!n.requiredCaseIds.length)
        diagnostics.push('missing-required-case-ids');
    const prior = n.existingRevisions.filter((r) => r.family.fingerprint === n.fingerprint);
    const familyId = prior[0]?.family.familyId ?? `family-${shortDigest({ fingerprint: n.fingerprint, rootMechanism: n.rootMechanism })}`;
    const parentRevision = prior.at(-1)?.revisionId ?? null;
    const revisionId = `revision-${shortDigest({ familyId, incidentRef: n.incidentRef, parentRevision })}`;
    const neighbors = unique([...n.causalNeighborhood, ...n.factorConstraints]);
    const family = { familyId, fingerprint: n.fingerprint, rootMechanism: n.rootMechanism, causalNeighborhood: neighbors, factorConstraints: n.factorConstraints, generatedCaseIds: unique(n.generatedCaseIds), requiredCaseIds: unique(n.requiredCaseIds), sourceIncidentRefs: unique([...prior.flatMap((r) => r.family.sourceIncidentRefs), n.incidentRef]), confidence: n.confidence, parentRevision, impactSignals: unique(n.impactSignals), digest: digest({ familyId, fingerprint: n.fingerprint, rootMechanism: n.rootMechanism, causalNeighborhood: neighbors, factorConstraints: n.factorConstraints, generatedCaseIds: unique(n.generatedCaseIds), requiredCaseIds: unique(n.requiredCaseIds), sourceIncidentRefs: unique([...prior.flatMap((r) => r.family.sourceIncidentRefs), n.incidentRef]), confidence: n.confidence, parentRevision, impactSignals: unique(n.impactSignals) }) };
    const revision = { schemaId: REGRESSION_FAMILY_REVISION_SCHEMA_ID, revisionId, parentRevision, family, recurrence: prior.length > 0, lineage: [...prior.map((r) => r.revisionId), revisionId], observedIncidentRef: n.incidentRef, digest: digest({ revisionId, parentRevision, family, recurrence: prior.length > 0, lineage: [...prior.map((r) => r.revisionId), revisionId], observedIncidentRef: n.incidentRef }) };
    const status = diagnostics.length ? 'contradictory' : 'proven';
    const revisions = [...n.existingRevisions, revision];
    const repairCommand = status === 'proven' ? null : 'repair the incident mapping and provide required case ids before observing the family';
    return { schemaId: REGRESSION_FAMILY_REVISION_SCHEMA_ID, status, revision: status === 'proven' ? revision : null, revisions, diagnostics, repairCommand, resultDigest: digest({ status, revision: status === 'proven' ? revision : null, revisions, diagnostics, repairCommand }) };
}
export function selectRegressionFamilies(input) {
    const n = normalizeSelect(input);
    const diagnostics = [...n.mappingConflicts.map((x) => `mapping-conflict:${x}`)];
    const omitted = [];
    const selectedFamilyIds = [];
    const known = new Set(n.knownFamilyIds.length ? n.knownFamilyIds : n.families.map((f) => f.familyId));
    for (const family of n.families) {
        if (!known.has(family.familyId)) {
            diagnostics.push(`unknown-family:${family.familyId}`);
            omitted.push({ familyId: family.familyId, reasonCode: 'unknown-family-mapping' });
            continue;
        }
        const signals = new Set([...n.impactCone.publicSeams, ...n.impactCone.causalImpactEdges, ...n.impactCone.changedFiles, ...n.impactCone.validatorReferences, ...n.impactCone.testCaseIds]);
        if (family.impactSignals.some((signal) => signals.has(signal)) || family.requiredCaseIds.some((id) => signals.has(id)) || family.generatedCaseIds.some((id) => signals.has(id)))
            selectedFamilyIds.push(family.familyId);
        else
            omitted.push({ familyId: family.familyId, reasonCode: 'outside-impact-cone' });
    }
    if (n.mappingConflicts.length || diagnostics.some((d) => d.startsWith('unknown-family:')))
        diagnostics.push('mapping-repair-required');
    const status = diagnostics.length ? 'blocked' : 'proven';
    const repairCommand = status === 'proven' ? null : 'repair family-to-impact-cone mappings before selective routing';
    const selectionDigest = digest({ selectedFamilyIds: unique(selectedFamilyIds), omitted, impactCone: n.impactCone, status, diagnostics });
    return { schemaId: REGRESSION_FAMILY_SELECTION_SCHEMA_ID, status, selectedFamilyIds: unique(selectedFamilyIds), omitted, diagnostics, repairCommand, selectionDigest };
}
export function projectRegressionFamilyCatalog(input) {
    const revisions = [...input.revisions].sort((a, b) => a.revisionId.localeCompare(b.revisionId));
    const families = uniqueFamilies(revisions.map((r) => r.family));
    const selection = selectRegressionFamilies({ ...input.selection, families });
    const diagnostics = [...selection.diagnostics];
    const status = selection.status;
    const familyRevisionDigest = digest(revisions);
    const resultDigest = digest({ families, revisions, selection, familyRevisionDigest, status, diagnostics });
    return { schemaId: REGRESSION_FAMILY_CATALOG_SCHEMA_ID, status, families, revisions, selection, familyRevisionDigest, selectionDigest: selection.selectionDigest, diagnostics, resultDigest };
}
export function replayRegressionFamilyRevision(result) { return result.revision ? observeRegressionFamily({ incidentRef: result.revision.observedIncidentRef, fingerprint: result.revision.family.fingerprint, rootMechanism: result.revision.family.rootMechanism, causalNeighborhood: result.revision.family.causalNeighborhood, factorConstraints: result.revision.family.factorConstraints, generatedCaseIds: result.revision.family.generatedCaseIds, requiredCaseIds: result.revision.family.requiredCaseIds, confidence: result.revision.family.confidence, impactSignals: result.revision.family.impactSignals, existingRevisions: result.revisions.slice(0, -1) }) : result; }
export function validateRegressionFamilyRevision(result) { const replay = replayRegressionFamilyRevision(result); return { ok: result.status === 'proven' && replay.resultDigest === result.resultDigest, diagnostics: result.status === 'proven' && replay.resultDigest !== result.resultDigest ? ['result-digest-mismatch'] : [...result.diagnostics] }; }
function normalizeObserve(i) { return { incidentRef: String(i.incidentRef ?? '').trim(), fingerprint: String(i.fingerprint ?? '').trim(), rootMechanism: String(i.rootMechanism ?? '').trim(), causalNeighborhood: [...(i.causalNeighborhood ?? [])].map(String).sort(), factorConstraints: [...(i.factorConstraints ?? [])].map(String).sort(), generatedCaseIds: [...(i.generatedCaseIds ?? [])].map(String).sort(), requiredCaseIds: [...(i.requiredCaseIds ?? [])].map(String).sort(), confidence: Number(i.confidence), impactSignals: [...(i.impactSignals ?? [])].map(String).sort(), existingRevisions: [...(i.existingRevisions ?? [])].sort((a, b) => a.revisionId.localeCompare(b.revisionId)) }; }
function normalizeSelect(i) { return { families: [...(i.families ?? [])].sort((a, b) => a.familyId.localeCompare(b.familyId)), impactCone: { publicSeams: [...(i.impactCone?.publicSeams ?? [])].map(String).sort(), causalImpactEdges: [...(i.impactCone?.causalImpactEdges ?? [])].map(String).sort(), changedFiles: [...(i.impactCone?.changedFiles ?? [])].map(String).sort(), validatorReferences: [...(i.impactCone?.validatorReferences ?? [])].map(String).sort(), testCaseIds: [...(i.impactCone?.testCaseIds ?? [])].map(String).sort() }, knownFamilyIds: [...(i.knownFamilyIds ?? [])].map(String).sort(), mappingConflicts: [...(i.mappingConflicts ?? [])].map(String).sort() }; }
function unique(values) { return [...new Set(values)].sort(); }
function uniqueFamilies(values) { return [...new Map(values.map((f) => [f.familyId, f])).values()].sort((a, b) => a.familyId.localeCompare(b.familyId)); }
function shortDigest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12); }
function digest(value) { return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`; }
