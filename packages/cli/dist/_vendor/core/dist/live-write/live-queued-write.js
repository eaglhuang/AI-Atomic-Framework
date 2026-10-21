/**
 * 即時寫入。不讀預先算好的 merge plan。
 *
 * 同一檔的鎖只包住「讀現況、決定、寫入、git commit」。
 * 第一筆 base 相符的寫入立刻提交。
 * 之後的寫入若改到已經提交的行，在碰檔案之前拒絕，帶回現在的內容，並留下佇列紀錄。
 * 不相交、而且上下文仍對得上現況的寫入，直接套上。
 * 宣告的 base 對不上、又沒有這條路徑自己提交過的不相交紀錄時，當成 stale-base，不寫。
 * 宣告的 base 對不上時，patch 先在它自己的 base 定位，再翻譯到目前檔案（#363），
 * 絕不在目前檔案的舊行號重讀。它刪改的行在 base 之後被改過就拒絕，不套到別處。
 *
 * 原始意圖錨定（#360）：session 第一次對某檔送出的 base 是它的錨點。之後的寫入，
 * 不論 base 新舊，只要刪改到其他 session 在錨點之後提交的行，就以 `cross-session-overlap`
 * 拒絕，指名對方 session、proposal、commit 與 diff，檔案不動。見 cross-session-overlap.ts。
 *
 * 既有的 `broker steward apply --merge-plan-file` 不受影響。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { hashContent } from '../broker/adapters/cas.js';
import { canonicalCommitLockPath, defaultStewardCommitLockRoot } from '../broker/steward-commit-guard.js';
import { acquireKernelAdvisoryLock, releaseKernelAdvisoryLock, StewardLockTimeoutError } from '../broker/steward-kernel-lock.js';
import { readJournal, isCommitted, RecoveryRequiredError } from './live-write-journal-store.js';
import { commitLiveWrite, reconcileLiveWrites, GitIndexContentionError } from './live-write-commit.js';
import { UnifiedPatchApplicationError, applyParsedUnifiedPatchDetailed, locateUnifiedPatchHunks, locatedLineIndexes, splitSourceText, hunkOldLineIndex, parseUnifiedPatchHunks } from '../broker/unified-patch.js';
import { findCommittedBaseText, lineTokens, patchChangeBlocks, translateStalePatch } from '../broker/stale-base-translation.js';
import { CROSS_SESSION_OVERLAP_INSTRUCTION, committedBlocks, describeOverlaps, diffCommittedBlocks, ensureAnchor, entriesSinceAnchor, findCrossSessionOverlaps, gitFileAt } from './cross-session-overlap.js';
const LOCK_WAIT_MS = 30_000;
const LOCK_POLL_MS = 5;
export function applyLiveQueuedWrites(input) {
    const cwd = path.resolve(input.cwd);
    const scope = new Set((input.scopeFiles ?? []).map((file) => normalize(file)));
    const writes = [];
    const groups = new Map();
    for (const proposal of input.proposals) {
        const file = normalize(proposal.targetFile);
        const list = groups.get(file) ?? [];
        list.push(proposal);
        groups.set(file, list);
    }
    for (const file of [...groups.keys()].sort((left, right) => left.localeCompare(right))) {
        const proposals = groups.get(file) ?? [];
        if (scope.size > 0 && !scope.has(file)) {
            for (const proposal of proposals) {
                writes.push(rejected(proposal, file, 'outside-scope', false, null, null, '目標檔不在 scope'));
            }
            continue;
        }
        writes.push(...applyFileGroup(cwd, file, proposals, input.ackOverlap ?? []));
    }
    return {
        ok: writes.every((write) => write.decision === 'accepted'),
        writes,
        queuePath: queueRelativePath(),
        planRequired: false
    };
}
function applyFileGroup(cwd, file, proposals, ack) {
    const targetPath = path.resolve(cwd, file);
    if (!existsSync(targetPath) || !statSync(targetPath).isFile()) {
        return proposals.map((proposal) => rejected(proposal, file, 'target-missing', false, null, null, '目標檔不存在'));
    }
    const lockDir = canonicalCommitLockPath(defaultStewardCommitLockRoot(cwd), targetPath);
    try {
        acquireKernelAdvisoryLock(lockDir, LOCK_WAIT_MS, LOCK_POLL_MS, file);
    }
    catch (error) {
        if (error instanceof StewardLockTimeoutError) {
            const current = readCurrent(targetPath);
            return proposals.map((proposal) => kitError(proposal, file, 'live-write-lock-timeout', current.text, current.hash, error.message));
        }
        throw error;
    }
    try {
        try {
            reconcileLiveWrites(cwd, file);
        }
        catch (error) {
            const current = readCurrent(targetPath);
            if (error instanceof RecoveryRequiredError || error instanceof GitIndexContentionError) {
                return proposals.map((proposal) => rejected(proposal, file, error instanceof GitIndexContentionError ? 'git-index-contention' : 'recovery-required', false, current.text, current.hash, error.message));
            }
            return proposals.map((proposal) => kitError(proposal, file, 'live-write-commit-failed', current.text, current.hash, String(error)));
        }
        const results = [];
        for (const proposal of proposals) {
            results.push(applyOneLocked(cwd, file, targetPath, proposal, ack));
        }
        return results;
    }
    finally {
        releaseKernelAdvisoryLock(lockDir);
    }
}
function applyOneLocked(cwd, file, targetPath, proposal, ack) {
    const current = readCurrent(targetPath);
    const declared = normalizeHash(proposal.fileBeforeHash);
    const observed = normalizeHash(current.hash);
    // #360: anchor the session's original target (even a malformed first proposal declares what it saw),
    // then check every write against other sessions' lines committed since it.
    const journal = readJournal(cwd).filter(isCommitted);
    const { anchor, existed } = ensureAnchor(cwd, { actorId: proposal.actorId, taskId: proposal.taskId ?? null, file, declaredHash: declared, proposalId: proposal.proposalId, journalLength: journal.length });
    let hunks;
    try {
        hunks = parseUnifiedPatchHunks(proposal.patch, { targetFile: file });
    }
    catch (error) {
        if (!(error instanceof UnifiedPatchApplicationError))
            throw error;
        return rejected(proposal, file, 'patch-malformed', false, current.text, current.hash, error.message);
    }
    const since = entriesSinceAnchor(cwd, journal, anchor, observed);
    const overlapsFor = (targets, includeDeletionGaps = false) => findCrossSessionOverlaps({
        actorId: proposal.actorId, currentText: current.text, currentHash: current.hash, entries: since, targets, includeDeletionGaps, readAfterText: (entry) => gitFileAt(cwd, entry.commitSha, file) ?? findCommittedBaseText(cwd, file, entry.afterHash)
    });
    const guard = (targets) => {
        const overlaps = overlapsFor(targets);
        if (overlaps.every((overlap) => ack.includes(overlap.proposalId)))
            return { rejection: null, acknowledged: overlaps.map((overlap) => overlap.proposalId) };
        return { rejection: overlapRejection(cwd, proposal, file, current, overlaps, ack), acknowledged: [] };
    };
    if (declared === observed) {
        let applied;
        try {
            applied = applyParsedUnifiedPatchDetailed(current.text, hunks, { mode: 'nearest' });
        }
        catch (error) {
            if (!(error instanceof UnifiedPatchApplicationError))
                throw error;
            // A context mismatch caused by another session's change since the anchor is that session's overlap (#360 AC4).
            const anchorText = normalizeHash(anchor.baseHash) === observed ? null : findCommittedBaseText(cwd, file, anchor.baseHash);
            const fromAnchor = anchorText === null ? null : translateStalePatch({ baseText: anchorText, currentText: current.text, hunks });
            const overlaps = fromAnchor && !fromAnchor.ok ? overlapsFor(conflictRanges(fromAnchor.conflicts), true) : [];
            if (overlaps.length > 0)
                return overlapRejection(cwd, proposal, file, current, overlaps, ack);
            return rejected(proposal, file, 'patch-context-mismatch', false, current.text, current.hash, error.message);
        }
        const changes = changesOf(current.text, applied.text, applied.located);
        const check = guard(targetsOf(changes));
        if (check.rejection)
            return check.rejection;
        return commitPrepared(cwd, file, targetPath, proposal, current.text, applied.text, locatedLineIndexes(applied.located).changed, applied.hunkOffsets, committedBlocks(current.text, changes), check.acknowledged);
    }
    let lines = locatedLineIndexes(hunks.map((hunk) => {
        const index = hunkOldLineIndex(hunk.oldStart, hunk.oldCount);
        return { hunk, index, declaredIndex: index, offset: 0 };
    }));
    const base = findCommittedBaseText(cwd, file, declared);
    if (base !== null) {
        try {
            lines = locatedLineIndexes(locateUnifiedPatchHunks(splitSourceText(base), hunks, { mode: 'nearest' }));
        }
        catch (error) {
            if (!(error instanceof UnifiedPatchApplicationError))
                throw error;
        }
    }
    // #363: translate from the declared base; never re-read the declared lines in the current file.
    const translated = base === null ? null : translateStalePatch({ baseText: base, currentText: current.text, hunks });
    let acknowledged = [];
    if (existed && translated) {
        // A resubmission (the session already anchored this file) is checked against other sessions first.
        const conflicting = translated.ok ? [] : overlapsFor(conflictRanges(translated.conflicts), true);
        const check = translated.ok
            ? guard(translated.blocks.map((block) => ({ start: block.currentStart, end: block.currentEnd })))
            : { rejection: conflicting.length > 0 ? overlapRejection(cwd, proposal, file, current, conflicting, ack) : null, acknowledged: [] };
        if (check.rejection)
            return check.rejection;
        acknowledged = check.acknowledged;
    }
    const prior = journal.filter((entry) => entry.file === file && normalizeHash(entry.baseHash) === declared);
    const overlaps = prior.some((entry) => intersects(entry.changedLines, lines.covered) || intersects(entry.changedLines, lines.changed));
    if (overlaps) {
        return queueRejection(cwd, proposal, file, 'overlapping-write-queued', current, '這筆寫入和已經提交的行重疊，檔案沒有被改');
    }
    if (base === null || translated === null) {
        return queueRejection(cwd, proposal, file, 'stale-base', current, '宣告的 base 不在已提交的歷史裡，無法翻譯到目前檔案');
    }
    if (prior.length === 0) {
        return queueRejection(cwd, proposal, file, 'stale-base', current, '宣告的 base 不是目前檔案，而且沒有可套用的不相交提交');
    }
    if (!translated.ok) {
        return translated.reason === 'stale-base-conflict'
            ? queueRejection(cwd, proposal, file, 'overlapping-write-queued', current, `這筆寫入改到 base 之後被改過的行，檔案沒有被改：${translated.detail}`)
            : queueRejection(cwd, proposal, file, 'stale-base', current, `base 已經前進，這份 patch 對不上它宣告的 base：${translated.detail}`);
    }
    if (translated.text === current.text)
        return rejected(proposal, file, 'no-op-patch', false, current.text, current.hash, 'patch 沒有改變檔案');
    const blocks = committedBlocks(current.text, translated.blocks.map((block) => ({ start: block.currentStart, end: block.currentEnd, added: block.added })));
    return commitPrepared(cwd, file, targetPath, proposal, current.text, translated.text, locatedLineIndexes(translated.located).changed, translated.hunkOffsets, blocks, acknowledged);
}
/** The write's change blocks in `before` coordinates: from the patch structure, else a line diff. */
function changesOf(before, after, located) {
    try {
        return patchChangeBlocks(lineTokens(before), lineTokens(after), located).map((block) => ({ start: block.baseStart, end: block.baseEnd, added: block.added }));
    }
    catch (error) {
        if (!(error instanceof UnifiedPatchApplicationError))
            throw error;
        return diffCommittedBlocks(before, after).map((block) => ({ start: block.beforeStart, end: block.beforeEnd, added: block.added }));
    }
}
/** Lines a write deletes or modifies (pure insertions target nothing). */
function targetsOf(changes) {
    return changes.filter((change) => change.end > change.start).map((change) => ({ start: change.start, end: change.end }));
}
/**
 * Current lines, changed since the patch's base, that the patch's own deleted or modified base lines became.
 * Touching-only conflicts target nothing. An equal-length replacement maps line by line; otherwise the whole
 * changed range counts, and a pure deletion becomes a two-line window around its gap.
 */
