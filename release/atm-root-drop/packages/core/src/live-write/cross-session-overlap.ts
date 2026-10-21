// Issue #360 — original-intent anchoring for live steward writes.
//
// A session's write intent is anchored to the base it first targeted for a
// file. Every later write by that session (fresh base or stale) is checked
// against the lines other sessions committed since that anchor, mapped forward
// to the current file with the #363 line map. A write that deletes or modifies
// such a line is rejected with `cross-session-overlap`, naming the other
// session, its proposal and commit, and its diff for those lines. A fresh base
// hash alone is not grounds to accept. Same-session and disjoint edits pass.
//
// The session identity is the proposal's `actorId` (the prereg kit already
// makes it per slot). The window is the actor's task: an anchor is keyed by
// (actorId, taskId, file) and lives next to the journal in
// `.atm/runtime/live-write-anchors.jsonl`. It never advances inside the window,
// so an accepted disjoint write does not license a later overwrite.
//
// The merge-plan path (`broker steward apply`) is arbitrated by its merge plan
// and keeps the #363 declared-base translation; it does not read these anchors.
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { hashContent } from '../broker/adapters/cas.ts';
import { diffLineBlocks, lineTokens, mapBaseLineForward } from '../broker/stale-base-translation.ts';

/** One committed change: before tokens [beforeStart, beforeEnd) became after tokens [afterStart, afterEnd). */
export interface CommittedBlock {
  readonly beforeStart: number;
  readonly beforeEnd: number;
  readonly afterStart: number;
  readonly afterEnd: number;
  readonly removed: readonly string[];
  readonly added: readonly string[];
}

/** The #360 fields of a live-write journal entry (absent on entries written before #360). */
export interface OverlapJournalFields {
  readonly kind?: 'committed' | 'intent' | 'abandoned';
  readonly file: string;
  readonly baseHash: string;
  readonly afterHash: string;
  readonly proposalId: string;
  readonly actorId?: string | null;
  readonly commitSha?: string | null;
  readonly blocks?: readonly CommittedBlock[];
  readonly acknowledgedOverlap?: readonly string[];
}

/** A current-coordinate range [start, end) of lines a write deletes or modifies. */
export interface LineRange { readonly start: number; readonly end: number }

export interface CrossSessionOverlap {
  readonly actorId: string;
  readonly proposalId: string;
  readonly commitSha: string | null;
  readonly afterHash: string;
  /** 1-based inclusive current line ranges of the other session's lines this write targets. */
  readonly currentLines: readonly { readonly start: number; readonly end: number }[];
  /** The other session's diff for those lines. */
  readonly diff: string;
}

export interface AnchorRecord {
  readonly actorId: string;
  readonly taskId: string | null;
  readonly file: string;
  readonly baseHash: string;
  readonly proposalId: string;
  readonly journalIndex: number;
  readonly recordedAt: string;
}

export const CROSS_SESSION_OVERLAP_INSTRUCTION =
  'Another session changed the lines this write deletes or modifies. Re-decide explicitly: submit a patch that keeps their change (merge both intents), abandon this edit, or resubmit with --ack-overlap naming every listed proposalId to override it on purpose.';

/** Change blocks between two texts, from a list of [start, end) replacements in `before` coordinates. */
export function committedBlocks(before: string, changes: readonly { start: number; end: number; added: readonly string[] }[]): CommittedBlock[] {
  const tokens = lineTokens(before);
  let delta = 0;
  return [...changes].sort((l, r) => l.start - r.start || l.end - r.end).map((change) => {
    const afterStart = change.start + delta;
    delta += change.added.length - (change.end - change.start);
    return {
      beforeStart: change.start,
      beforeEnd: change.end,
      afterStart,
      afterEnd: afterStart + change.added.length,
      removed: tokens.slice(change.start, change.end),
      added: [...change.added]
    };
  });
}

/** Fallback when the patch structure is not available: a line diff. */
export function diffCommittedBlocks(before: string, after: string): CommittedBlock[] {
  const a = lineTokens(before);
  const b = lineTokens(after);
  return diffLineBlocks(a, b).map((block) => ({
    beforeStart: block.aStart,
    beforeEnd: block.aEnd,
    afterStart: block.bStart,
    afterEnd: block.bEnd,
    removed: a.slice(block.aStart, block.aEnd),
    added: b.slice(block.bStart, block.bEnd)
  }));
}

