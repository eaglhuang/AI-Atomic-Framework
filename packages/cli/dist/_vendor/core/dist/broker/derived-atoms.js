import { createHash } from 'node:crypto';
import { computeCandidateAtomCid } from './candidate-bridge.js';
/**
 * Derived atom identity helpers (TASK-ASP-0006).
 *
 * A derived atom is computed from source code on demand; it is never stored
 * as a second registry. These helpers make the candidate list identity-stable
 * before `computeCandidateAtomCid` hashes it:
 *
 * - consecutive same-kind, same-symbol candidates in one file (TypeScript
 *   overload signatures followed by the implementation) merge into one atom;
 * - remaining same-kind, same-symbol duplicates get an `ordinal` in source
 *   order. Atoms without duplicates carry no ordinal, so their CID does not
 *   move when unrelated code is added. Inserting a new same-name atom before
 *   an existing one shifts that atom's ordinal (documented limitation).
 */
export function normalizeDerivedCandidates(candidates) {
    const byFile = new Map();
    for (const candidate of candidates) {
        const key = candidate.filePath.replace(/\\/g, '/');
        byFile.set(key, [...(byFile.get(key) ?? []), candidate]);
    }
    const normalized = [];
    for (const fileCandidates of byFile.values()) {
        const ordered = [...fileCandidates].sort((left, right) => (left.lineStart ?? 0) - (right.lineStart ?? 0));
        const merged = [];
        for (const candidate of ordered) {
            const previous = merged[merged.length - 1];
            if (previous && previous.kind === candidate.kind && previous.symbol === candidate.symbol) {
                merged[merged.length - 1] = {
                    ...previous,
                    lineEnd: maxLine(previous.lineEnd, candidate.lineEnd)
                };
                continue;
            }
            merged.push(candidate);
        }
        const totals = new Map();
        for (const candidate of merged) {
            const key = `${candidate.kind}\u0000${candidate.symbol}`;
            totals.set(key, (totals.get(key) ?? 0) + 1);
        }
        const seen = new Map();
        for (const candidate of merged) {
            const key = `${candidate.kind}\u0000${candidate.symbol}`;
            if ((totals.get(key) ?? 0) < 2) {
                const { ordinal: _ordinal, ...rest } = candidate;
                normalized.push(rest);
                continue;
            }
            const ordinal = seen.get(key) ?? 0;
            seen.set(key, ordinal + 1);
            normalized.push({ ...candidate, ordinal });
        }
    }
    return normalized;
}
/**
 * Content version of a line range: SHA-256 over the range text with line
 * endings normalized to LF, so CRLF and LF checkouts agree. Changes here do
 * not change the atom CID.
 */
export function computeAtomContentVersion(sourceText, lineStart, lineEnd) {
    const lines = sourceText.replace(/\r\n?/g, '\n').split('\n');
    const body = lines.slice(Math.max(0, lineStart - 1), Math.max(lineStart, lineEnd)).join('\n');
    return `sha256:${createHash('sha256').update(body).digest('hex')}`;
}
function maxLine(left, right) {
    if (left == null)
        return right;
    if (right == null)
        return left;
    return Math.max(left, right);
}
/** Symbol of the per-file preamble pseudo-atom (imports and top-level statements before the first atom). */
export const DERIVED_PREAMBLE_SYMBOL = '#preamble';
const confidenceRank = { high: 3, medium: 2, low: 1 };
/**
 * Derive the atoms of one file (TASK-ASP-0007). Candidates come from the
 * language adapter; low-confidence candidates are dropped by default so a
 * guess never narrows occupancy. A file with no qualifying candidate yields no
 * atoms, which callers treat as file-level (today's behaviour).
 */
