// Issue #363 — place a stale-base patch by translating it from the base it was
// written against to the current file, never by re-reading the declared line
// numbers in the current file.
//
// The patch is located in its own base (where its line numbers are valid), its
// change blocks come from the patch structure (so a patch that edits the second
// of two equal lines keeps editing the second one), and the base-to-current
// changes come from a line diff. The two change sets are merged three-way with
// the `git merge-file` conflict rule: changes that overlap or touch conflict.
// A conflict means a line the stale patch deletes or modifies (or the gap it
// inserts into) was changed since its base; it is rejected, never applied
// somewhere else. Lines are compared with their own terminator, so CR and
// end-of-file newline changes are changes like any other.
//
// The forward line map (`mapBaseLineForward`) and the translated ranges are
// exported so #360 can map other actors' committed ranges to current
// coordinates with the same rule.
import { spawnSync } from 'node:child_process';
import { hashContent } from './adapters/cas.ts';
import {
  UnifiedPatchApplicationError,
  applyParsedUnifiedPatchDetailed,
  type HunkOffset,
  type LocatedHunk,
  type UnifiedPatchHunk
} from './unified-patch.ts';

/** One contiguous change: base tokens [baseStart, baseEnd) become `added`. */
export interface LineChangeBlock {
  readonly baseStart: number;
  readonly baseEnd: number;
  readonly added: readonly string[];
}

/** A stale-patch block placed in current coordinates. */
export interface TranslatedBlock extends LineChangeBlock {
  /** Current tokens [currentStart, currentEnd) are replaced; equal to the base tokens they came from. */
  readonly currentStart: number;
  readonly currentEnd: number;
}

export interface StaleBaseConflict {
  /** The stale patch's change, in base line indexes (0-based, end exclusive). */
  readonly ours: { readonly baseStart: number; readonly baseEnd: number };
  /** The change made since the base that it overlaps or touches. */
  readonly theirs: { readonly baseStart: number; readonly baseEnd: number; readonly currentStart: number; readonly currentEnd: number };
}

export type StaleBaseTranslation =
  | {
    readonly ok: true;
    readonly text: string;
    readonly blocks: readonly TranslatedBlock[];
    /** Hunks located in current coordinates (index = current line index of the hunk's first old line). */
    readonly located: readonly LocatedHunk[];
    readonly hunkOffsets: readonly HunkOffset[];
  }
  | {
    readonly ok: false;
    readonly reason: 'stale-base-conflict' | 'patch-context-mismatch';
    readonly detail: string;
    readonly conflicts: readonly StaleBaseConflict[];
  };

/** Lines with their own terminator; the last one has none when the text does not end in LF. */
export function lineTokens(text: string): string[] {
  if (text.length === 0) return [];
  const tokens = text.split(/(?<=\n)/);
  return tokens;
}

interface DiffBlock { readonly aStart: number; readonly aEnd: number; readonly bStart: number; readonly bEnd: number }

/** Minimal line diff (Myers) as change blocks, after trimming the common prefix and suffix. */
export function diffLineBlocks(a: readonly string[], b: readonly string[]): DiffBlock[] {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix += 1;
  const n = a.length - prefix - suffix;
  const m = b.length - prefix - suffix;
  if (n === 0 && m === 0) return [];
  if (n === 0 || m === 0) return [{ aStart: prefix, aEnd: prefix + n, bStart: prefix, bEnd: prefix + m }];
  const ai = (i: number) => a[prefix + i]!;
  const bi = (j: number) => b[prefix + j]!;
  const max = n + m;
  const offset = max;
  let v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= max; d += 1) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!) ? v[offset + k + 1]! : v[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && ai(x) === bi(y)) { x += 1; y += 1; }
      next[offset + k] = x;
      if (x >= n && y >= m) { found = d; break; }
    }
    v = next;
    if (found >= 0) { trace.push(v.slice()); break; }
  }
  // Walk the trace back to collect matched pairs.
  const matches: [number, number][] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const prev = trace[d]!;
    const k = x - y;
    const prevK = k === -d || (k !== d && prev[offset + k - 1]! < prev[offset + k + 1]!) ? k + 1 : k - 1;
    const prevX = prev[offset + prevK]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) { x -= 1; y -= 1; matches.push([x, y]); }
    if (d > 0) { x = prevX; y = prevY; }
  }
  while (x > 0 && y > 0) { x -= 1; y -= 1; matches.push([x, y]); }
  matches.reverse();
  const blocks: DiffBlock[] = [];
  let pa = 0;
  let pb = 0;
  for (const [ma, mb] of [...matches, [n, m] as [number, number]]) {
    if (ma > pa || mb > pb) blocks.push({ aStart: prefix + pa, aEnd: prefix + ma, bStart: prefix + pb, bEnd: prefix + mb });
    pa = ma + 1;
    pb = mb + 1;
  }
  return blocks;
}

