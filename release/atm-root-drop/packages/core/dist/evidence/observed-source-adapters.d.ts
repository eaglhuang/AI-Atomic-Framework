import type { ObservedEvidenceSource, ObservedEvidenceSourceDescriptor } from './observed-source.js';
/** In-process adapter for deterministic fixtures and local callers. */
export declare function createInMemoryObservedEvidenceSource(descriptor: ObservedEvidenceSourceDescriptor, value: unknown): ObservedEvidenceSource;
/** Local-substitutable adapter for filesystem, process, ledger, or Git readers. */
export declare function createReaderObservedEvidenceSource(descriptor: ObservedEvidenceSourceDescriptor, reader: () => unknown): ObservedEvidenceSource;
export { collectObservedEvidence, verifyObservedEvidence } from './observed-source.js';
