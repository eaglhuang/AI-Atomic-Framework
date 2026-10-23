// GENERATED FILE. DO NOT EDIT.
// Source: packages/core/src/broker/unified-patch.ts (type-stripped by kit/bin/generate-unified-patch.mjs).
// Regenerate: node research/paper-v2/prereg-v3-smoke/kit/bin/generate-unified-patch.mjs
// Guarded by kit/test/test-hunk-locator-parity.sh (preflight check hunk-locator-parity).

// ATM-GOV-0355 — real unified-diff application for the neutral steward.
//
// The steward is the only sanctioned writer for a contended shared surface
// (INV-ATM-010), so "applied" has to mean applied. This module has one
// contract: return the exact resulting text, or throw. There is deliberately no
// best-effort branch — the behaviour this replaces appended every added line to
// the end of the file and could not fail, which is what let a write that never
// happened produce an applied receipt.
//
// Matching is exact (zero fuzz). Positions are located by exact context within
// a bounded window, with a whole-file fallback; ambiguous placement refuses.
//
// `\ No newline at end of file` is part of that contract. Git attaches the
// marker to the preceding hunk line. On a context line it describes both sides;
// on a removed line only the old side; on an added line only the new side.
// Adding or removing the final newline is a real edit, and a file that does not
// end with a newline must round-trip byte for byte.

export const UNIFIED_PATCH_APPLICATION_SCHEMA_ID = 'atm.unifiedPatchApplication.v1';

export const NO_NEWLINE_AT_EOF_MARKER = '\\ No newline at end of file';

/** Bounded outward search window, in lines either side of the declared start. */
export const HUNK_LOCATOR_WINDOW = 50;

export class UnifiedPatchApplicationError extends Error {
           code = 'ATM_UNIFIED_PATCH_CONTEXT_MISMATCH';
           reason                         ;
  constructor(message        , reason                          = 'context-mismatch') {
    super(message);
    this.name = 'UnifiedPatchApplicationError';
    this.reason = reason;
  }
}

/** How a patch treats the final newline relative to the base file. */

/**
 * Lines split on LF only. A line keeps its own `\r`, so a CRLF line's text
 * ends in `\r` and an LF line's does not (`lineEol`). Untouched lines therefore
 * round-trip byte for byte, and context matching compares the CR the way
 * `git apply` does by default. `lineEnding` is informational only (CRLF when
 * any line ends in CRLF); joining never rewrites a line's terminator.
 */

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Zero-count hunks insert after oldStart; other hunks start on oldStart. */
export function hunkOldLineIndex(oldStart        , oldCount = 1)         {
  return oldCount === 0 ? Math.max(0, oldStart) : oldStart <= 0 ? 0 : oldStart - 1;
}

function normalizePatchPath(value        )         {
  return value.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '').replace(/^[ab]\//, '').replace(/^(?:\.\/)+/, '');
}

