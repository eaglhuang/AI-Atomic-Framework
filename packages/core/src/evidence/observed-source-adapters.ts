import type { ObservedEvidenceSource, ObservedEvidenceSourceDescriptor } from './observed-source.ts';

/** In-process adapter for deterministic fixtures and local callers. */
export function createInMemoryObservedEvidenceSource(
  descriptor: ObservedEvidenceSourceDescriptor,
  value: unknown
): ObservedEvidenceSource {
  return { descriptor, read: () => value };
}

/** Local-substitutable adapter for filesystem, process, ledger, or Git readers. */
export function createReaderObservedEvidenceSource(
  descriptor: ObservedEvidenceSourceDescriptor,
  reader: () => unknown
): ObservedEvidenceSource {
  return { descriptor, read: reader };
}

export { collectObservedEvidence, verifyObservedEvidence } from './observed-source.ts';
