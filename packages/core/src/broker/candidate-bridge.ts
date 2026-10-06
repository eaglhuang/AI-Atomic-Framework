import { createHash } from 'node:crypto';
import type { SharedSurfacesRecord, WriteIntent, WriteIntentAtomRef } from './types.ts';
import {
  emptyGovernanceSharedSurfaces,
  mergeSharedSurfaces,
  projectGovernanceSharedSurfacesFromPaths,
  type GovernanceResourceProjectionOptions
} from './global-resource-projection.ts';

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
  /** Language of the source file; inferred from the file extension when absent. */
  readonly languageId?: string;
  /**
   * Position among same-kind, same-symbol atoms in one file (source order,
   * 0-based). Set only when such duplicates exist; see derived-atoms.ts.
   */
  readonly ordinal?: number;
}

export interface CandidateBridgeContext {
  readonly taskId: string;
  readonly actorId: string;
  readonly baseCommit: string;
  readonly sharedSurfaces?: Partial<SharedSurfacesRecord>;
  readonly governanceResources?: GovernanceResourceProjectionOptions;
  readonly requestedLane?: WriteIntent['requestedLane'];
}

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
      operation: 'create',
      ...computeCandidateSourceRange(candidate)
    };
  });

  const targetFiles = [...new Set(
    candidates.flatMap((candidate) => [
      candidate.filePath,
      ...(candidate.suggestedSourcePaths ?? [])
    ]).map(normalizePath)
  )].sort();
  const projectedSharedSurfaces = projectGovernanceSharedSurfacesFromPaths(targetFiles, ctx.governanceResources);

  return {
    schemaId: 'atm.writeIntent.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'generated' },
    taskId: ctx.taskId,
    actorId: ctx.actorId,
    baseCommit: ctx.baseCommit,
    targetFiles,
    atomRefs,
    sharedSurfaces: mergeSharedSurfaces(
      mergeSharedSurfaces(emptyGovernanceSharedSurfaces(), projectedSharedSurfaces),
      ctx.sharedSurfaces
    ),
    requestedLane: ctx.requestedLane ?? 'auto'
  };
}

export const ATOM_CID_FORMULA_VERSION = 'cid.v2' as const;

/**
 * Deterministic atom CID (cid.v2, TASK-ASP-0006): SHA-256 over
 * `cid.v2 || languageId || sourcePaths || kind || symbol || ordinal`, where
 * `sourcePaths` is the deduplicated, sorted union of `filePath` and
 * `suggestedSourcePaths`. Line numbers and `detectionMethod` are not part of
 * the identity: inserting lines above an atom or upgrading the detector keeps
 * its CID. Content changes are tracked separately (`computeAtomContentVersion`).
 */
export function computeCandidateAtomCid(candidate: BridgeAtomCandidate): string {
  const sourcePaths = [...new Set(
    [candidate.filePath, ...(candidate.suggestedSourcePaths ?? [])].map(normalizePath)
  )].sort();
  const contract = [
    ATOM_CID_FORMULA_VERSION,
    candidate.languageId ?? inferLanguageId(candidate.filePath),
    sourcePaths.join(','),
    candidate.kind,
    candidate.symbol,
    candidate.ordinal == null ? '' : String(candidate.ordinal)
  ].join('||');
  return createHash('sha256').update(contract).digest('hex');
}

const languageIdByExtension: Readonly<Record<string, string>> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.mts': 'typescript', '.cts': 'typescript',
  '.js': 'javascript', '.jsx': 'javascript', '.mjs': 'javascript', '.cjs': 'javascript',
  '.py': 'python', '.cs': 'csharp'
};

export function inferLanguageId(filePath: string): string {
  const match = /\.[^./\\]+$/.exec(filePath);
  return (match && languageIdByExtension[match[0].toLowerCase()]) ?? 'unknown';
}

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}

function computeCandidateSourceRange(candidate: BridgeAtomCandidate):
  | { sourceRange?: { filePath: string; lineStart: number; lineEnd: number } }
  | undefined {
  if (
    candidate.lineStart == null ||
    candidate.lineEnd == null ||
    Number.isNaN(candidate.lineStart) ||
    Number.isNaN(candidate.lineEnd)
  ) {
    return undefined;
  }

  const start = Math.max(1, candidate.lineStart);
  const end = Math.max(start, candidate.lineEnd);
  return {
    sourceRange: {
      filePath: normalizePath(candidate.filePath),
      lineStart: start,
      lineEnd: end
    }
  };
}
