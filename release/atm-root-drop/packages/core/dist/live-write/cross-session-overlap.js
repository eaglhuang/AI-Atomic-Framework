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
import { hashContent } from '../broker/adapters/cas.js';
import { diffLineBlocks, lineTokens, mapBaseLineForward } from '../broker/stale-base-translation.js';
export const CROSS_SESSION_OVERLAP_INSTRUCTION = 'Another session changed the lines this write deletes or modifies. Re-decide explicitly: submit a patch that keeps their change (merge both intents), abandon this edit, or resubmit with --ack-overlap naming every listed proposalId to override it on purpose.';
/** Change blocks between two texts, from a list of [start, end) replacements in `before` coordinates. */
export function committedBlocks(before, changes) {
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
export function diffCommittedBlocks(before, after) {
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
export function ensureAnchor(cwd, input) {
    const existing = readAnchors(cwd).find((entry) => entry.actorId === input.actorId && (entry.taskId ?? null) === input.taskId && entry.file === input.file);
    if (existing)
        return { anchor: existing, existed: true };
    const anchor = {
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
export function readAnchors(cwd) {
    const target = path.join(cwd, anchorsRelativePath());
    if (!existsSync(target))
        return [];
    return readFileSync(target, 'utf8').split('\n').filter((line) => line.trim()).map((line) => JSON.parse(line));
}
export function anchorsRelativePath() {
    return path.join('.atm', 'runtime', 'live-write-anchors.jsonl');
}
/**
 * Journal entries for the file committed since the anchor base (journal order).
 * The anchor is located on the journal's hash chain; when its hash is not on the
 * chain, Git ancestry decides (entries whose commit descends from the newest
 * commit holding the anchor text); when that is unknown too, every entry counts (fail closed).
 */
export function entriesSinceAnchor(cwd, entries, anchor, currentHash) {
    const forFile = entries.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.file === anchor.file);
    const anchorHash = bare(anchor.baseHash);
    let start = -1;
    for (const { entry, index } of forFile)
        if (bare(entry.afterHash) === anchorHash && index < anchor.journalIndex)
            start = index + 1;
    if (start < 0)
        start = forFile.find(({ entry }) => bare(entry.baseHash) === anchorHash)?.index ?? -1;
    if (start >= 0)
        return forFile.filter(({ index }) => index >= start).map(({ entry }) => entry);
    if (anchorHash === bare(currentHash) && forFile.every(({ index }) => index < anchor.journalIndex))
        return [];
    const anchorCommit = commitHoldingText(cwd, anchor.file, anchorHash);
    if (anchorCommit === null)
        return forFile.map(({ entry }) => entry);
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
export function findCrossSessionOverlaps(input) {
    const targets = input.targets.filter((range) => range.end > range.start);
    if (targets.length === 0)
        return [];
    const currentTokens = lineTokens(input.currentText);
    const found = [];
    input.entries.forEach((entry, position) => {
        if (!entry.actorId || entry.actorId === input.actorId || !entry.blocks || entry.blocks.length === 0)
            return;
        const mapper = forwardMapper(entry, input.entries.slice(position + 1), input.currentHash, currentTokens, input.readAfterText);
        if (mapper === null)
            return;
        const hitLines = [];
        const hitBlocks = [];
        for (const block of entry.blocks) {
            let hit = false;
            if (block.afterEnd > block.afterStart) {
                for (let line = block.afterStart; line < block.afterEnd; line += 1) {
                    const mapped = mapper(line);
                    if (mapped !== null && targets.some((range) => range.start <= mapped && mapped < range.end)) {
                        hitLines.push(mapped);
                        hit = true;
                    }
                }
            }
            else if (input.includeDeletionGaps) {
                const gap = mapper(block.afterStart);
                if (gap !== null && targets.some((range) => range.start < gap && gap < range.end)) {
                    hitLines.push(gap);
                    hit = true;
                }
            }
            if (hit)
                hitBlocks.push(block);
        }
        if (hitBlocks.length === 0)
            return;
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
function forwardMapper(entry, later, currentHash, currentTokens, readAfterText) {
    const steps = [];
    let last = entry;
    for (const next of later) {
        if (bare(next.baseHash) !== bare(last.afterHash) || !next.blocks)
            break;
        steps.push(next.blocks);
        last = next;
    }
    let tail = null;
    if (bare(last.afterHash) !== bare(currentHash)) {
        const text = readAfterText(last);
        if (text === null)
            return null;
        tail = diffLineBlocks(lineTokens(text), currentTokens);
    }
    return (line) => {
        let value = line;
        for (const blocks of steps) {
            value = mapThroughBlocks(value, blocks);
            if (value === null)
                return null;
        }
        return tail === null ? value : mapBaseLineForward(value, tail);
    };
}
/** A line's index after one committed change, or null when the change rewrote it. */
export function mapThroughBlocks(line, blocks) {
    let delta = 0;
    for (const block of [...blocks].sort((l, r) => l.beforeStart - r.beforeStart)) {
        if (block.beforeEnd <= line) {
            delta += block.added.length - (block.beforeEnd - block.beforeStart);
            continue;
        }
        if (block.beforeStart <= line)
            return null;
        break;
    }
    return line + delta;
}
function bare(value) {
    return value.replace(/^sha256:/, '');
}
function commitHoldingText(cwd, file, hash, maxCommits = 200) {
    const history = spawnSync('git', ['-C', cwd, 'rev-list', `--max-count=${maxCommits}`, 'HEAD', '--', file], { encoding: 'utf8' });
    if (history.status !== 0)
        return null;
    for (const sha of history.stdout.trim().split('\n').filter(Boolean)) {
        const result = spawnSync('git', ['-C', cwd, 'cat-file', '-p', `${sha}:${file}`]);
        if (result.status === 0 && bare(hashContent(result.stdout.toString('utf8'))) === hash)
            return sha;
    }
    return null;
}
function isAncestor(cwd, ancestor, descendant) {
    return spawnSync('git', ['-C', cwd, 'merge-base', '--is-ancestor', ancestor, descendant]).status === 0;
}
/** The text of `file` at `commitSha`, or null. */
export function gitFileAt(cwd, commitSha, file) {
    if (!commitSha)
        return null;
    const result = spawnSync('git', ['-C', cwd, 'cat-file', '-p', `${commitSha}:${file}`]);
    return result.status === 0 ? result.stdout.toString('utf8') : null;
}
export function describeOverlaps(overlaps) {
    return overlaps.map((overlap) => {
        const lines = overlap.currentLines.map((range) => (range.start === range.end ? `${range.start}` : `${range.start}-${range.end}`)).join(', ');
        return `session ${overlap.actorId} (proposal ${overlap.proposalId}, commit ${overlap.commitSha ?? overlap.afterHash}) changed current line(s) ${lines}`;
    }).join('; ');
}
function toRanges(lines) {
    const sorted = [...new Set(lines)].sort((l, r) => l - r);
    const ranges = [];
    for (const line of sorted) {
        const last = ranges.at(-1);
        if (last && line + 1 === last.end + 1)
            last.end = line + 1;
        else
            ranges.push({ start: line + 1, end: line + 1 });
    }
    return ranges;
}
function renderBlocks(file, blocks) {
    const out = [`--- a/${file}`, `+++ b/${file}`];
    for (const block of blocks) {
        out.push(`@@ -${block.beforeStart + 1},${block.removed.length} +${block.afterStart + 1},${block.added.length} @@`);
        for (const token of block.removed)
            out.push(`-${token.replace(/\n$/, '')}`);
        for (const token of block.added)
            out.push(`+${token.replace(/\n$/, '')}`);
    }
    return `${out.join('\n')}\n`;
}
