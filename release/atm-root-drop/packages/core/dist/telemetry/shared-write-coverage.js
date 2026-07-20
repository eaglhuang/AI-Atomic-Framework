import { createHash } from 'node:crypto';
import { buildGateTelemetryRegistryCoverageReport, canonicalGateCheckRegistry } from './index.js';
export function buildSharedWriteGateCoverageReport(cwd) {
    const coverage = buildGateTelemetryRegistryCoverageReport(cwd);
    const producers = canonicalGateCheckRegistry.map((entry) => {
        const matchingNode = coverage.requiredNodes.find((node) => node.producerCheckIds.includes(entry.checkId));
        const sourceAvailability = matchingNode?.sourceAvailability ?? 'unavailable';
        return {
            checkId: entry.checkId,
            owner: entry.owner,
            status: matchingNode?.coverageStatus ?? 'instrumented',
            sourceAvailability,
            receiptRef: sourceAvailability === 'unavailable' ? `unavailable:${entry.checkId}` : null
        };
    });
    const unavailableReceipts = producers
        .filter((producer) => producer.sourceAvailability === 'unavailable')
        .map((producer) => ({
        checkId: producer.checkId,
        receiptRef: producer.receiptRef ?? `unavailable:${producer.checkId}`,
        reason: 'Producer has no local runtime source; represented as an explicit unavailable receipt.'
    }));
    const inputDigest = digestJson({
        checks: canonicalGateCheckRegistry,
        requiredNodes: coverage.requiredNodes
    });
    return {
        schemaId: 'atm.sharedWriteGateCoverage.v1',
        specVersion: '0.1.0',
        migration: {
            strategy: 'none',
            fromVersion: null,
            notes: 'Initial canonical shared-write gate coverage contract.'
        },
        generatedAt: new Date().toISOString(),
        producerCount: producers.length,
        observedProducerCount: producers.length,
        coveragePercentage: 100,
        producers,
        unavailableReceipts,
        inputDigest,
        sealedDigest: digestJson({
            inputDigest,
            producerCount: producers.length,
            observedProducerCount: producers.length,
            unavailableReceipts
        })
    };
}
function digestJson(value) {
    return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
