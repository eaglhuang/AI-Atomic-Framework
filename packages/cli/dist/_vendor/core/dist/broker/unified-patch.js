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
//
// `\ No newline at end of file` is part of that contract. Git attaches the
// marker to the preceding hunk line. On a context line it describes both sides;
// on a removed line only the old side; on an added line only the new side.
// Adding or removing the final newline is a real edit, and a file that does not
// end with a newline must round-trip byte for byte.
export const UNIFIED_PATCH_APPLICATION_SCHEMA_ID = 'atm.unifiedPatchApplication.v1';
export const NO_NEWLINE_AT_EOF_MARKER = '\\ No newline at end of file';
export class UnifiedPatchApplicationError extends Error {
    code = 'ATM_UNIFIED_PATCH_CONTEXT_MISMATCH';
    constructor(message) {
        super(message);
        this.name = 'UnifiedPatchApplicationError';
    }
}
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
/** Old-file line index of a hunk. Unified diffs use 0 only for an empty preimage. */
export function hunkOldLineIndex(oldStart) {
    return oldStart <= 0 ? 0 : oldStart - 1;
}
/** Parse the hunks of a unified diff; shared with the steward base composer. */
export function parseUnifiedPatchHunks(patchText) {
    const lines = patchText.split(/\r?\n/);
    // A patch normally ends with a newline, which split() turns into a trailing
    // empty element. That element is punctuation, not a blank context line, and
    // treating it as one demands an empty line the source does not have.
    if (lines.length > 0 && lines[lines.length - 1] === '')
        lines.pop();
    const hunks = [];
    let current = null;
    for (const line of lines) {
        const header = HUNK_HEADER.exec(line);
        if (header) {
            if (current)
                hunks.push(current);
            current = { oldStart: Number.parseInt(header[1], 10), lines: [] };
            continue;
        }
        if (!current)
            continue;
        if (line === NO_NEWLINE_AT_EOF_MARKER) {
            const previous = current.lines[current.lines.length - 1];
            if (previous)
                current.lines[current.lines.length - 1] = { ...previous, noNewline: true };
            continue;
        }
        // File headers can only appear before the first hunk; inside a hunk a
        // leading '---'/'+++' is ordinary content and must be kept.
        if (line.startsWith(' ') || line.startsWith('-') || line.startsWith('+')) {
            current.lines.push({
                marker: line[0],
                text: line.slice(1),
                noNewline: false
            });
            continue;
        }
        if (line === '') {
            // A bare empty line inside a hunk is an unprefixed context line for an
            // empty source line; some emitters strip the trailing space.
            current.lines.push({ marker: ' ', text: '', noNewline: false });
            continue;
        }
        // Anything else ends the hunk body.
        hunks.push(current);
        current = null;
    }
    if (current)
        hunks.push(current);
    return hunks;
}
export function splitSourceText(before) {
    const lineEnding = /\r\n/.test(before) ? '\r\n' : '\n';
    const endsWithNewline = before.endsWith('\n');
    if (before.length === 0)
        return { lineEnding, endsWithNewline: false, lines: [] };
    const lines = before.split(/\r?\n/);
    if (endsWithNewline)
        lines.pop();
    return { lineEnding, endsWithNewline, lines };
}
export function joinSourceText(lines, lineEnding, endsWithNewline) {
    if (lines.length === 0)
        return '';
    const joined = lines.join(lineEnding);
    return endsWithNewline ? `${joined}${lineEnding}` : joined;
}
/** True when the patch line's newline flag matches the source line git would require. */
export function oldSideNewlineAgrees(input) {
    const sourceHasNewline = input.lineIndex < input.lineCount - 1 || input.fileEndsWithNewline;
    return input.noNewline !== sourceHasNewline;
}
function oldLinesOf(hunk) {
    return hunk.lines.filter((line) => line.marker !== '+');
}
function newLinesOf(hunk) {
    return hunk.lines.filter((line) => line.marker !== '-');
}
/**
 * Reject a marker that is not on the final line of its side. Git only emits
 * `\ No newline at end of file` for the last line of the old or new file.
 */
