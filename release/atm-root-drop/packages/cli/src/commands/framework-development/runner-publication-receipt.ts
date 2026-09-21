import { createHash } from 'node:crypto';

export interface RunnerPublicationReceiptInput {
  readonly taskId: string;
  readonly laneSessionId: string | null;
  readonly stewardActorId: string;
  readonly sealedSourceSha: string;
  readonly generation: number;
  readonly runnerBuildDigest: string | null;
  readonly manifestDigest: string | null;
  readonly surfaces: readonly string[];
  readonly publicationCommitSha: string | null;
  readonly remoteVisibility: 'local' | 'remote';
  readonly receiptDisposition: 'archived' | 'pending';
  readonly issuedAt: string;
}

export interface RunnerPublicationReceipt extends Omit<RunnerPublicationReceiptInput, 'laneSessionId'> {
  readonly schemaId: 'atm.sealedRunnerPublicationReceipt.v1';
  readonly laneFingerprint: string | null;
  readonly receiptDigest: string;
}

/**
 * The sole receipt constructor for sealed runner publication. It hides lane
 * identifiers, canonicalizes surfaces, and binds the full publication tuple.
 */
export function buildRunnerPublicationReceipt(input: RunnerPublicationReceiptInput): RunnerPublicationReceipt {
  const core = {
    schemaId: 'atm.sealedRunnerPublicationReceipt.v1' as const,
    taskId: input.taskId,
    laneFingerprint: fingerprint(input.laneSessionId, 'lane'),
    stewardActorId: input.stewardActorId,
    sealedSourceSha: input.sealedSourceSha,
    generation: input.generation,
    runnerBuildDigest: input.runnerBuildDigest,
    manifestDigest: input.manifestDigest,
    surfaces: [...new Set(input.surfaces.map((surface) => surface.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right)),
    publicationCommitSha: input.publicationCommitSha,
    remoteVisibility: input.remoteVisibility,
    receiptDisposition: input.receiptDisposition,
    issuedAt: input.issuedAt
  };
  const receiptDigest = `sha256:${createHash('sha256').update(JSON.stringify(core)).digest('hex')}`;
  return { ...core, receiptDigest };
}

function fingerprint(value: string | null | undefined, kind: string): string | null {
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  return `${kind}fp:${createHash('sha256').update(`${kind}\n${value}`).digest('hex').slice(0, 16)}`;
}