function stripCr(line        )         {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

const FILE_HEADER = /^(?:diff --git |index |--- |\+\+\+ |new file mode|deleted file mode|old mode|new mode|similarity index|rename from|rename to|copy from|copy to)/;

/** Parse one file's unified diff, rejecting incomplete or overlong bodies. */
export function parseUnifiedPatch(patchText        , options                          )                              {
  const malformed = (message        )        => { throw new UnifiedPatchApplicationError(message, 'malformed'); };
  // Split on LF only: a body line's own CR is part of its content (#362).
  // Header and marker lines tolerate a CR so a CRLF-saved patch still parses.
  const lines = patchText.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const hunks                     = [];
  let diffSeen = false;
  let oldPath                = null;
  let newPath                = null;
  let diffPath                = null;
  let started = false;
  const checkTarget = (value        ) => {
    if (options?.targetFile !== undefined && normalizePatchPath(value) !== normalizePatchPath(options.targetFile)) {
      malformed(`patch file ${value} differs from target ${options.targetFile}`);
    }
  };
  for (let i = 0; i < lines.length;) {
    const line = stripCr(lines[i] );
    const header = HUNK_HEADER.exec(line);
    if (header) {
      started = true;
      const oldStart = Number(header[1]);
      const oldCount = Number(header[2] ?? 1);
      const newStart = Number(header[3]);
      const newCount = Number(header[4] ?? 1);
      if (![oldStart, oldCount, newStart, newCount].every(Number.isSafeInteger)) malformed('invalid hunk range');
      const body                         = [];
      let oldRead = 0;
      let newRead = 0;
      let markerAllowed = false;
      i += 1;
      while (i < lines.length) {
        const entry = lines[i] ;
        if (stripCr(entry) === NO_NEWLINE_AT_EOF_MARKER) {
          if (!markerAllowed) malformed('no-newline marker must directly follow a body line');
          body[body.length - 1] = { ...body[body.length - 1] , noNewline: true };
          markerAllowed = false;
          i += 1;
          continue;
        }
        if (oldRead === oldCount && newRead === newCount) break;
        if (entry !== '' && !/^[ +\-]/.test(entry)) malformed('hunk body shorter than its header counts');
        const marker = (entry === '' ? ' ' : entry[0])                                  ;
        oldRead += marker === '+' ? 0 : 1;
        newRead += marker === '-' ? 0 : 1;
        if (oldRead > oldCount || newRead > newCount) malformed('hunk body longer than its header counts');
        body.push({ marker, text: entry === '' ? '' : entry.slice(1), noNewline: false });
        markerAllowed = true;
        i += 1;
      }
      if (oldRead !== oldCount || newRead !== newCount) malformed('hunk body shorter than its header counts');
      hunks.push({ oldStart, oldCount, newStart, newCount, lines: body });
      continue;
    }
    if (line.startsWith('@@')) malformed('malformed hunk header');
    if (line.startsWith('diff --git ')) {
      if (diffSeen || oldPath !== null || hunks.length > 0) malformed('multiple file sections');
      diffSeen = true;
      started = true;
      const match = /^diff --git (?:".*?"|\S+) (.+)$/.exec(line);
      if (!match) malformed('malformed file section');
      diffPath = match [1] ;
    } else if (line.startsWith('--- ')) {
      if (oldPath !== null || newPath !== null || hunks.length > 0) malformed('multiple file sections');
      started = true;
      oldPath = line.slice(4).split('\t')[0] ;
    } else if (line.startsWith('+++ ')) {
      if (newPath !== null || oldPath === null || hunks.length > 0) malformed('multiple or incomplete file sections');
      newPath = line.slice(4).split('\t')[0] ;
    } else if (started && !FILE_HEADER.test(line)) {
      if (line !== '' || lines.slice(i).some((remaining) => remaining !== '')) {
        malformed('hunk body longer than its header counts');
      }
    }
    i += 1;
  }
  if (hunks.length === 0) malformed('patch has no parsable hunks');
  const sectionPath = newPath === '/dev/null' ? oldPath : newPath ?? diffPath;
  if (sectionPath !== null) checkTarget(sectionPath);
  return hunks;
}

export const parseUnifiedPatchHunks = parseUnifiedPatch;

export function locateUnifiedPatchHunks(source                 , hunks                             , options                                             )                {
  const located                = [];
  let minStart = 0;
  const window = options?.window ?? HUNK_LOCATOR_WINDOW;
  if (!Number.isSafeInteger(window) || window < 0) throw new UnifiedPatchApplicationError('invalid locator window', 'out-of-range');
  for (const hunk of hunks) {
    const declaredIndex = hunkOldLineIndex(hunk.oldStart, hunk.oldCount);
    const old = oldLinesOf(hunk);
    const overlap = ()        => { throw new UnifiedPatchApplicationError(`hunk @@ -${hunk.oldStart} overlaps an earlier hunk`, 'hunk-overlap'); };
    const ambiguous = (hits          )        => { throw new UnifiedPatchApplicationError(`ambiguous patch context for hunk @@ -${hunk.oldStart}: ${hits.length} exact matches at lines ${hits.map((p) => p + 1).join(', ')}`, 'context-ambiguous'); };
    const matches = (p        ) => p >= 0 && p + old.length <= source.lines.length && old.every((entry, i) => entry.text === source.lines[p + i] && oldSideNewlineAgrees({ noNewline: entry.noNewline, lineIndex: p + i, lineCount: source.lines.length, fileEndsWithNewline: source.endsWithNewline }));
    let index                    ;
    if (old.length === 0) {
      if (declaredIndex > source.lines.length) throw new UnifiedPatchApplicationError(`hunk @@ -${hunk.oldStart} starts past the end of file`, 'out-of-range');
      index = declaredIndex;
    } else {
      if (options?.mode !== 'unique') {
        for (let d = 0; d <= window; d += 1) {
          const hits = [...new Set([declaredIndex - d, declaredIndex + d])].filter((p) => p >= minStart && matches(p));
          if (hits.length > 1) ambiguous(hits);
          if (hits.length === 1) { index = hits[0] ; break; }
        }
      }
      if (index === undefined) {
        const hits           = [];
        for (let p = 0; p <= source.lines.length - old.length; p += 1) if (matches(p)) hits.push(p);
        if (hits.length > 1) ambiguous(hits);
        if (hits.length === 0) throw new UnifiedPatchApplicationError(`patch context not found for hunk @@ -${hunk.oldStart}`, 'context-not-found');
        index = hits[0] ;
      }
    }
    if (index < minStart) overlap();
    located.push({ hunk, declaredIndex, index, offset: index - declaredIndex });
    minStart = index + old.length;
  }
  return located;
}

export function hunkOffsetsOf(located                        )               {
  return located.map(({ hunk, offset }) => ({ declaredOldStart: hunk.oldStart, appliedOldStart: hunk.oldStart + offset, offset }));
}

export function locatedLineIndexes(located                        )                                           {
  const covered           = [];
  const changed           = [];
  for (const { hunk, index } of located) {
    let cursor = index;
    for (const entry of hunk.lines) {
      if (entry.marker === '+') { changed.push(cursor); continue; }
      covered.push(cursor);
      if (entry.marker === '-') changed.push(cursor);
      cursor += 1;
    }
  }
  return { covered, changed };
}

export function splitSourceText(before        )                  {
  const lineEnding = /\r\n/.test(before) ? '\r\n' : '\n';
  const endsWithNewline = before.endsWith('\n');
  if (before.length === 0) return { lineEnding, endsWithNewline: false, lines: [] };
  const lines = before.split('\n');
  if (endsWithNewline) lines.pop();
  return { lineEnding, endsWithNewline, lines };
}

/** The terminator a split line carries: CRLF when its text ends in CR. */
export function lineEol(line        , isLast         , endsWithNewline         )                     {
  if (isLast && !endsWithNewline) return '';
  return line.endsWith('\r') ? '\r\n' : '\n';
}

/**
 * Join lines split by `splitSourceText`. Each line already carries its own CR,
 * so the separator is always LF; `_lineEnding` is kept for call-site
 * compatibility and does not rewrite any line.
 */
export function joinSourceText(lines                   , _lineEnding        , endsWithNewline         )         {
  if (lines.length === 0) return '';
  const joined = lines.join('\n');
  return endsWithNewline ? `${joined}\n` : joined;
}

/** True when the patch line's newline flag matches the source line git would require. */
export function oldSideNewlineAgrees(input

 )          {
  const sourceHasNewline = input.lineIndex < input.lineCount - 1 || input.fileEndsWithNewline;
  return input.noNewline !== sourceHasNewline;
}

function oldLinesOf(hunk                  )                                  {
  return hunk.lines.filter((line) => line.marker !== '+');
}

function newLinesOf(hunk                  )                                  {
  return hunk.lines.filter((line) => line.marker !== '-');
}

/**
 * Reject a marker that is not on the final line of its side. Git only emits
 * `\ No newline at end of file` for the last line of the old or new file.
 */
export function eofMarkerViolation(hunks                        , baseLineCount        )                {
  for (const [position, { hunk, index: start }] of hunks.entries()) {
    const oldLines = oldLinesOf(hunk);
    const newLines = newLinesOf(hunk);
    for (let index = 0; index < oldLines.length; index += 1) {
      if (!oldLines[index] .noNewline) continue;
      if (baseLineCount === 0 || start + index !== baseLineCount - 1) {
        return 'no-newline marker is not at end of file';
      }
    }
    for (let index = 0; index < newLines.length; index += 1) {
      if (!newLines[index] .noNewline) continue;
      // The marker must end the final output line: last line of the last hunk,
      // and that hunk must reach the end of the base (#374 item 2).
      const reachesEof = baseLineCount === 0 || start + oldLines.length >= baseLineCount;
      if (index !== newLines.length - 1 || !reachesEof || position !== hunks.length - 1) return 'no-newline marker is not at end of file';
    }
  }
  return null;
}

/** Final-newline decision for hunks already known to apply to a base of `baseLineCount` lines. */
export function eofNewlineDecision(hunks                        , baseLineCount        )                     {
  let present = false;
  let absent = false;
  for (const { hunk, index: start } of hunks) {
    const oldLines = oldLinesOf(hunk);
    const newLines = newLinesOf(hunk);
    // A pure insertion after the last line reaches EOF too (#374 item 1).
    const reachesEof = baseLineCount === 0
      ? newLines.length > 0 || oldLines.length > 0
      : start + oldLines.length >= baseLineCount;
    if (newLines.some((line) => line.noNewline) && (baseLineCount === 0 || reachesEof)) {
      absent = true;
      continue;
    }
    if (reachesEof || oldLines.some((line) => line.noNewline)) present = true;
  }
  if (absent) return 'absent';
  if (present) return 'present';
  return 'preserve';
}

export function resolveEofNewline(decision                    , fileEndsWithNewline         )          {
  if (decision === 'preserve') return fileEndsWithNewline;
  return decision === 'present';
}

/** True when any hunk body line contains a CR (a CR-aware patch). */
export function patchCarriesCr(hunks                             )          {
  return hunks.some((hunk) => hunk.lines.some((line) => line.text.includes('\r')));
}

/**
 * New-side lines of a hunk (context and added, in order) as they land in the
 * file (#362 AC3). Context lines are the exact matched text.
 * - A patch that carries CR anywhere is applied verbatim: each added line keeps
 *   exactly the terminator written in the patch, as `git apply` does.
 * - A CR-free patch states no line-ending intent. Its added lines follow the
 *   nearest old line: inside a hunk with context that is a matched LF line, so
 *   the result equals git's; a pure insertion (no old lines) takes the EOL of
 *   the file line before the insertion point (else the one after it); a CR on
 *   a final line without a newline is content, not an EOL, and is ignored. This
 *   pure-insertion case is the only place the result can differ from
 *   `git apply`, which would insert a bare LF line into a CRLF run.
 * A line that ends the file without a newline never gains a CR.
 */
export function newSideLineTexts(hunk                  , sourceLines                   , index        , carriesCr         , endsWithNewline         )           {
  const newSide = newLinesOf(hunk);
  const pureInsertion = oldLinesOf(hunk).length === 0;
  const neighbourIndex = index > 0 ? index - 1 : index;
  const neighbour = sourceLines[neighbourIndex];
  const neighbourTerminated = neighbourIndex < sourceLines.length - 1 || endsWithNewline;
  const takeCrlf = !carriesCr && pureInsertion && neighbour !== undefined && neighbourTerminated && neighbour.endsWith('\r');
  return newSide.map((entry) => (takeCrlf && entry.marker === '+' && !entry.noNewline ? `${entry.text}\r` : entry.text));
}

/** Parse, locate with exact context, and apply one file's unified patch. */
export function applyUnifiedPatchDetailed(before        , patchText        , options                                                                  )                                                                      {
  return applyParsedUnifiedPatchDetailed(before, parseUnifiedPatch(patchText, options), options);
}

/** Apply already parsed hunks so callers can validate once before overlap checks. */
export function applyParsedUnifiedPatchDetailed(before        , hunks                             , options                                             )                                                                      {
  const source = splitSourceText(before);
  const located = locateUnifiedPatchHunks(source, hunks, options);
  const markerError = eofMarkerViolation(located, source.lines.length);
  if (markerError) throw new UnifiedPatchApplicationError(markerError, 'eof-marker');
  const output           = [];
  const carriesCr = patchCarriesCr(hunks);
  let cursor = 0;
  for (const { hunk, index } of located) {
    output.push(...source.lines.slice(cursor, index));
    output.push(...newSideLineTexts(hunk, source.lines, index, carriesCr, source.endsWithNewline));
    cursor = index + oldLinesOf(hunk).length;
  }
  output.push(...source.lines.slice(cursor));
  const endsWithNewline = resolveEofNewline(eofNewlineDecision(located, source.lines.length), source.endsWithNewline);
  return { text: joinSourceText(output, source.lineEnding, endsWithNewline), hunkOffsets: hunkOffsetsOf(located), located };
}

export function applyUnifiedPatch(before        , patchText        , options                                                                  )         {
  return applyUnifiedPatchDetailed(before, patchText, options).text;
}
