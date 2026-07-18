export type BrokerBatchEvidence = {
  readonly schemaId: 'atm.brokerBatchEvidence.v1';
  readonly batchId: string;
  readonly waveId: string;
  readonly taskIds: readonly string[];
  readonly ticketIds: readonly string[];
  readonly sharedSurfaceFamily: string;
  readonly validators: readonly string[];
  readonly batchRate: number;
  readonly buildsPerWave: number;
};

export type RelatedTaskBatchCandidate = {
  readonly taskId: string;
  readonly ticketId: string;
  readonly waveId: string | null;
  readonly surfaceFamily: string;
  readonly validators?: readonly string[];
};

export function buildRelatedTaskBatchEvidence(input: {
  readonly batchId: string;
  readonly candidate: RelatedTaskBatchCandidate | null | undefined;
  readonly candidates: readonly RelatedTaskBatchCandidate[];
}): BrokerBatchEvidence | null {
  const candidate = input.candidate;
  if (!candidate?.waveId) return null;
  const compatible = input.candidates.filter((entry) =>
    entry.waveId === candidate.waveId && entry.surfaceFamily === candidate.surfaceFamily);
  if (compatible.length < 2) return null;
  return {
    schemaId: 'atm.brokerBatchEvidence.v1',
    batchId: `${candidate.waveId}:${candidate.surfaceFamily}:${input.batchId}`,
    waveId: candidate.waveId,
    taskIds: sortedUnique(compatible.map((entry) => entry.taskId)),
    ticketIds: sortedUnique(compatible.map((entry) => entry.ticketId)),
    sharedSurfaceFamily: candidate.surfaceFamily,
    validators: sortedUnique(compatible.flatMap((entry) => entry.validators ?? [])),
    batchRate: 1,
    buildsPerWave: 1
  };
}

export function inferBrokerSurfaceFamily(values: readonly string[], fallback = 'broker'): string {
  const surfaces = sortedUnique(values.map(normalizePath).filter(Boolean));
  if (surfaces.some((surface) => surface.startsWith('release/') || surface.startsWith('packages/cli/dist/'))) {
    return 'runner-sync:release';
  }
  const first = surfaces[0] ?? fallback;
  return first.split('/').slice(0, 2).join('/') || fallback;
}

export function sortedUnique(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function normalizePath(value: string): string {
  return String(value ?? '').trim().replace(/\\/g, '/').replace(/^\.\//, '');
}