/** Records the actor's anchor for the file on its first proposal; returns it and whether it already existed. */
export function ensureAnchor(cwd: string, input: { actorId: string; taskId: string | null; file: string; declaredHash: string; proposalId: string; journalLength: number }): { anchor: AnchorRecord; existed: boolean } {
  const existing = readAnchors(cwd).find((entry) => entry.actorId === input.actorId && (entry.taskId ?? null) === input.taskId && entry.file === input.file);
  if (existing) return { anchor: existing, existed: true };
  const anchor: AnchorRecord = {
    actorId: input.actorId,
    taskId: input.taskId,
    file: input.file,
    baseHash: input.declaredHash,
    proposalId: input.proposalId,
    journalIndex: input.journalLength,
    recordedAt: new Date().toISOString()
  };
  const target = path.join(cwd, anchorsRelativePath());
  mkdirSync(path.dirname(target), { recursive: true });
  appendFileSync(target, `${JSON.stringify(anchor)}\n`);
  return { anchor, existed: false };
}

export function readAnchors(cwd: string): AnchorRecord[] {
  const target = path.join(cwd, anchorsRelativePath());
  if (!existsSync(target)) return [];
  return readFileSync(target, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line) as AnchorRecord);
}

export function anchorsRelativePath(): string {
  return path.join('.atm', 'runtime', 'live-write-anchors.jsonl');
}

/**
 * Journal entries for the file committed since the anchor base (journal order).
 * The anchor is located on the journal's hash chain; when its hash is not on the
 * chain, Git ancestry decides (entries whose commit descends from the newest
 * commit holding the anchor text); when that is unknown too, every entry counts (fail closed).
 */
export function entriesSinceAnchor<T extends OverlapJournalFields>(cwd: string, entries: readonly T[], anchor: AnchorRecord, currentHash: string): T[] {
  const forFile = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.file === anchor.file && (entry.kind === undefined || entry.kind === 'committed'));
  const anchorHash = bare(anchor.baseHash);
  let start = -1;
  for (const { entry, index } of forFile) if (bare(entry.afterHash) === anchorHash && index < anchor.journalIndex) start = index + 1;
  if (start < 0) start = forFile.find(({ entry }) => bare(entry.baseHash) === anchorHash)?.index ?? -1;
  if (start >= 0) return forFile.filter(({ index }) => index >= start).map(({ entry }) => entry);
  if (anchorHash === bare(currentHash) && forFile.every(({ index }) => index < anchor.journalIndex)) return [];
  const anchorCommit = commitHoldingText(cwd, anchor.file, anchorHash);
  if (anchorCommit === null) return forFile.map(({ entry }) => entry);
  return forFile.filter(({ entry }) => !entry.commitSha || (entry.commitSha !== anchorCommit && isAncestor(cwd, anchorCommit, entry.commitSha))).map(({ entry }) => entry);
}

/**
 * Other sessions' committed lines (since the anchor) that the targeted current
 * ranges delete or modify. Each entry's lines are carried forward through the
 * later journal entries' own change blocks (exact provenance, so duplicate lines
 * stay attributed); where the chain breaks (an out-of-band commit or a pre-#360
 * entry) the rest is mapped with a line diff to the current text. `readAfterText`
 * returns the file text right after an entry's commit (null when unavailable).
 * A pure deletion owns no remaining line; `includeDeletionGaps` (classification of
 * an already-rejected write only) also counts a write spanning the deletion gap.
 */
export function findCrossSessionOverlaps(input: {
  readonly actorId: string;
  readonly currentText: string;
  readonly currentHash: string;
  readonly entries: readonly OverlapJournalFields[];
  readonly targets: readonly LineRange[];
  readonly readAfterText: (entry: OverlapJournalFields) => string | null;
  readonly includeDeletionGaps?: boolean;
}): CrossSessionOverlap[] {
  const targets = input.targets.filter((range) => range.end > range.start);
  if (targets.length === 0) return [];
  const currentTokens = lineTokens(input.currentText);
  const found: CrossSessionOverlap[] = [];
  const entries = input.entries.filter((entry) => entry.kind === undefined || entry.kind === 'committed');
  entries.forEach((entry, position) => {
    if (!entry.actorId || entry.actorId === input.actorId || !entry.blocks || entry.blocks.length === 0) return;
    const mapper = forwardMapper(entry, entries.slice(position + 1), input.currentHash, currentTokens, input.readAfterText);
    if (mapper === null) return;
    const hitLines: number[] = [];
    const hitBlocks: CommittedBlock[] = [];
    for (const block of entry.blocks) {
      let hit = false;
      if (block.afterEnd > block.afterStart) {
        for (let line = block.afterStart; line < block.afterEnd; line += 1) {
          const mapped = mapper(line);
          if (mapped !== null && targets.some((range) => range.start <= mapped && mapped < range.end)) { hitLines.push(mapped); hit = true; }
        }
      } else if (input.includeDeletionGaps) {
        const gap = mapper(block.afterStart);
        if (gap !== null && targets.some((range) => range.start < gap && gap < range.end)) { hitLines.push(gap); hit = true; }
      }
      if (hit) hitBlocks.push(block);
    }
    if (hitBlocks.length === 0) return;
    found.push({
      actorId: entry.actorId,
      proposalId: entry.proposalId,
      commitSha: entry.commitSha ?? null,
      afterHash: entry.afterHash,
      currentLines: toRanges(hitLines),
      diff: renderBlocks(entry.file, hitBlocks)
    });
  });
  return found;
}

