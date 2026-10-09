// Issue #196 — compose same-file text patches against one immutable base.
//
// Every proposal is resolved against the same source bytes, never against the
// output of another proposal, so the result cannot depend on the order the
// proposals arrive in. Hunk context must match the base exactly. Two proposals
// conflict when one changes a line the other also covers (changed or context
// line), or when both insert at the same gap or into each other's changed span;
// a conflict is a fail-closed verdict for a steward-authored final patch, not a
// guess at a merged result.
import type { PatchProposal } from './types.ts';
import { rebaseProposalsByRegionIdentity } from './steward-region-rebase.ts';
import {
  eofMarkerViolation,
  eofNewlineDecision,
  hunkOldLineIndex,
  joinSourceText,
  oldSideNewlineAgrees,
  parseUnifiedPatchHunks,
  resolveEofNewline,
  splitSourceText,
  type EofNewlineDecision
} from './unified-patch.ts';

export type StewardCompositionBlockCode = 'compose-context-mismatch' | 'steward-final-patch-required' | 'compose-permutation-unstable';

export interface StewardCompositionBlock {
  readonly code: StewardCompositionBlockCode;
  readonly filePath: string;
  readonly proposalIds: readonly string[];
  readonly detail: string;
}

export type BaseCompositionResult =
  | { readonly ok: true; readonly content: string; readonly checkedPermutationCount: number }
  | { readonly ok: false; readonly block: StewardCompositionBlock };

interface ProposalEdit {
  readonly proposalId: string;
  /** Base line indexes the proposal's hunks cover (context and removed). */
  readonly span: ReadonlySet<number>;
  readonly deleted: ReadonlySet<number>;
  /** Inserted lines keyed by gap index: gap g sits before base line g. */
  readonly inserts: ReadonlyMap<number, readonly string[]>;
  readonly eofNewline: EofNewlineDecision;
}

/** Exhaustive permutation checks stay cheap up to this many proposals per file. */
const MAX_EXHAUSTIVE_PERMUTATION_PROPOSALS = 4;

export function composeTextPatchesAgainstBase(filePath: string, before: string, proposals: readonly PatchProposal[]): BaseCompositionResult {
  const declared = composeTextPatchesAtDeclaredLines(filePath, before, proposals);
  if (declared.ok || declared.block.code !== 'compose-context-mismatch') return declared;
  return rebaseProposalsByRegionIdentity(filePath, before, proposals) ?? declared;
}

function composeTextPatchesAtDeclaredLines(filePath: string, before: string, proposals: readonly PatchProposal[]): BaseCompositionResult {
  const source = splitSourceText(before);
  const baseLines = source.lines;

  const edits: ProposalEdit[] = [];
  for (const proposal of proposals) {
    const edit = resolveProposalEdit(proposal, baseLines, source.endsWithNewline);
    if ('detail' in edit) {
      return { ok: false, block: { code: 'compose-context-mismatch', filePath, proposalIds: [proposal.proposalId], detail: edit.detail } };
    }
    edits.push(edit);
  }

  for (let left = 0; left < edits.length; left += 1) {
    for (let right = left + 1; right < edits.length; right += 1) {
      const overlap = describeOverlap(edits[left]!, edits[right]!);
      if (overlap) {
        const proposalIds = [edits[left]!.proposalId, edits[right]!.proposalId].sort((a, b) => a.localeCompare(b));
        return {
          ok: false,
          block: {
            code: 'steward-final-patch-required',
            filePath,
            proposalIds,
            detail: `proposals '${proposalIds[0]}' and '${proposalIds[1]}' ${overlap} of ${filePath}; a steward-authored final patch is required`
          }
        };
      }
    }
  }

  const eof = mergedEofNewline(edits);
  if (eof === 'conflict') {
    const proposalIds = edits.map((edit) => edit.proposalId).sort((left, right) => left.localeCompare(right));
    return {
      ok: false,
      block: {
        code: 'steward-final-patch-required',
        filePath,
        proposalIds,
        detail: `proposals ${proposalIds.map((id) => `'${id}'`).join(' and ')} disagree on the end-of-file newline of ${filePath}; a steward-authored final patch is required`
      }
    };
  }
  const endsWithNewline = resolveEofNewline(eof, source.endsWithNewline);
  const orders = permutationsToCheck(edits);
  const outputs = new Set(orders.map((order) => renderComposition(baseLines, order, source.lineEnding, endsWithNewline)));
  if (outputs.size !== 1) {
    return {
      ok: false,
      block: { code: 'compose-permutation-unstable', filePath, proposalIds: edits.map((edit) => edit.proposalId).sort((a, b) => a.localeCompare(b)), detail: `composition of ${filePath} differs across ${orders.length} proposal orders` }
    };
  }
  return { ok: true, content: [...outputs][0]!, checkedPermutationCount: orders.length };
}

/** Human-readable blocked reason, prefixed with its code like other steward reasons. */
export function formatStewardCompositionBlock(block: StewardCompositionBlock): string {
  return `${block.code}: ${block.detail} [proposals: ${block.proposalIds.join(', ')}]`;
}