/** Change blocks of a patch located in `baseTokens`, taken from the patch structure. */
export function patchChangeBlocks(baseTokens: readonly string[], oursTokens: readonly string[], located: readonly LocatedHunk[]): LineChangeBlock[] {
  const blocks: { baseStart: number; baseEnd: number; added: string[] }[] = [];
  let b = 0;
  let o = 0;
  for (const { hunk, index } of located) {
    o += index - b;
    b = index;
    let open: { baseStart: number; baseEnd: number; added: string[] } | null = null;
    for (const entry of hunk.lines) {
      if (entry.marker === ' ') {
        open = null;
        b += 1;
        o += 1;
        continue;
      }
      if (!open) {
        open = { baseStart: b, baseEnd: b, added: [] };
        blocks.push(open);
      }
      if (entry.marker === '-') { b += 1; open.baseEnd = b; } else { open.added.push(oursTokens[o]!); o += 1; }
    }
  }
  // An insertion at EOF of a file without a final newline also terminates the
  // old last line; fold that token into the block touching EOF.
  if (!sameAfterBlocks(baseTokens, oursTokens, blocks)) {
    const last = baseTokens.length - 1;
    const tail = blocks.at(-1);
    if (tail && last >= 0 && tail.baseStart === baseTokens.length && !baseTokens[last]!.endsWith('\n')) {
      const previous = blocks.length > 1 ? blocks[blocks.length - 2]! : null;
      if (!previous || previous.baseEnd < last) {
        const shiftedOurs = oursTokens.length - tail.added.length - 1;
        tail.baseStart = last;
        tail.added.unshift(oursTokens[shiftedOurs]!);
      }
    }
  }
  if (!sameAfterBlocks(baseTokens, oursTokens, blocks)) {
    throw new UnifiedPatchApplicationError('could not derive the change blocks of the stale patch', 'context-mismatch');
  }
  return blocks;
}

function sameAfterBlocks(base: readonly string[], ours: readonly string[], blocks: readonly LineChangeBlock[]): boolean {
  const rebuilt = spliceBlocks(base, blocks.map((block) => ({ start: block.baseStart, end: block.baseEnd, added: block.added })));
  return rebuilt.length === ours.length && rebuilt.every((token, i) => token === ours[i]);
}

function spliceBlocks(tokens: readonly string[], blocks: readonly { start: number; end: number; added: readonly string[] }[]): string[] {
  const out: string[] = [];
  let cursor = 0;
  for (const block of [...blocks].sort((l, r) => l.start - r.start || l.end - r.end)) {
    out.push(...tokens.slice(cursor, block.start), ...block.added);
    cursor = block.end;
  }
  out.push(...tokens.slice(cursor));
  return out;
}

/** git merge-file: two changes are independent only when one ends strictly before the other starts. */
function conflicts(ours: { baseStart: number; baseEnd: number }, theirs: { aStart: number; aEnd: number }): boolean {
  return !(ours.baseEnd < theirs.aStart || theirs.aEnd < ours.baseStart);
}

/**
 * Current line index of base line `index` for a base line no change touched,
 * or of the gap before it; null when a base-to-current change covers it.
 */
export function mapBaseLineForward(index: number, theirs: readonly DiffBlock[]): number | null {
  let delta = 0;
  for (const block of theirs) {
    if (block.aEnd <= index) {
      delta += (block.bEnd - block.bStart) - (block.aEnd - block.aStart);
      continue;
    }
    if (block.aStart <= index && index < block.aEnd) return null;
    break;
  }
  return index + delta;
}

/**
 * Translate a patch written against `baseText` onto `currentText`.
 * The patch is located in the base with the #359 locator (its line numbers are
 * valid there); `git merge-file` conflict semantics decide whether it still applies.
 */
