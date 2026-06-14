export type {
  HistoricalDeliveryProvenance
} from './closure-packet-schema.ts';

import type { HistoricalDeliveryProvenance } from './closure-packet-schema.ts';

export function hasHistoricalDeliveryWaiver(provenance: HistoricalDeliveryProvenance): boolean {
  return provenance.waivedOutOfScopeFiles.length > 0 && provenance.waiverReason !== null;
}

export function countHistoricalDeliveryFiles(provenance: HistoricalDeliveryProvenance): number {
  return new Set([
    ...provenance.taskMatchedFiles,
    ...provenance.governanceFiles,
    ...provenance.allowedRunnerOutputFiles,
    ...provenance.outOfScopeSourceFiles,
    ...provenance.waivedOutOfScopeFiles
  ]).size;
}
