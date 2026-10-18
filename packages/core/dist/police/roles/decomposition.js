import { filterEligibleForDecomposition } from '../../source-inventory/source-inventory.js';
import { buildDecompositionSuppressionKey } from '../suppression-keys.js';
import { DEFAULT_POLICE_DAILY_CAP } from '../constants.js';
import { makeEvidenceRef, makePoliceFinding, makePoliceFamilyReport, sanitizeId } from '../shared.js';
export function runDecompositionPolice(input = {}) {
    const inventory = input.inventory;
    if (!inventory) {
        return makePoliceFamilyReport({
            family: 'decomposition',
            mode: 'advisory',
            status: 'skipped',
            findings: [],
            sourceValidator: 'runDecompositionPolice'
        });
    }
    const threshold = input.maxFileLines ?? inventory.maxFileLines;
    const suppressed = new Set(input.suppressedFilePaths ?? []);
    const dailyCap = input.dailyCap ?? DEFAULT_POLICE_DAILY_CAP;
    const findings = [];
    const eligible = filterEligibleForDecomposition({ ...inventory, maxFileLines: threshold });
    let emitted = 0;
    for (const entry of eligible) {
        if (suppressed.has(entry.filePath)) {
            continue;
        }
        if (emitted >= dailyCap) {
            findings.push(makePoliceFinding({
                findingId: `police.decomposition.daily-cap.${sanitizeId(entry.filePath)}`,
                policeFamily: 'decomposition',
                severity: 'info',
                trigger: 'oversized-source-surface',
                scope: entry.filePath,
                action: 'monitor',
                routeHint: 'observation.daily-cap',
                readModel: 'SourceInventoryReport',
                message: `Daily proposal cap (${dailyCap}) reached; further oversized-source-surface findings observed only.`,
                evidenceRefs: [makeEvidenceRef('source-inventory', 'police-artifact')],
                metadata: {
                    dailyCap,
                    filePath: entry.filePath,
                    suppressionKey: buildDecompositionSuppressionKey(entry),
                    directApplyAllowed: false
                }
            }));
            continue;
        }
        findings.push(makePoliceFinding({
            findingId: `police.decomposition.oversized-source-surface.${sanitizeId(entry.filePath)}`,
            policeFamily: 'decomposition',
            severity: 'advisory',
            trigger: 'oversized-source-surface',
            scope: entry.filePath,
            action: 'proposal-draft',
            routeHint: 'behavior.atomize',
            readModel: 'SourceInventoryReport',
            message: `${entry.filePath} has ${entry.lineCount} LOC (threshold ${threshold}); recommend decomposition plan + atomic-map replacement.`,
            evidenceRefs: [makeEvidenceRef('source-inventory', 'police-artifact')],
            metadata: {
                lineCount: entry.lineCount,
                threshold,
                legacyUri: entry.legacyUri ?? entry.filePath,
                language: entry.language ?? 'unknown',
                entrypointHint: entry.entrypointHint ?? null,
                suggestedRoute: ['behavior.atomize', 'behavior.compose'],
                suggestedMapReplacement: true,
                decompositionPlanHint: {
                    legacyUris: [entry.legacyUri ?? entry.filePath],
                    proposedMembers: entry.exportedSymbols ?? [],
                    entrypoints: entry.entrypointHint ? [entry.entrypointHint] : []
                },
                suppressionKey: buildDecompositionSuppressionKey(entry),
                directApplyAllowed: false
            }
        }));
        emitted += 1;
    }
    return makePoliceFamilyReport({
        family: 'decomposition',
        mode: 'advisory',
        status: 'pass',
        findings,
        sourceValidator: 'runDecompositionPolice'
    });
}
export function buildDecompositionPlanHintDraft(finding) {
    if (finding.policeFamily !== 'decomposition' || finding.trigger !== 'oversized-source-surface') {
        return { ok: false, errors: ['finding-not-decomposition-oversized-source-surface'] };
    }
    const hint = finding.metadata?.decompositionPlanHint;
    const errors = [];
    if (!hint?.legacyUris || hint.legacyUris.length === 0) {
        errors.push('missing-replacement-legacyUris');
    }
    if (!hint?.entrypoints || hint.entrypoints.length === 0) {
        errors.push('missing-entrypoints');
    }
    if (errors.length > 0) {
        return { ok: false, errors };
    }
    const legacyUris = hint?.legacyUris ?? [];
    const proposedMembers = (hint?.proposedMembers ?? []).filter((entry) => typeof entry === 'string');
    const entrypoints = hint?.entrypoints ?? [];
    return {
        ok: true,
        errors: [],
        draft: {
            schemaId: 'atm.decompositionPlanDraft',
            specVersion: '0.1.0',
            mode: 'draft',
            legacyUris: [...legacyUris],
            proposedMembers: [...proposedMembers],
            entrypoints: [...entrypoints]
        }
    };
}