export function translateStalePatch(input: {
  readonly baseText: string;
  readonly currentText: string;
  readonly hunks: readonly UnifiedPatchHunk[];
}): StaleBaseTranslation {
  let ours: ReturnType<typeof applyParsedUnifiedPatchDetailed>;
  try {
    ours = applyParsedUnifiedPatchDetailed(input.baseText, input.hunks, { mode: 'nearest' });
  } catch (error) {
    if (!(error instanceof UnifiedPatchApplicationError)) throw error;
    return { ok: false, reason: 'patch-context-mismatch', detail: `patch does not apply to its declared base: ${error.message}`, conflicts: [] };
  }
  const baseTokens = lineTokens(input.baseText);
  const currentTokens = lineTokens(input.currentText);
  let oursBlocks: LineChangeBlock[];
  try {
    oursBlocks = patchChangeBlocks(baseTokens, lineTokens(ours.text), ours.located);
  } catch (error) {
    if (!(error instanceof UnifiedPatchApplicationError)) throw error;
    return { ok: false, reason: 'stale-base-conflict', detail: error.message, conflicts: [] };
  }
  const theirs = diffLineBlocks(baseTokens, currentTokens);
  const found: StaleBaseConflict[] = [];
  for (const block of oursBlocks) {
    for (const change of theirs) {
      if (conflicts(block, change)) {
        found.push({
          ours: { baseStart: block.baseStart, baseEnd: block.baseEnd },
          theirs: { baseStart: change.aStart, baseEnd: change.aEnd, currentStart: change.bStart, currentEnd: change.bEnd }
        });
      }
    }
  }
  if (found.length > 0) {
    const first = found[0]!;
    return {
      ok: false,
      reason: 'stale-base-conflict',
      detail: `base lines ${first.ours.baseStart + 1}-${Math.max(first.ours.baseStart + 1, first.ours.baseEnd)} of the stale patch changed since its base (now lines ${first.theirs.currentStart + 1}-${Math.max(first.theirs.currentStart + 1, first.theirs.currentEnd)})`,
      conflicts: found
    };
  }
  const translated: TranslatedBlock[] = oursBlocks.map((block) => {
    const currentStart = mapBaseLineForward(block.baseStart, theirs)!;
    return { ...block, currentStart, currentEnd: currentStart + (block.baseEnd - block.baseStart) };
  });
  const text = spliceBlocks(currentTokens, translated.map((block) => ({ start: block.currentStart, end: block.currentEnd, added: block.added }))).join('');
  const located = ours.located.map((entry) => {
    const index = mapBaseLineForward(entry.index, theirs) ?? theirs.find((block) => block.aStart <= entry.index && entry.index < block.aEnd)!.bStart;
    return { ...entry, index, offset: index - entry.declaredIndex };
  });
  return {
    ok: true,
    text,
    blocks: translated,
    located,
    hunkOffsets: located.map(({ hunk, offset }) => ({ declaredOldStart: hunk.oldStart, appliedOldStart: hunk.oldStart + offset, offset }))
  };
}

/** Render translated blocks as a zero-context patch in current coordinates. */
export function renderTranslatedPatch(filePath: string, currentText: string, blocks: readonly TranslatedBlock[]): string {
  const current = lineTokens(currentText);
  const out = [`--- a/${filePath}`, `+++ b/${filePath}`];
  let delta = 0;
  for (const block of blocks) {
    const removed = current.slice(block.currentStart, block.currentEnd);
    const oldStart = removed.length === 0 ? block.currentStart : block.currentStart + 1;
    const newStart = block.added.length === 0 ? block.currentStart + delta : block.currentStart + delta + 1;
    out.push(`@@ -${oldStart},${removed.length} +${newStart},${block.added.length} @@`);
    for (const token of removed) out.push(...bodyLine('-', token));
    for (const token of block.added) out.push(...bodyLine('+', token));
    delta += block.added.length - removed.length;
  }
  return `${out.join('\n')}\n`;
}

function bodyLine(marker: '-' | '+', token: string): string[] {
  return token.endsWith('\n') ? [`${marker}${token.slice(0, -1)}`] : [`${marker}${token}`, '\\ No newline at end of file'];
}

/** The committed version of `file` whose content hash is `declaredHash`, searching recent history. */
export function findCommittedBaseText(cwd: string, file: string, declaredHash: string, maxCommits = 200): string | null {
  const declared = declaredHash.replace(/^sha256:/, '');
  const history = spawnSync('git', ['-C', cwd, 'rev-list', `--max-count=${maxCommits}`, 'HEAD', '--', file], { encoding: 'utf8' });
  if (history.status !== 0) return null;
  for (const sha of history.stdout.trim().split('\n').filter(Boolean)) {
    const result = spawnSync('git', ['-C', cwd, 'cat-file', '-p', `${sha}:${file}`]);
    if (result.status !== 0) continue;
    const text = result.stdout.toString('utf8');
    if (hashContent(text).replace(/^sha256:/, '') === declared) return text;
  }
  return null;
}