export function deriveFileAtoms(input) {
    const filePath = input.filePath.replace(/\\/g, '/');
    const minimum = confidenceRank[input.minConfidence ?? 'medium'];
    const lineCount = input.sourceText.replace(/\r\n?/g, '\n').split('\n').length;
    const qualifying = normalizeDerivedCandidates(input.candidates
        .filter((candidate) => candidate.filePath.replace(/\\/g, '/') === filePath)
        .filter((candidate) => confidenceRank[candidate.confidence] >= minimum)
        .filter((candidate) => typeof candidate.lineStart === 'number' && candidate.lineStart > 0));
    if (qualifying.length === 0)
        return [];
    const atoms = qualifying.map((candidate) => {
        const lineStart = candidate.lineStart;
        const lineEnd = Math.min(lineCount, Math.max(lineStart, candidate.lineEnd ?? lineStart));
        return toDerivedAtom({ ...candidate, filePath }, 'symbol', lineStart, lineEnd, input.sourceText);
    });
    const firstLine = Math.min(...atoms.map((atom) => atom.sourceRange.lineStart));
    if (firstLine > 1) {
        atoms.unshift(toDerivedAtom({
            candidateId: `${filePath}:${DERIVED_PREAMBLE_SYMBOL}`,
            kind: 'preamble',
            symbol: DERIVED_PREAMBLE_SYMBOL,
            filePath,
            lineStart: 1,
            lineEnd: firstLine - 1,
            confidence: 'high',
            detectionMethod: 'derived-preamble'
        }, 'preamble', 1, firstLine - 1, input.sourceText));
    }
    return atoms;
}
function toDerivedAtom(candidate, region, lineStart, lineEnd, sourceText) {
    const atomCid = computeCandidateAtomCid(candidate);
    return {
        atomId: `ATM-DERIVED-${atomCid.slice(0, 12)}`,
        atomCid,
        kind: candidate.kind,
        symbol: candidate.symbol,
        ...(candidate.ordinal == null ? {} : { ordinal: candidate.ordinal }),
        region,
        confidence: candidate.confidence,
        sourceRange: { filePath: candidate.filePath, lineStart, lineEnd },
        contentVersion: computeAtomContentVersion(sourceText, lineStart, lineEnd)
    };
}
/** WriteIntent references for derived atoms: they already exist, so the operation is `modify`. */
export function derivedAtomRefs(atoms) {
    return atoms.map((atom) => ({
        atomId: atom.atomId,
        atomCid: atom.atomCid,
        operation: 'modify',
        sourceRange: { ...atom.sourceRange }
    }));
}
/**
 * Parse `git diff -U0` output into changed line spans on both sides, keyed by
 * the post-image path. A pure deletion is recorded as a one-line span at the
 * deletion point on the new side and as the removed lines on the old side.
 */
export function parseUnifiedZeroDiff(diffText) {
    const files = new Map();
    let current = null;
    for (const line of diffText.replace(/\r\n?/g, '\n').split('\n')) {
        const target = /^\+\+\+ (?:b\/)?(.+)$/.exec(line);
        if (target) {
            const filePath = target[1].trim();
            current = filePath === '/dev/null' ? null : { oldSpans: [], newSpans: [], hunks: [] };
            if (current)
                files.set(filePath, current);
            continue;
        }
        if (line.startsWith('--- '))
            continue;
        const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
        if (hunk && current) {
            const oldStart = Number(hunk[1]);
            const oldCount = hunk[2] == null ? 1 : Number(hunk[2]);
            const newStart = Number(hunk[3]);
            const newCount = hunk[4] == null ? 1 : Number(hunk[4]);
            const oldSpan = oldCount > 0 ? { start: oldStart, end: oldStart + oldCount - 1 } : null;
            const newSpan = newCount > 0
                ? { start: newStart, end: newStart + newCount - 1 }
                : { start: Math.max(1, newStart), end: Math.max(1, newStart) };
            if (oldSpan)
                current.oldSpans.push(oldSpan);
            current.newSpans.push(newSpan);
            current.hunks.push({ oldSpan, newSpan, addedLines: [], removedLines: [] });
            continue;
        }
        const hunkInProgress = current?.hunks[current.hunks.length - 1];
        if (hunkInProgress && line.startsWith('+'))
            hunkInProgress.addedLines.push(line.slice(1));
        else if (hunkInProgress && line.startsWith('-'))
            hunkInProgress.removedLines.push(line.slice(1));
    }
    return files;
}
/**
 * Atoms actually touched by a change (TASK-ASP-0008): old-side atoms that
 * intersect removed lines plus new-side atoms that intersect added lines, so a
 * deleted atom and a newly added atom are both visible. A changed non-blank
 * line outside every atom makes the change file-level (`fileLevel: true`).
 */
