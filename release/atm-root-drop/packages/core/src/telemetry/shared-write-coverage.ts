import { createHash } from 'node:crypto';
import {
  buildGateTelemetryRegistryCoverageReport,
  canonicalGateCheckRegistry,
  type GateTelemetryCoverageStatus,
  type GateTelemetrySourceAvailability
} from './index.ts';

export interface SharedWriteGateCoverageProducer {
  readonly checkId: string;
  readonly owner: string;
  readonly status: GateTelemetryCoverageStatus;
  readonly sourceAvailability: GateTelemetrySourceAvailability;
  readonly receiptRef: string | null;
}

export interface SharedWriteGateCoverageReport {
  readonly schemaId: 'atm.sharedWriteGateCoverage.v1';
  readonly specVersion: '0.1.0';
  readonly migration: {
    readonly strategy: 'none';
    readonly fromVersion: null;
    readonly notes: string;
  };
  readonly generatedAt: string;
  readonly producerCount: number;
  readonly observedProducerCount: number;
  readonly coveragePercentage: number;
  readonly producers: readonly SharedWriteGateCoverageProducer[];
  readonly unavailableReceipts: readonly {
    readonly checkId: string;
    readonly receiptRef: string;
    readonly reason: string;
  }[];
  readonly inputDigest: string;
  readonly sealedDigest: string;
}

export function buildSharedWriteGateCoverageReport(cwd: string): SharedWriteGateCoverageReport {
  const coverage = buildGateTelemetryRegistryCoverageReport(cwd);
  const producers = canonicalGateCheckRegistry.map((entry): SharedWriteGateCoverageProducer => {
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

function digestJson(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}
