// ATM-GOV-0355 — real unified-diff application for the neutral steward.
//
// The steward is the only sanctioned writer for a contended shared surface
// (INV-ATM-010), so "applied" has to mean applied. This module has one
// contract: return the exact resulting text, or throw. There is deliberately no
// best-effort branch — the behaviour this replaces appended every added line to
// the end of the file and could not fail, which is what let a write that never
// happened produce an applied receipt.
//
// Matching is exact. A steward write is arbitrated, not guessed: if a proposal's
// context no longer matches the base it was authored against, the right outcome
// is a refusal that sends the proposal back for rebase, not a fuzzy placement.

export const UNIFIED_PATCH_APPLICATION_SCHEMA_ID = 'atm.unifiedPatchApplication.v1';

export class UnifiedPatchApplicationError extends Error {
  readonly code = 'ATM_UNIFIED_PATCH_CONTEXT_MISMATCH';
  constructor(message: string) {
    super(message);
    this.name = 'UnifiedPatchApplicationError';
  }
}

interface Hunk {
  readonly oldStart: number;
  readonly lines: readonly string[];
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function parseHunks(patchText: string): readonly Hunk[] {
  const lines = patchText.split(/\r?\n/);
  // A patch normally ends with a newline, which split() turns into a trailing
  // empty element. That element is punctuation, not a blank context line, and
  // treating it as one demands an empty line the source does not have.
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const hunks: Hunk[] = [];
  let current: { oldStart: number; lines: string[] } | null = null;
  for (const line of lines) {
    const header = HUNK_HEADER.exec(line);
    if (header) {
      if (current) hunks.push(current);
      current = { oldStart: Number.parseInt(header[1]!, 10), lines: [] };
      continue;
    }
    if (!current) continue;
    // File headers can only appear before the first hunk; inside a hunk a
    // leading '---'/'+++' is ordinary content and must be kept.
    if (line.startsWith(' ') || line.startsWith('-') || line.startsWith('+')) {
      current.lines.push(line);
      continue;
    }
    if (line === '') {
      // A bare empty line inside a hunk is an unprefixed context line for an
      // empty source line; some emitters strip the trailing space.
      current.lines.push(' ');
      continue;
    }
    if (line.startsWith('\\')) continue; // "\ No newline at end of file"
    // Anything else ends the hunk body.
    hunks.push(current);
    current = null;
  }
  if (current) hunks.push(current);
  return hunks;
}

function detectLineEnding(text: string): string {
  return /\r\n/.test(text) ? '\r\n' : '\n';
}

/**
 * Apply a unified diff to `before`, returning the exact resulting text.
 *
 * Throws {@link UnifiedPatchApplicationError} when a hunk's context or removed
 * lines do not match the source at the position the hunk declares. Callers must
 * surface that as a blocked apply; they must not fall back to any other write.
 */
export function applyUnifiedPatch(before: string, patchText: string): string {
  const hunks = parseHunks(patchText);
  if (hunks.length === 0) return before;

  const lineEnding = detectLineEnding(before);
  const endsWithNewline = before.endsWith('\n');
  // Split on the logical newline; a trailing newline yields a final empty
  // element that is bookkeeping, not a line, so drop it and restore it later.
  const sourceLines = before.split(/\r?\n/);
  if (endsWithNewline) sourceLines.pop();

  const output: string[] = [];
  let cursor = 0; // index into sourceLines already copied to output

  for (const hunk of hunks) {
    const start = hunk.oldStart - 1;
    if (start < cursor) {
      throw new UnifiedPatchApplicationError(
        `hunk at old line ${hunk.oldStart} overlaps an earlier hunk`
      );
    }
    if (start > sourceLines.length) {
      throw new UnifiedPatchApplicationError(
        `hunk at old line ${hunk.oldStart} starts past the end of a ${sourceLines.length}-line file`
      );
    }
    output.push(...sourceLines.slice(cursor, start));
    cursor = start;

    for (const entry of hunk.lines) {
      const marker = entry[0];
      const content = entry.slice(1);
      if (marker === '+') {
        output.push(content);
        continue;
      }
      const actual = sourceLines[cursor];
      if (actual === undefined || actual !== content) {
        throw new UnifiedPatchApplicationError(
          `patch context mismatch at line ${cursor + 1}: expected ${JSON.stringify(content)}, found ${JSON.stringify(actual ?? null)}`
        );
      }
      cursor += 1;
      if (marker === ' ') output.push(content);
      // marker === '-' drops the line.
    }
  }
  output.push(...sourceLines.slice(cursor));

  const joined = output.join(lineEnding);
  return endsWithNewline ? `${joined}${lineEnding}` : joined;
}
