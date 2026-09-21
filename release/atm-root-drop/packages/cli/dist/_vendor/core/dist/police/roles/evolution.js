import { buildEvolutionSuppressionKey } from '../suppression-keys.js';
import { DEFAULT_POLICE_DAILY_CAP } from '../constants.js';
import { makeEvidenceRef, makePoliceFinding, makePoliceFamilyReport, sanitizeId } from '../shared.js';
export const DEFAULT_EVOLUTION_RECURRENCE_THRESHOLD = 2;
export const DEFAULT_EVOLUTION_CONFIDENCE_THRESHOLD = 0.6;
export function runEvolutionPolice(input = {}) {
    const recurrenceThreshold = input.recurrenceThreshold ?? DEFAULT_EVOLUTION_RECURRENCE_THRESHOLD;
    const confidenceThreshold = input.confidenceThreshold ?? DEFAULT_EVOLUTION_CONFIDENCE_THRESHOLD;
    const dailyCap = input.dailyCap ?? DEFAULT_POLICE_DAILY_CAP;
    const suppressed = new Set(input.suppressedKeys ?? []);
    const findings = [];
    let emitted = 0;
    for (const entry of input.evidencePatterns ?? []) {
        const key = buildEvolutionSuppressionKey(entry);
        const baseStale = (entry.baseAtomVersion && entry.currentAtomVersion && entry.baseAtomVersion !== entry.currentAtomVersion)
            || (entry.baseMapVersion && entry.currentMapVersion && entry.baseMapVersion !== entry.currentMapVersion);
        if (baseStale) {
            findings.push(makePoliceFinding({
                findingId: `police.evolution.stale-evolution-draft.${sanitizeId(key)}`,
                policeFamily: 'evolution',
                severity: 'warning',
                trigger: 'stale-evolution-draft',
                scope: entry.targetSurface,
                action: 'request-human-review',
                routeHint: 'review.stale-base',
                readModel: 'evolutionEvidencePattern',
                message: `Evolution draft references stale base (atom ${entry.baseAtomVersion ?? '-'} vs ${entry.currentAtomVersion ?? '-'}, map ${entry.baseMapVersion ?? '-'} vs ${entry.currentMapVersion ?? '-'}).`,
                evidenceRefs: [makeEvidenceRef('stale-base-version', 'police-artifact')],
                metadata: {
                    baseAtomVersion: entry.baseAtomVersion,
                    currentAtomVersion: entry.currentAtomVersion,
                    baseMapVersion: entry.baseMapVersion,
                    currentMapVersion: entry.currentMapVersion,
                    suppressionKey: key,
                    directApplyAllowed: false
                }
            }));
            continue;
        }
        if (suppressed.has(key))
            continue;
        const hasNonUsageEvidence = Boolean(entry.hasFrictionEvidence || entry.hasRegressionEvidence || entry.hasReviewEvidence);
        if (entry.hasUsageOnlyEvidence && !hasNonUsageEvidence)
            continue;
        if (entry.hostLocal)
            continue;
        if (entry.recurrence < recurrenceThreshold)
            continue;
        if (entry.confidence < confidenceThreshold)
            continue;
        if (emitted >= dailyCap) {
            findings.push(makePoliceFinding({
                findingId: `police.evolution.daily-cap.${sanitizeId(key)}`,
                policeFamily: 'evolution',
                severity: 'info',
                trigger: entry.signalKind,
                scope: entry.targetSurface,
                action: 'monitor',
                routeHint: 'observation.daily-cap',
                readModel: 'evolutionEvidencePattern',
                message: `Daily proposal cap (${dailyCap}) reached; further ${entry.signalKind} observations only.`,
                metadata: {
                    dailyCap,
                    suppressionKey: key,
                    directApplyAllowed: false
                }
            }));
            continue;
        }
        const behavior = entry.suggestedBehavior ?? (entry.signalKind === 'map-evolution-signal' ? 'compose' : 'evolve');
        const evidenceRefs = [];
        if (entry.hasFrictionEvidence)
            evidenceRefs.push(makeEvidenceRef('friction-evidence', 'police-artifact'));
        if (entry.hasRegressionEvidence)
            evidenceRefs.push(makeEvidenceRef('quality-comparison', 'official-evidence', 'quality-comparison'));
        if (entry.hasReviewEvidence)
            evidenceRefs.push(makeEvidenceRef('human-review-decision', 'official-evidence', 'human-review-decision'));
        if (entry.hasUsageOnlyEvidence)
            evidenceRefs.push(makeEvidenceRef('usage-feedback', 'official-evidence', 'usage-feedback'));
        findings.push(makePoliceFinding({
            findingId: `police.evolution.${entry.signalKind}.${sanitizeId(key)}`,
            policeFamily: 'evolution',
            severity: 'advisory',
            trigger: entry.signalKind,
            scope: entry.targetSurface,
            action: 'proposal-draft',
            routeHint: `behavior.${behavior}`,
            readModel: 'evolutionEvidencePattern',
            message: `${entry.signalKind} detected for ${entry.targetSurface} (recurrence=${entry.recurrence}, confidence=${entry.confidence}).`,
            evidenceRefs,
            metadata: {
                recurrence: entry.recurrence,
                confidence: entry.confidence,
                patternTags: [...entry.patternTags],
                suggestedBehavior: behavior,
                suppressionKey: key,
                baseAtomVersion: entry.baseAtomVersion,
                currentAtomVersion: entry.currentAtomVersion,
                baseMapVersion: entry.baseMapVersion,
                currentMapVersion: entry.currentMapVersion,
                hostLocal: entry.hostLocal ?? false,
                matchedEvidenceIds: entry.matchedEvidenceIds ?? [],
                directApplyAllowed: false
            }
        }));
        emitted += 1;
    }
    return makePoliceFamilyReport({
        family: 'evolution',
        mode: 'advisory',
        status: 'pass',
        findings,
        sourceValidator: 'runEvolutionPolice'
    });
}
