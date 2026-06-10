import { createHash } from 'node:crypto';
import type { SharedSurfacesRecord, WriteIntent, WriteIntentAtomRef } from './types.ts';

/**
 * Structural mirror of the plugin-sdk `AtomCandidate` schema (TASK-ASP-0001).
 *
 * `@ai-atomic-framework/plugin-sdk` depends on core, so core cannot import the
 * SDK type without creating a package cycle. The bridge therefore accepts any
 * value assignable to this shape; plugin-sdk `AtomCandidate` satisfies it
 * verbatim (the candidate-bridge tests assert that assignability).
 */
export interface BridgeAtomCandidate {
  readonly candidateId: string;
  readonly kind: string;
  readonly symbol: string;
  readonly filePath: string;
  readonly lineStart: number | null;
  readonly lineEnd: number | null;
  readonly confidence: 'high' | 'medium' | 'low';
  readonly detectionMethod: string;
  readonly suggestedAtomId?: string;
  readonly suggestedSourcePaths?: readonly string[];
  readonly notes?: readonly string[];
}

export interface CandidateBridgeContext {
  readonly taskId: string;
  readonly actorId: string;
  readonly baseCommit: string;
  readonly sharedSurfaces?: Partial<SharedSurfacesRecord>;
  readonly requestedLane?: WriteIntent['requestedLane'];
}

const emptySharedSurfaces: SharedSurfacesRecord = {
  generators: [],
  projections: [],
  registries: [],
  validators: [],
  artifacts: []
};

/**
 * Convert discovered atom candidates into a well-formed `WriteIntent` for
 * `calculateBrokerDecision()` (TASK-ASP-0004). Pure and deterministic: no
 * LLM calls, no language semantics, and the candidate input is never mutated.
 */
export function candidatesToWriteIntent(
  candidates: readonly BridgeAtomCandidate[],
  ctx: CandidateBridgeContext
): WriteIntent {
  if (candidates.length === 0) {
    throw new TypeError('candidatesToWriteIntent requires at least one atom candidate.');
  }

  const atomRefs: WriteIntentAtomRef[] = candidates.map((candidate) => {
    const atomCid = computeCandidateAtomCid(candidate);
    return {
      atomId: candidate.suggestedAtomId ?? `ATM-AUTO-${atomCid.slice(0, 8)}`,
      atomCid,
      operation: 'create'
    };
  });

  const targetFiles = [...new Set(
    candidates.flatMap((candidate) => [
      candidate.filePath,
      ...(candidate.suggestedSourcePaths ?? [])
    ]).map(normalizePath)
  )].sort();

  return {
    schemaId: 'atm.writeIntent.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'generated' },
    taskId: ctx.taskId,
    actorId: ctx.actorId,
    baseCommit: ctx.baseCommit,
    targetFiles,
    atomRefs,
    sharedSurfaces: { ...emptySharedSurfaces, ...ctx.sharedSurfaces },
    requestedLane: ctx.requestedLane ?? 'auto'
  };
}

/**
 * Deterministic atom CID: SHA-256 over the canonical candidate contract
 * `(kind || symbol || sortedSourcePaths || detectionMethod)`. The same
 * candidate always produces the same CID across runs and processes.
 */
export function computeCandidateAtomCid(candidate: BridgeAtomCandidate): string {
  const sourcePaths = [...new Set(
    [candidate.filePath, ...(candidate.suggestedSourcePaths ?? [])].map(normalizePath)
  )].sort();
  const contract = [
    candidate.kind,
    candidate.symbol,
    sourcePaths.join(','),
    candidate.detectionMethod
  ].join('||');
  return createHash('sha256').update(contract).digest('hex');
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}
