// TASK-MAO-0029: per-task evidence slicing from a wave diff. Given the combined
// set of files changed during a wave plus each member's declared scope, attribute
// every changed file to exactly one task. Files that match zero or more-than-one
// member fail closed: the whole wave is marked needs-review (spec §7).
import type { WaveExecutionState } from './team-wave-envelope.ts';

export interface WaveEvidenceMember {
  readonly taskId: string;
  readonly scopePaths: readonly string[];
  readonly deliverables: readonly string[];
}

export interface WaveEvidenceInput {
  readonly members: readonly WaveEvidenceMember[];
  /** All files changed across the wave (e.g. a combined git diff name list). */
  readonly changedFiles: readonly string[];
  /** Files known to be shared/append-safe; attributed to every owning member, never ambiguous. */
  readonly appendSafePaths?: readonly string[];
}

export interface TaskEvidenceSlice {
  readonly taskId: string;
  readonly attributedFiles: readonly string[];
}

export interface WaveEvidenceResult {
  readonly schemaId: 'atm.teamWaveEvidence.v1';
  readonly slices: readonly TaskEvidenceSlice[];
  /** Files matching no member's scope. */
  readonly unattributed: readonly string[];
  /** Files matching more than one member's scope (excluding append-safe). */
  readonly ambiguous: readonly { readonly file: string; readonly taskIds: readonly string[] }[];
  /** Wave-level execution state for evidence purposes. */
  readonly state: Extract<WaveExecutionState, 'done' | 'needs-review'>;
}

/** Directory-prefix aware membership: a scope ending in '/' matches by prefix. */
function fileMatchesScope(file: string, scopePaths: readonly string[]): boolean {
  return scopePaths.some((scope) => {
    if (scope === file) return true;
    if (scope.endsWith('/') && file.startsWith(scope)) return true;
    return false;
  });
}

/**
 * Slice a wave diff into per-task evidence. The result is `done` only when every
 * changed file is attributed to exactly one member (append-safe files excepted);
 * otherwise the wave is `needs-review` and callers must not checkpoint any member
 * as done from this evidence.
 */
export function sliceWaveEvidence(input: WaveEvidenceInput): WaveEvidenceResult {
  const appendSafe = new Set((input.appendSafePaths ?? []).map((p) => p.trim()));
  const sliceMap = new Map<string, string[]>();
  for (const member of input.members) sliceMap.set(member.taskId, []);

  const unattributed: string[] = [];
  const ambiguous: { file: string; taskIds: string[] }[] = [];

  for (const file of input.changedFiles) {
    const owners = input.members
      .filter((m) => fileMatchesScope(file, m.scopePaths))
      .map((m) => m.taskId);

    if (appendSafe.has(file)) {
      // Append-safe files are attributed to every owner, never ambiguous.
      for (const owner of owners) sliceMap.get(owner)!.push(file);
      continue;
    }
    if (owners.length === 0) {
      unattributed.push(file);
    } else if (owners.length === 1) {
      sliceMap.get(owners[0])!.push(file);
    } else {
      ambiguous.push({ file, taskIds: owners });
    }
  }

  const slices: TaskEvidenceSlice[] = [...sliceMap.entries()].map(([taskId, attributedFiles]) => ({
    taskId,
    attributedFiles
  }));

  const state = unattributed.length === 0 && ambiguous.length === 0 ? 'done' : 'needs-review';
  return {
    schemaId: 'atm.teamWaveEvidence.v1',
    slices,
    unattributed,
    ambiguous,
    state
  };
}