function conflictRanges(conflicts) {
    const ranges = [];
    for (const { ours, theirs } of conflicts) {
        const from = Math.max(ours.baseStart, theirs.baseStart);
        const to = Math.min(ours.baseEnd, theirs.baseEnd);
        if (to <= from)
            continue;
        if (theirs.currentEnd === theirs.currentStart)
            ranges.push({ start: Math.max(0, theirs.currentStart - 1), end: theirs.currentStart + 1 });
        else if (theirs.currentEnd - theirs.currentStart === theirs.baseEnd - theirs.baseStart)
            ranges.push({ start: theirs.currentStart + (from - theirs.baseStart), end: theirs.currentStart + (to - theirs.baseStart) });
        else
            ranges.push({ start: theirs.currentStart, end: theirs.currentEnd });
    }
    return ranges;
}
function overlapRejection(cwd, proposal, file, current, overlaps, ack) {
    const unacknowledged = overlaps.filter((overlap) => !ack.includes(overlap.proposalId)).map((overlap) => overlap.proposalId);
    const ackNote = ack.length > 0 ? ` --ack-overlap ${ack.join(',')} does not name ${unacknowledged.join(',')}.` : '';
    appendQueue(cwd, {
        proposalId: proposal.proposalId,
        file,
        reasonCode: 'cross-session-overlap',
        actorId: proposal.actorId,
        overlaps: overlaps.map(({ actorId, proposalId, commitSha }) => ({ actorId, proposalId, commitSha })),
        currentFileHash: current.hash,
        queuedAt: new Date().toISOString()
    });
    return {
        ...rejected(proposal, file, 'cross-session-overlap', true, current.text, current.hash, `cross-session-overlap: ${describeOverlaps(overlaps)}. The file was not changed.${ackNote}`),
        crossSessionOverlap: overlaps,
        instruction: CROSS_SESSION_OVERLAP_INSTRUCTION
    };
}
function commitPrepared(cwd, file, targetPath, proposal, before, next, changedLines, hunkOffsets, blocks, acknowledged) {
    if (next === before)
        return rejected(proposal, file, 'no-op-patch', false, before, hashContent(before), 'patch 沒有改變檔案');
    try {
        const sha = commitLiveWrite(cwd, targetPath, before, next, {
            file, baseHash: hashContent(before), afterHash: hashContent(next), changedLines,
            proposalId: proposal.proposalId, actorId: proposal.actorId, blocks,
            ...(acknowledged.length > 0 ? { acknowledgedOverlap: acknowledged } : {})
        });
        return {
            proposalId: proposal.proposalId,
            file,
            decision: 'accepted',
            reasonCode: null,
            verdict: 'applied',
            queued: false,
            currentFileText: next,
            currentFileHash: hashContent(next),
            commitSha: sha,
            hunkOffsets,
            detail: acknowledged.length > 0 ? `已寫入並提交（--ack-overlap 覆寫 ${acknowledged.join(', ')}）` : '已寫入並提交',
            ...(acknowledged.length > 0 ? { acknowledgedOverlap: acknowledged } : {})
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof GitIndexContentionError || error instanceof RecoveryRequiredError)
            return rejected(proposal, file, error instanceof GitIndexContentionError ? 'git-index-contention' : 'recovery-required', false, before, hashContent(before), message);
        return kitError(proposal, file, 'live-write-commit-failed', before, hashContent(before), message);
    }
}
function queueRejection(cwd, proposal, file, reason, current, detail) {
    appendQueue(cwd, {
        proposalId: proposal.proposalId,
        file,
        reasonCode: reason,
        currentFileHash: current.hash,
        queuedAt: new Date().toISOString()
    });
    return rejected(proposal, file, reason, true, current.text, current.hash, detail);
}
function intersects(left, right) {
    if (left.length === 0 || right.length === 0)
        return false;
    const set = new Set(left);
    return right.some((value) => set.has(value));
}
function readCurrent(targetPath) {
    const text = readFileSync(targetPath, 'utf8');
    return { text, hash: hashContent(text) };
}
function appendQueue(cwd, entry) {
    const file = path.join(cwd, queueRelativePath());
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(entry)}\n`);
}
function queueRelativePath() {
    return path.join('.atm', 'runtime', 'live-write-queue.jsonl').split(path.sep).join('/');
}
function rejected(proposal, file, reasonCode, queued, text, hash, detail) {
    return {
        proposalId: proposal.proposalId,
        file,
        decision: 'rejected-by-design',
        reasonCode,
        verdict: 'blocked',
        queued,
        currentFileText: text,
        currentFileHash: hash,
        commitSha: null,
        hunkOffsets: null,
        detail
    };
}
function kitError(proposal, file, reasonCode, text, hash, detail) {
    return {
        proposalId: proposal.proposalId,
        file,
        decision: 'kit-error',
        reasonCode,
        verdict: 'blocked',
        queued: false,
        currentFileText: text,
        currentFileHash: hash,
        commitSha: null,
        hunkOffsets: null,
        detail
    };
}
function normalize(file) {
    return file.replace(/\\/g, '/').replace(/^\.\//, '');
}
function normalizeHash(value) {
    return value.replace(/^sha256:/, '');
}