export function atomsTouchedByChange(input) {
    if (input.oldAtoms.length === 0 && input.newAtoms.length === 0)
        return { touched: [], fileLevel: true };
    const touched = new Map();
    let fileLevel = false;
    const visit = (atoms, spans, text) => {
        const lines = text.replace(/\r\n?/g, '\n').split('\n');
        for (const span of spans) {
            for (let lineNumber = span.start; lineNumber <= span.end; lineNumber += 1) {
                const owner = atoms.find((atom) => atom.sourceRange.lineStart <= lineNumber && lineNumber <= atom.sourceRange.lineEnd);
                if (owner)
                    touched.set(owner.atomCid, owner);
                else if ((lines[lineNumber - 1] ?? '').trim() !== '')
                    fileLevel = true;
            }
        }
    };
    visit(input.oldAtoms, input.oldSpans, input.oldText);
    visit(input.newAtoms, input.newSpans, input.newText);
    return { touched: [...touched.values()], fileLevel };
}
const importLinePattern = /^\s*(?:import\s|export\s+(?:\*|\{[^}]*\})\s+from\s|(?:const|let|var)\s+[\w${}\s,:]+=\s*require\()/;
/**
 * Import preamble rule (TASK-ASP-0009): a preamble change commutes with other
 * work only when it purely adds import lines (blank lines allowed). Any
 * removed line or non-import addition keeps the preamble exclusive.
 */
export function isAdditiveImportChange(removedLines, addedLines) {
    if (removedLines.some((line) => line.trim() !== ''))
        return false;
    const meaningful = addedLines.filter((line) => line.trim() !== '');
    return meaningful.length > 0 && meaningful.every((line) => importLinePattern.test(line));
}
/**
 * Whether the part of a change that falls in the preamble is a pure import
 * addition. Hunks that do not touch either side's preamble are ignored, so a
 * function edit elsewhere in the file does not make the preamble exclusive.
 */
export function isPreambleChangeAdditive(input) {
    const preambleEnd = (atoms) => atoms.find((atom) => atom.region === 'preamble')?.sourceRange.lineEnd ?? 0;
    const oldEnd = preambleEnd(input.oldAtoms);
    const newEnd = preambleEnd(input.newAtoms);
    const preambleHunks = input.hunks.filter((hunk) => (hunk.oldSpan && hunk.oldSpan.start <= oldEnd) || hunk.newSpan.start <= newEnd);
    if (preambleHunks.length === 0)
        return false;
    return isAdditiveImportChange(preambleHunks.flatMap((hunk) => hunk.removedLines), preambleHunks.flatMap((hunk) => hunk.addedLines));
}
/**
 * Compare atoms confirmed by this change against atoms other active tasks have
 * reserved or confirmed. Only declared/confirmed atoms count: an undeclared
 * task holds a shareable file-level claim and is decided when it commits.
 */
export function findDerivedAtomConflicts(input) {
    const conflicts = [];
    for (const active of input.activeIntents) {
        if (active.taskId === input.taskId)
            continue;
        const activeCids = new Set(active.resourceKeys.atomCids);
        const activeRanges = active.resourceKeys.atomRanges ?? [];
        for (const file of input.files) {
            if (file.fileLevel) {
                const held = activeRanges.find((range) => range.filePath === file.filePath);
                if (held)
                    conflicts.push({ taskId: active.taskId, atomCid: held.atomCid, filePath: file.filePath, reason: 'file-level-change' });
                continue;
            }
            for (const atom of file.touched) {
                if (atom.region === 'preamble' && file.preambleAdditive)
                    continue;
                if (activeCids.has(atom.atomCid)) {
                    conflicts.push({ taskId: active.taskId, atomCid: atom.atomCid, filePath: file.filePath, reason: 'same-atom' });
                }
            }
        }
    }
    return conflicts;
}
/**
 * Record confirmed atoms on this task's active intent so later claims and
 * commits see them through the existing VirtualAtomInUse projection. Earlier
 * reservations and confirmations are kept (union); they are released with the
 * intent when the task closes.
 */
export function mergeIntentDerivedAtoms(doc, taskId, refs) {
    return {
        ...doc,
        activeIntents: doc.activeIntents.map((intent) => {
            if (intent.taskId !== taskId)
                return intent;
            const atomIds = [...intent.resourceKeys.atomIds];
            const atomCids = [...intent.resourceKeys.atomCids];
            const atomRanges = [...(intent.resourceKeys.atomRanges ?? [])];
            for (const ref of refs) {
                if (atomCids.includes(ref.atomCid))
                    continue;
                atomIds.push(ref.atomId);
                atomCids.push(ref.atomCid);
                if (ref.sourceRange)
                    atomRanges.push({ ...ref.sourceRange, atomCid: ref.atomCid });
            }
            return { ...intent, resourceKeys: { ...intent.resourceKeys, atomIds, atomCids, atomRanges } };
        })
    };
}