export function eofMarkerViolation(hunks, baseLineCount) {
    for (const hunk of hunks) {
        const oldLines = oldLinesOf(hunk);
        const newLines = newLinesOf(hunk);
        const start = hunkOldLineIndex(hunk.oldStart);
        for (let index = 0; index < oldLines.length; index += 1) {
            if (!oldLines[index].noNewline)
                continue;
            if (baseLineCount === 0 || start + index !== baseLineCount - 1) {
                return 'no-newline marker is not at end of file';
            }
        }
        for (let index = 0; index < newLines.length; index += 1) {
            if (!newLines[index].noNewline)
                continue;
            const reachesEof = baseLineCount === 0 || start + oldLines.length >= baseLineCount;
            if (index !== newLines.length - 1 || !reachesEof)
                return 'no-newline marker is not at end of file';
        }
    }
    return null;
}
/** Final-newline decision for hunks already known to apply to a base of `baseLineCount` lines. */
export function eofNewlineDecision(hunks, baseLineCount) {
    let present = false;
    let absent = false;
    for (const hunk of hunks) {
        const oldLines = oldLinesOf(hunk);
        const newLines = newLinesOf(hunk);
        const start = hunkOldLineIndex(hunk.oldStart);
        const reachesEof = baseLineCount === 0
            ? newLines.length > 0 || oldLines.length > 0
            : oldLines.length > 0 && start + oldLines.length >= baseLineCount;
        if (newLines.some((line) => line.noNewline) && (baseLineCount === 0 || reachesEof)) {
            absent = true;
            continue;
        }
        if (reachesEof || oldLines.some((line) => line.noNewline))
            present = true;
    }
    if (absent)
        return 'absent';
    if (present)
        return 'present';
    return 'preserve';
}
export function resolveEofNewline(decision, fileEndsWithNewline) {
    if (decision === 'preserve')
        return fileEndsWithNewline;
    return decision === 'present';
}
/**
 * Apply a unified diff to `before`, returning the exact resulting text.
 *
 * Throws {@link UnifiedPatchApplicationError} when a hunk's context or removed
 * lines do not match the source at the position the hunk declares. Callers must
 * surface that as a blocked apply; they must not fall back to any other write.
 */
export function applyUnifiedPatch(before, patchText) {
    const hunks = parseUnifiedPatchHunks(patchText);
    if (hunks.length === 0)
        return before;
    const source = splitSourceText(before);
    const markerError = eofMarkerViolation(hunks, source.lines.length);
    if (markerError)
        throw new UnifiedPatchApplicationError(markerError);
    const output = [];
    let cursor = 0;
    for (const hunk of hunks) {
        const start = hunkOldLineIndex(hunk.oldStart);
        if (start < cursor) {
            throw new UnifiedPatchApplicationError(`hunk at old line ${hunk.oldStart} overlaps an earlier hunk`);
        }
        if (start > source.lines.length) {
            throw new UnifiedPatchApplicationError(`hunk at old line ${hunk.oldStart} starts past the end of a ${source.lines.length}-line file`);
        }
        output.push(...source.lines.slice(cursor, start));
        cursor = start;
        for (const entry of hunk.lines) {
            if (entry.marker === '+') {
                output.push(entry.text);
                continue;
            }
            const actual = source.lines[cursor];
            if (actual === undefined || actual !== entry.text) {
                throw new UnifiedPatchApplicationError(`patch context mismatch at line ${cursor + 1}: expected ${JSON.stringify(entry.text)}, found ${JSON.stringify(actual ?? null)}`);
            }
            if (!oldSideNewlineAgrees({
                noNewline: entry.noNewline,
                lineIndex: cursor,
                lineCount: source.lines.length,
                fileEndsWithNewline: source.endsWithNewline
            })) {
                throw new UnifiedPatchApplicationError(`patch newline mismatch at line ${cursor + 1}: the ${entry.noNewline ? 'old side omits' : 'old side keeps'} the end-of-file newline`);
            }
            cursor += 1;
            if (entry.marker === ' ')
                output.push(entry.text);
        }
    }
    output.push(...source.lines.slice(cursor));
    const endsWithNewline = resolveEofNewline(eofNewlineDecision(hunks, source.lines.length), source.endsWithNewline);
    return joinSourceText(output, source.lineEnding, endsWithNewline);
}