function resolveProposalEdit(
  proposal: PatchProposal,
  baseLines: readonly string[],
  fileEndsWithNewline: boolean
): ProposalEdit | { readonly detail: string } {
  const span = new Set<number>();
  const deleted = new Set<number>();
  const inserts = new Map<number, string[]>();
  const hunks = parseUnifiedPatchHunks(proposal.patch);
  const markerError = eofMarkerViolation(hunks, baseLines.length);
  if (markerError) return { detail: `proposal '${proposal.proposalId}' ${markerError}` };
  let cursor = 0;
  for (const hunk of hunks) {
    const start = hunkOldLineIndex(hunk.oldStart);
    if (start < cursor) return { detail: `proposal '${proposal.proposalId}' hunk at old line ${hunk.oldStart} overlaps an earlier hunk` };
    if (start > baseLines.length) return { detail: `proposal '${proposal.proposalId}' hunk at old line ${hunk.oldStart} starts past the end of a ${baseLines.length}-line base` };
    cursor = start;
    for (const entry of hunk.lines) {
      if (entry.marker === '+') {
        const gap = inserts.get(cursor) ?? [];
        gap.push(entry.text);
        inserts.set(cursor, gap);
        continue;
      }
      if (baseLines[cursor] !== entry.text) {
        return { detail: `proposal '${proposal.proposalId}' context mismatch at base line ${cursor + 1}: expected ${JSON.stringify(entry.text)}, found ${JSON.stringify(baseLines[cursor] ?? null)}` };
      }
      if (!oldSideNewlineAgrees({
        noNewline: entry.noNewline,
        lineIndex: cursor,
        lineCount: baseLines.length,
        fileEndsWithNewline
      })) {
        return { detail: `proposal '${proposal.proposalId}' newline mismatch at base line ${cursor + 1}: the ${entry.noNewline ? 'old side omits' : 'old side keeps'} the end-of-file newline` };
      }
      span.add(cursor);
      if (entry.marker === '-') deleted.add(cursor);
      cursor += 1;
    }
  }
  return { proposalId: proposal.proposalId, span, deleted, inserts, eofNewline: eofNewlineDecision(hunks, baseLines.length) };
}

function mergedEofNewline(edits: readonly ProposalEdit[]): EofNewlineDecision | 'conflict' {
  const declared = new Set(edits.map((edit) => edit.eofNewline).filter((decision) => decision !== 'preserve'));
  if (declared.size > 1) return 'conflict';
  if (declared.has('absent')) return 'absent';
  if (declared.has('present')) return 'present';
  return 'preserve';
}

function describeOverlap(left: ProposalEdit, right: ProposalEdit): string | null {
  const changedCovered = firstShared(left.deleted, right.span) ?? firstShared(right.deleted, left.span);
  if (changedCovered !== null) return `change overlapping base line ${changedCovered + 1}`;
  for (const [owner, other] of [[left, right], [right, left]] as const) {
    for (const gap of owner.inserts.keys()) {
      if (other.inserts.has(gap)) return `both insert before base line ${gap + 1}`;
      if (other.deleted.has(gap - 1) || other.deleted.has(gap) || (other.span.has(gap - 1) && other.span.has(gap))) {
        return `insert inside the other proposal's hunk before base line ${gap + 1}`;
      }
    }
  }
  return null;
}

function firstShared(left: ReadonlySet<number>, right: ReadonlySet<number>): number | null {
  const shared = [...left].filter((value) => right.has(value)).sort((a, b) => a - b);
  return shared[0] ?? null;
}

function renderComposition(baseLines: readonly string[], edits: readonly ProposalEdit[], lineEnding: string, endsWithNewline: boolean): string {
  const output: string[] = [];
  for (let gap = 0; gap <= baseLines.length; gap += 1) {
    for (const edit of edits) output.push(...(edit.inserts.get(gap) ?? []));
    if (gap < baseLines.length && !edits.some((edit) => edit.deleted.has(gap))) output.push(baseLines[gap]!);
  }
  return joinSourceText(output, lineEnding, endsWithNewline);
}

function permutationsToCheck(edits: readonly ProposalEdit[]): ProposalEdit[][] {
  if (edits.length <= 1) return [[...edits]];
  if (edits.length > MAX_EXHAUSTIVE_PERMUTATION_PROPOSALS) {
    // Beyond the exhaustive bound, check every rotation plus the reversal.
    const rotations = edits.map((_, shift) => [...edits.slice(shift), ...edits.slice(0, shift)]);
    return [...rotations, [...edits].reverse()];
  }
  const result: ProposalEdit[][] = [];
  const permute = (prefix: ProposalEdit[], rest: ProposalEdit[]) => {
    if (rest.length === 0) {
      result.push(prefix);
      return;
    }
    rest.forEach((edit, index) => permute([...prefix, edit], [...rest.slice(0, index), ...rest.slice(index + 1)]));
  };
  permute([], [...edits]);
  return result;
}
