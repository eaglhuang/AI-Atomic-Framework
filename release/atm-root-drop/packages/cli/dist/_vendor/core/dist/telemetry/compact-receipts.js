import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
export function readCompactSealDigests(root) {
    if (!existsSync(root))
        return [];
    const digests = [];
    for (const name of readdirSync(root)) {
        if (!name.endsWith('.json'))
            continue;
        try {
            const parsed = JSON.parse(readFileSync(path.join(root, name), 'utf8'));
            if (parsed.schemaId === 'atm.gateTelemetrySealDigest.v1' && parsed.storagePolicy === 'runtime-raw-tracked-digest') {
                digests.push(parsed);
            }
        }
        catch {
            /* ignored: malformed compact receipt is not raw telemetry input */
        }
    }
    return digests.sort((left, right) => left.sealedAt.localeCompare(right.sealedAt));
}
export function reportFromCompactSeals(seals, malformedEvents, warnings) {
    const byCheckId = {};
    const uniqueBlocks = new Set();
    for (const seal of seals) {
        for (const [checkId, aggregate] of Object.entries(seal.aggregates)) {
            const bucket = byCheckId[checkId] ?? emptyAggregate();
            byCheckId[checkId] = {
                eligible: bucket.eligible + aggregate.eligible,
                resultCounts: mergeCounts(bucket.resultCounts, aggregate.resultCounts),
                durationP50: aggregate.durationP50,
                durationP95: aggregate.durationP95,
                evidenceReadbacks: bucket.evidenceReadbacks + aggregate.evidenceReadbacks
            };
        }
        for (const block of seal.uniqueBlocks)
            uniqueBlocks.add(block);
    }
    return {
        schemaId: 'atm.gateTelemetryReport.v1',
        generatedAt: new Date().toISOString(),
        source: 'sealed-history',
        eventCount: seals.reduce((sum, seal) => sum + seal.eventCount, 0),
        byCheckId,
        uniqueBlocks: [...uniqueBlocks].sort(),
        truePositiveStatus: 'unclassified',
        metaHealth: {
            droppedEvents: 0,
            malformedEvents,
            warnings
        }
    };
}
export function mergeReports(left, right, source) {
    const byCheckId = { ...left.byCheckId };
    for (const [checkId, aggregate] of Object.entries(right.byCheckId)) {
        const bucket = byCheckId[checkId] ?? emptyAggregate();
        byCheckId[checkId] = {
            eligible: bucket.eligible + aggregate.eligible,
            resultCounts: mergeCounts(bucket.resultCounts, aggregate.resultCounts),
            durationP50: aggregate.durationP50 ?? bucket.durationP50,
            durationP95: aggregate.durationP95 ?? bucket.durationP95,
            evidenceReadbacks: bucket.evidenceReadbacks + aggregate.evidenceReadbacks
        };
    }
    return {
        ...left,
        generatedAt: new Date().toISOString(),
        source,
        eventCount: left.eventCount + right.eventCount,
        byCheckId,
        uniqueBlocks: sortedUnique([...left.uniqueBlocks, ...right.uniqueBlocks]),
        metaHealth: {
            droppedEvents: left.metaHealth.droppedEvents + right.metaHealth.droppedEvents,
            malformedEvents: left.metaHealth.malformedEvents + right.metaHealth.malformedEvents,
            warnings: sortedUnique([...left.metaHealth.warnings, ...right.metaHealth.warnings])
        }
    };
}
export function mergeCompactCorrelation(seals) {
    return {
        runIds: sortedUnique(seals.flatMap((seal) => seal.correlation.runIds)),
        laneSessionIds: sortedUnique(seals.flatMap((seal) => seal.correlation.laneSessionIds)),
        batchIds: sortedUnique(seals.flatMap((seal) => seal.correlation.batchIds)),
        waveIds: sortedUnique(seals.flatMap((seal) => seal.correlation.waveIds))
    };
}
function emptyAggregate() {
    return {
        eligible: 0,
        resultCounts: {},
        durationP50: null,
        durationP95: null,
        evidenceReadbacks: 0
    };
}
function mergeCounts(left, right) {
    const out = { ...left };
    for (const [key, value] of Object.entries(right))
        out[key] = (out[key] ?? 0) + value;
    return out;
}
function sortedUnique(values) {
    return [...new Set(values.filter((value) => typeof value === 'string' && value.length > 0))].sort();
}
