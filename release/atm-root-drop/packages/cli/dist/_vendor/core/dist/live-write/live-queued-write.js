/**
 * 即時寫入。不讀預先算好的 merge plan。
 *
 * 同一檔的鎖只包住「讀現況、決定、寫入、git commit」。
 * 第一筆 base 相符的寫入立刻提交。
 * 之後的寫入若改到已經提交的行，在碰檔案之前拒絕，帶回現在的內容，並留下佇列紀錄。
 * 不相交、而且上下文仍對得上現況的寫入，直接套上。
 * 宣告的 base 對不上、又沒有這條路徑自己提交過的不相交紀錄時，當成 stale-base，不寫。
 *
 * 既有的 `broker steward apply --merge-plan-file` 不受影響。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hashContent } from '../broker/adapters/cas.js';
import { canonicalCommitLockPath, defaultStewardCommitLockRoot } from '../broker/steward-commit-guard.js';
import { acquireKernelAdvisoryLock, releaseKernelAdvisoryLock, StewardLockTimeoutError } from '../broker/steward-kernel-lock.js';
import { UnifiedPatchApplicationError, applyParsedUnifiedPatchDetailed, locateUnifiedPatchHunks, locatedLineIndexes, splitSourceText, hunkOldLineIndex, parseUnifiedPatchHunks } from '../broker/unified-patch.js';
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
        writes.push(...applyFileGroup(cwd, file, proposals));
    }
    return {
        ok: writes.every((write) => write.decision === 'accepted'),
        writes,
        queuePath: queueRelativePath(),
        planRequired: false
    };
}
function applyFileGroup(cwd, file, proposals) {
    const targetPath = path.resolve(cwd, file);
    if (!existsSync(targetPath) || !statSync(targetPath).isFile()) {
        return proposals.map((proposal) => rejected(proposal, file, 'stale-base', true, null, null, '目標檔不存在'));
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
        const results = [];
        for (const proposal of proposals) {
            results.push(applyOneLocked(cwd, file, targetPath, proposal));
        }
        return results;
    }
    finally {
        releaseKernelAdvisoryLock(lockDir);
    }
}
function applyOneLocked(cwd, file, targetPath, proposal) {
    const current = readCurrent(targetPath);
    const declared = normalizeHash(proposal.fileBeforeHash);
    const observed = normalizeHash(current.hash);
    let hunks;
    try {
        hunks = parseUnifiedPatchHunks(proposal.patch, { targetFile: file });
    }
    catch (error) {
        if (!(error instanceof UnifiedPatchApplicationError))
            throw error;
        return rejected(proposal, file, 'patch-malformed', false, current.text, current.hash, error.message);
    }
    if (declared === observed) {
        try {
            const applied = applyParsedUnifiedPatchDetailed(current.text, hunks, { mode: 'nearest' });
            return commitPrepared(cwd, file, targetPath, proposal, current.text, applied.text, locatedLineIndexes(applied.located).changed, applied.hunkOffsets);
        }
        catch (error) {
            if (!(error instanceof UnifiedPatchApplicationError))
                throw error;
            return rejected(proposal, file, 'patch-context-mismatch', false, current.text, current.hash, error.message);
        }
    }
    let lines = locatedLineIndexes(hunks.map((hunk) => {
        const index = hunkOldLineIndex(hunk.oldStart, hunk.oldCount);
        return { hunk, index, declaredIndex: index, offset: 0 };
    }));
    const base = findBaseText(cwd, file, declared);
    if (base !== null) {
        try {
            lines = locatedLineIndexes(locateUnifiedPatchHunks(splitSourceText(base), hunks, { mode: 'nearest' }));
        }
        catch (error) {
            if (!(error instanceof UnifiedPatchApplicationError))
                throw error;
        }
    }
    const prior = readJournal(cwd).filter((entry) => entry.file === file && normalizeHash(entry.baseHash) === declared);
    const overlaps = prior.some((entry) => intersects(entry.changedLines, lines.covered) || intersects(entry.changedLines, lines.changed));
    if (overlaps) {
        return queueRejection(cwd, proposal, file, 'overlapping-write-queued', current, '這筆寫入和已經提交的行重疊，檔案沒有被改');
    }
    try {
        const applied = applyParsedUnifiedPatchDetailed(current.text, hunks, { mode: 'unique' });
        if (applied.text === current.text)
            return rejected(proposal, file, 'no-op-patch', false, current.text, current.hash, 'patch 沒有改變檔案');
        if (prior.length > 0) {
            return commitPrepared(cwd, file, targetPath, proposal, current.text, applied.text, locatedLineIndexes(applied.located).changed, applied.hunkOffsets);
        }
    }
    catch (error) {
        if (!(error instanceof UnifiedPatchApplicationError))
            throw error;
    }
    const detail = prior.length > 0
        ? 'base 已經前進，這份 patch 對不上現在的內容'
        : '宣告的 base 不是目前檔案，而且沒有可套用的不相交提交';
    return queueRejection(cwd, proposal, file, 'stale-base', current, detail);
}
function findBaseText(cwd, file, declared) {
    const history = spawnSync('git', ['-C', cwd, 'rev-list', '--max-count=200', 'HEAD', '--', file], { encoding: 'utf8' });
    if (history.status !== 0)
        return null;
    for (const sha of history.stdout.trim().split('\n').filter(Boolean)) {
        const result = spawnSync('git', ['-C', cwd, 'cat-file', '-p', `${sha}:${file}`]);
        if (result.status !== 0)
            continue;
        const text = result.stdout.toString('utf8');
        if (normalizeHash(hashContent(text)) === declared)
            return text;
    }
    return null;
}
function commitPrepared(cwd, file, targetPath, proposal, before, next, changedLines, hunkOffsets, baseHash = hashContent(before)) {
    if (next === before)
        return rejected(proposal, file, 'no-op-patch', false, before, hashContent(before), 'patch 沒有改變檔案');
    try {
        replaceFileAtomically(targetPath, next);
        const sha = gitCommit(cwd, file, proposal.proposalId);
        appendJournal(cwd, {
            file,
            baseHash,
            afterHash: hashContent(next),
            changedLines,
            proposalId: proposal.proposalId
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
            detail: '已寫入並提交'
        };
    }
    catch (error) {
        restoreFile(targetPath, before);
        const message = error instanceof Error ? error.message : String(error);
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
function readJournal(cwd) {
    const file = path.join(cwd, journalRelativePath());
    if (!existsSync(file))
        return [];
    const entries = [];
    for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim())
            continue;
        entries.push(JSON.parse(line));
    }
    return entries;
}
function appendJournal(cwd, entry) {
    const file = path.join(cwd, journalRelativePath());
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(entry)}\n`);
}
function appendQueue(cwd, entry) {
    const file = path.join(cwd, queueRelativePath());
    mkdirSync(path.dirname(file), { recursive: true });
    appendFileSync(file, `${JSON.stringify(entry)}\n`);
}
function journalRelativePath() {
    return path.join('.atm', 'runtime', 'live-write-journal.jsonl');
}
function queueRelativePath() {
    return path.join('.atm', 'runtime', 'live-write-queue.jsonl').split(path.sep).join('/');
}
function replaceFileAtomically(targetPath, content) {
    const temporary = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${createHash('sha256').update(content).digest('hex').slice(0, 8)}.atm-tmp`);
    const mode = statSync(targetPath).mode;
    try {
        writeFileSync(temporary, content, { encoding: 'utf8', mode: mode & 0o777 });
        renameSync(temporary, targetPath);
    }
    catch (error) {
        rmSync(temporary, { force: true });
        throw error;
    }
}
function restoreFile(targetPath, content) {
    try {
        writeFileSync(targetPath, content, 'utf8');
    }
    catch {
        // 還原失敗留給呼叫端的 kit-error 訊息。
    }
}
function gitCommit(cwd, file, proposalId) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const add = spawnSync('git', ['-C', cwd, 'add', '--', file], { encoding: 'utf8' });
        if (add.status !== 0) {
            if (attempt < 4 && /index\.lock/.test(`${add.stderr}${add.stdout}`)) {
                sleepMs(20 * (attempt + 1));
                continue;
            }
            throw new Error(add.stderr || add.stdout || 'git add 失敗');
        }
        const commit = spawnSync('git', [
            '-C', cwd,
            '-c', 'user.name=atm-steward',
            '-c', 'user.email=atm-steward@localhost',
            '-c', 'commit.gpgsign=false',
            'commit', '-m', `steward live write ${proposalId}`,
            '--', file
        ], { encoding: 'utf8' });
        if (commit.status === 0)
            return headSha(cwd) ?? '';
        if (attempt < 4 && /index\.lock/.test(`${commit.stderr}${commit.stdout}`)) {
            sleepMs(20 * (attempt + 1));
            continue;
        }
        throw new Error(commit.stderr || commit.stdout || 'git commit 失敗');
    }
    throw new Error('git commit 失敗');
}
function sleepMs(ms) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function headSha(cwd) {
    const result = spawnSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
    if (result.status !== 0)
        return null;
    const sha = result.stdout.trim();
    return sha || null;
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