/** Maps a line index right after `entry` to the current text, or null when a later change covers it. */
function forwardMapper(
  entry: OverlapJournalFields,
  later: readonly OverlapJournalFields[],
  currentHash: string,
  currentTokens: readonly string[],
  readAfterText: (entry: OverlapJournalFields) => string | null
): ((line: number) => number | null) | null {
  const steps: (readonly CommittedBlock[])[] = [];
  let last: OverlapJournalFields = entry;
  for (const next of later) {
    if (bare(next.baseHash) !== bare(last.afterHash) || !next.blocks) break;
    steps.push(next.blocks);
    last = next;
  }
  let tail: ReturnType<typeof diffLineBlocks> | null = null;
  if (bare(last.afterHash) !== bare(currentHash)) {
    const text = readAfterText(last);
    if (text === null) return null;
    tail = diffLineBlocks(lineTokens(text), currentTokens);
  }
  return (line: number) => {
    let value: number | null = line;
    for (const blocks of steps) {
      value = mapThroughBlocks(value, blocks);
      if (value === null) return null;
    }
    return tail === null ? value : mapBaseLineForward(value, tail);
  };
}

/** A line's index after one committed change, or null when the change rewrote it. */
export function mapThroughBlocks(line: number, blocks: readonly CommittedBlock[]): number | null {
  let delta = 0;
  for (const block of [...blocks].sort((l, r) => l.beforeStart - r.beforeStart)) {
    if (block.beforeEnd <= line) {
      delta += block.added.length - (block.beforeEnd - block.beforeStart);
      continue;
    }
    if (block.beforeStart <= line) return null;
    break;
  }
  return line + delta;
}

function bare(value: string): string {
  return value.replace(/^sha256:/, '');
}

function commitHoldingText(cwd: string, file: string, hash: string, maxCommits = 200): string | null {
  const history = spawnSync('git', ['-C', cwd, 'rev-list', `--max-count=${maxCommits}`, 'HEAD', '--', file], { encoding: 'utf8' });
  if (history.status !== 0) return null;
  for (const sha of history.stdout.trim().split('\n').filter(Boolean)) {
    const result = spawnSync('git', ['-C', cwd, 'cat-file', '-p', `${sha}:${file}`]);
    if (result.status === 0 && bare(hashContent(result.stdout.toString('utf8'))) === hash) return sha;
  }
  return null;
}

function isAncestor(cwd: string, ancestor: string, descendant: string): boolean {
  return spawnSync('git', ['-C', cwd, 'merge-base', '--is-ancestor', ancestor, descendant]).status === 0;
}

/** The text of `file` at `commitSha`, or null. */
export function gitFileAt(cwd: string, commitSha: string | null | undefined, file: string): string | null {
  if (!commitSha) return null;
  const result = spawnSync('git', ['-C', cwd, 'cat-file', '-p', `${commitSha}:${file}`]);
  return result.status === 0 ? result.stdout.toString('utf8') : null;
}

export function describeOverlaps(overlaps: readonly CrossSessionOverlap[]): string {
  return overlaps.map((overlap) => {
    const lines = overlap.currentLines.map((range) => (range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`)).join(', ');
    return `session ${overlap.actorId} (proposal ${overlap.proposalId}, commit ${overlap.commitSha ?? overlap.afterHash}) changed current line(s) ${lines}`;
  }).join('; ');
}

function toRanges(lines: readonly number[]): { start: number; end: number }[] {
  const sorted = [...new Set(lines)].sort((l, r) => l - r);
  const ranges: { start: number; end: number }[] = [];
  for (const line of sorted) {
    const last = ranges.at(-1);
    if (last && line + 1 === last.end + 1) last.end = line + 1;
    else ranges.push({ start: line + 1, end: line + 1 });
  }
  return ranges;
}

function renderBlocks(file: string, blocks: readonly CommittedBlock[]): string {
  const out = [`--- a/${file}`, `+++ b/${file}`];
  for (const block of blocks) {
    out.push(`@@ -${block.beforeStart + 1},${block.removed.length} +${block.afterStart + 1},${block.added.length} @@`);
    for (const token of block.removed) out.push(`-${token.replace(/\n$/, '')}`);
    for (const token of block.added) out.push(`+${token.replace(/\n$/, '')}`);
  }
  return `${out.join('\n')}\n`;
}
