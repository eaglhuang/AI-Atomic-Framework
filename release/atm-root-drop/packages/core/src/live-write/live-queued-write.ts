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
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { hashContent } from '../broker/adapters/cas.ts';
import {
  canonicalCommitLockPath,
  defaultStewardCommitLockRoot
} from '../broker/steward-commit-guard.ts';
import {
  acquireKernelAdvisoryLock,
  releaseKernelAdvisoryLock,
  StewardLockTimeoutError
} from '../broker/steward-kernel-lock.ts';
import type { PatchProposal } from '../broker/types.ts';
import {
  UnifiedPatchApplicationError,
  applyParsedUnifiedPatchDetailed,
  locateUnifiedPatchHunks,
  locatedLineIndexes,
  splitSourceText,
  type HunkOffset,
  hunkOldLineIndex,
  parseUnifiedPatchHunks
} from '../broker/unified-patch.ts';
import { findCommittedBaseText, lineTokens, patchChangeBlocks, translateStalePatch, type StaleBaseConflict } from '../broker/stale-base-translation.ts';
import {
  CROSS_SESSION_OVERLAP_INSTRUCTION,
  committedBlocks,
  describeOverlaps,
  diffCommittedBlocks,
  ensureAnchor,
  entriesSinceAnchor,
  findCrossSessionOverlaps,
  gitFileAt,
  type CommittedBlock,
  type CrossSessionOverlap,
  type LineRange
} from './cross-session-overlap.ts';

export type LiveWriteDecision = 'accepted' | 'rejected-by-design' | 'kit-error';

export type LiveWriteReasonCode =
  | 'overlapping-write-queued'
  | 'stale-base'
  | 'patch-malformed'
  | 'no-op-patch'
  | 'patch-context-mismatch'
  | 'cross-session-overlap'
  | 'outside-scope'
  | 'live-write-lock-timeout'
  | 'live-write-commit-failed';

export interface LiveQueuedWrite {
  readonly proposalId: string;
  readonly file: string;
  readonly decision: LiveWriteDecision;
  readonly reasonCode: LiveWriteReasonCode | null;
  readonly verdict: 'applied' | 'blocked';
  readonly queued: boolean;
  readonly currentFileText: string | null;
  readonly currentFileHash: string | null;
  readonly commitSha: string | null;
  readonly hunkOffsets: readonly HunkOffset[] | null;
  readonly detail: string;
  /** #360: other sessions' committed lines this write targeted (only on `cross-session-overlap`). */
  readonly crossSessionOverlap?: readonly CrossSessionOverlap[];
  readonly instruction?: string;
  /** #360: overlapping proposals this write overrode with `--ack-overlap`. */
  readonly acknowledgedOverlap?: readonly string[];
}

export interface LiveQueuedWriteResult {
  readonly ok: boolean;
  readonly writes: readonly LiveQueuedWrite[];
  readonly queuePath: string;
  readonly planRequired: false;
}

interface JournalEntry {
  readonly file: string;
  readonly baseHash: string;
  readonly afterHash: string;
  readonly changedLines: readonly number[];
  readonly proposalId: string;
  readonly actorId?: string | null;
  readonly commitSha?: string | null;
  readonly blocks?: readonly CommittedBlock[];
  readonly acknowledgedOverlap?: readonly string[];
}

type Change = { start: number; end: number; added: readonly string[] };

const LOCK_WAIT_MS = 30_000;
const LOCK_POLL_MS = 5;

export function applyLiveQueuedWrites(input: {
  readonly cwd: string;
  readonly proposals: readonly PatchProposal[];
  readonly scopeFiles?: readonly string[];
  readonly stewardId?: string;
  /** Proposal ids an explicit `--ack-overlap` overrides (#360 AC5b). */
  readonly ackOverlap?: readonly string[];
}): LiveQueuedWriteResult {
  const cwd = path.resolve(input.cwd);
  const scope = new Set((input.scopeFiles ?? []).map((file) => normalize(file)));
  const writes: LiveQueuedWrite[] = [];
  const groups = new Map<string, PatchProposal[]>();
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

function applyFileGroup(cwd: string, file: string, proposals: readonly PatchProposal[], ack: readonly string[]): LiveQueuedWrite[] {
  const targetPath = path.resolve(cwd, file);
  if (!existsSync(targetPath) || !statSync(targetPath).isFile()) {
    return proposals.map((proposal) => rejected(proposal, file, 'stale-base', true, null, null, '目標檔不存在'));
  }
  const lockDir = canonicalCommitLockPath(defaultStewardCommitLockRoot(cwd), targetPath);
  try {
    acquireKernelAdvisoryLock(lockDir, LOCK_WAIT_MS, LOCK_POLL_MS, file);
  } catch (error) {
    if (error instanceof StewardLockTimeoutError) {
      const current = readCurrent(targetPath);
      return proposals.map((proposal) => kitError(proposal, file, 'live-write-lock-timeout', current.text, current.hash, error.message));
    }
    throw error;
  }
  try {
    const results: LiveQueuedWrite[] = [];
    for (const proposal of proposals) {
      results.push(applyOneLocked(cwd, file, targetPath, proposal, ack));
    }
    return results;
  } finally {
    releaseKernelAdvisoryLock(lockDir);
  }
}

function applyOneLocked(cwd: string, file: string, targetPath: string, proposal: PatchProposal, ack: readonly string[]): LiveQueuedWrite {
  const current = readCurrent(targetPath);
  const declared = normalizeHash(proposal.fileBeforeHash);
  const observed = normalizeHash(current.hash);
  // #360: anchor the session's original target (even a malformed first proposal declares what it saw),
  // then check every write against other sessions' lines committed since it.
  const journal = readJournal(cwd);
  const { anchor, existed } = ensureAnchor(cwd, { actorId: proposal.actorId, taskId: proposal.taskId ?? null, file, declaredHash: declared, proposalId: proposal.proposalId, journalLength: journal.length });
  let hunks: ReturnType<typeof parseUnifiedPatchHunks>;
  try {
    hunks = parseUnifiedPatchHunks(proposal.patch, { targetFile: file });
  } catch (error) {
    if (!(error instanceof UnifiedPatchApplicationError)) throw error;
    return rejected(proposal, file, 'patch-malformed', false, current.text, current.hash, error.message);
  }
  const since = entriesSinceAnchor(cwd, journal, anchor, observed);
  const overlapsFor = (targets: readonly LineRange[], includeDeletionGaps = false) => findCrossSessionOverlaps({
    actorId: proposal.actorId, currentText: current.text, currentHash: current.hash, entries: since, targets, includeDeletionGaps, readAfterText: (entry) => gitFileAt(cwd, entry.commitSha, file) ?? findCommittedBaseText(cwd, file, entry.afterHash)
  });
  const guard = (targets: readonly LineRange[]): { rejection: LiveQueuedWrite | null; acknowledged: string[] } => {
    const overlaps = overlapsFor(targets);
    if (overlaps.every((overlap) => ack.includes(overlap.proposalId))) return { rejection: null, acknowledged: overlaps.map((overlap) => overlap.proposalId) };
    return { rejection: overlapRejection(cwd, proposal, file, current, overlaps, ack), acknowledged: [] };
  };
  if (declared === observed) {
    let applied: ReturnType<typeof applyParsedUnifiedPatchDetailed>;
    try {
      applied = applyParsedUnifiedPatchDetailed(current.text, hunks, { mode: 'nearest' });
    } catch (error) {
      if (!(error instanceof UnifiedPatchApplicationError)) throw error;
      // A context mismatch caused by another session's change since the anchor is that session's overlap (#360 AC4).
      const anchorText = normalizeHash(anchor.baseHash) === observed ? null : findCommittedBaseText(cwd, file, anchor.baseHash);
      const fromAnchor = anchorText === null ? null : translateStalePatch({ baseText: anchorText, currentText: current.text, hunks });
      const overlaps = fromAnchor && !fromAnchor.ok ? overlapsFor(conflictRanges(fromAnchor.conflicts), true) : [];
      if (overlaps.length > 0) return overlapRejection(cwd, proposal, file, current, overlaps, ack);
      return rejected(proposal, file, 'patch-context-mismatch', false, current.text, current.hash, error.message);
    }
    const changes = changesOf(current.text, applied.text, applied.located);
    const check = guard(targetsOf(changes));
    if (check.rejection) return check.rejection;
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
    } catch (error) {
      if (!(error instanceof UnifiedPatchApplicationError)) throw error;
    }
  }
  // #363: translate from the declared base; never re-read the declared lines in the current file.
  const translated = base === null ? null : translateStalePatch({ baseText: base, currentText: current.text, hunks });
  let acknowledged: string[] = [];
  if (existed && translated) {
    // A resubmission (the session already anchored this file) is checked against other sessions first.
    const conflicting = translated.ok ? [] : overlapsFor(conflictRanges(translated.conflicts), true);
    const check = translated.ok
      ? guard(translated.blocks.map((block) => ({ start: block.currentStart, end: block.currentEnd })))
      : { rejection: conflicting.length > 0 ? overlapRejection(cwd, proposal, file, current, conflicting, ack) : null, acknowledged: [] };
    if (check.rejection) return check.rejection;
    acknowledged = check.acknowledged;
  }
  const prior = readJournal(cwd).filter((entry) => entry.file === file && normalizeHash(entry.baseHash) === declared);
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
  if (translated.text === current.text) return rejected(proposal, file, 'no-op-patch', false, current.text, current.hash, 'patch 沒有改變檔案');
  const blocks = committedBlocks(current.text, translated.blocks.map((block) => ({ start: block.currentStart, end: block.currentEnd, added: block.added })));
  return commitPrepared(cwd, file, targetPath, proposal, current.text, translated.text, locatedLineIndexes(translated.located).changed, translated.hunkOffsets, blocks, acknowledged);
}

/** The write's change blocks in `before` coordinates: from the patch structure, else a line diff. */
function changesOf(before: string, after: string, located: Parameters<typeof patchChangeBlocks>[2]): Change[] {
  try {
    return patchChangeBlocks(lineTokens(before), lineTokens(after), located).map((block) => ({ start: block.baseStart, end: block.baseEnd, added: block.added }));
  } catch (error) {
    if (!(error instanceof UnifiedPatchApplicationError)) throw error;
    return diffCommittedBlocks(before, after).map((block) => ({ start: block.beforeStart, end: block.beforeEnd, added: block.added }));
  }
}

/** Lines a write deletes or modifies (pure insertions target nothing). */
function targetsOf(changes: readonly Change[]): LineRange[] {
  return changes.filter((change) => change.end > change.start).map((change) => ({ start: change.start, end: change.end }));
}

/**
 * Current lines, changed since the patch's base, that the patch's own deleted or modified base lines became.
 * Touching-only conflicts target nothing. An equal-length replacement maps line by line; otherwise the whole
 * changed range counts, and a pure deletion becomes a two-line window around its gap.
 */
function conflictRanges(conflicts: readonly StaleBaseConflict[]): LineRange[] {
  const ranges: LineRange[] = [];
  for (const { ours, theirs } of conflicts) {
    const from = Math.max(ours.baseStart, theirs.baseStart);
    const to = Math.min(ours.baseEnd, theirs.baseEnd);
    if (to <= from) continue;
    if (theirs.currentEnd === theirs.currentStart) ranges.push({ start: Math.max(0, theirs.currentStart - 1), end: theirs.currentStart + 1 });
    else if (theirs.currentEnd - theirs.currentStart === theirs.baseEnd - theirs.baseStart) ranges.push({ start: theirs.currentStart + (from - theirs.baseStart), end: theirs.currentStart + (to - theirs.baseStart) });
    else ranges.push({ start: theirs.currentStart, end: theirs.currentEnd });
  }
  return ranges;
}

function overlapRejection(
  cwd: string,
  proposal: PatchProposal,
  file: string,
  current: { text: string; hash: string },
  overlaps: readonly CrossSessionOverlap[],
  ack: readonly string[]
): LiveQueuedWrite {
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

function commitPrepared(
  cwd: string,
  file: string,
  targetPath: string,
  proposal: PatchProposal,
  before: string,
  next: string,
  changedLines: readonly number[],
  hunkOffsets: readonly HunkOffset[],
  blocks: readonly CommittedBlock[],
  acknowledged: readonly string[]
): LiveQueuedWrite {
  if (next === before) return rejected(proposal, file, 'no-op-patch', false, before, hashContent(before), 'patch 沒有改變檔案');
  try {
    replaceFileAtomically(targetPath, next);
    const sha = gitCommit(cwd, file, proposal.proposalId);
    appendJournal(cwd, {
      file,
      baseHash: hashContent(before),
      afterHash: hashContent(next),
      changedLines,
      proposalId: proposal.proposalId,
      actorId: proposal.actorId,
      commitSha: sha,
      blocks,
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
  } catch (error) {
    restoreFile(targetPath, before);
    const message = error instanceof Error ? error.message : String(error);
    return kitError(proposal, file, 'live-write-commit-failed', before, hashContent(before), message);
  }
}

function queueRejection(
  cwd: string,
  proposal: PatchProposal,
  file: string,
  reason: 'overlapping-write-queued' | 'stale-base',
  current: { text: string; hash: string },
  detail: string
): LiveQueuedWrite {
  appendQueue(cwd, {
    proposalId: proposal.proposalId,
    file,
    reasonCode: reason,
    currentFileHash: current.hash,
    queuedAt: new Date().toISOString()
  });
  return rejected(proposal, file, reason, true, current.text, current.hash, detail);
}

function intersects(left: readonly number[], right: readonly number[]): boolean {
  if (left.length === 0 || right.length === 0) return false;
  const set = new Set(left);
  return right.some((value) => set.has(value));
}

function readCurrent(targetPath: string): { text: string; hash: string } {
  const text = readFileSync(targetPath, 'utf8');
  return { text, hash: hashContent(text) };
}

function readJournal(cwd: string): JournalEntry[] {
  const file = path.join(cwd, journalRelativePath());
  if (!existsSync(file)) return [];
  const entries: JournalEntry[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    entries.push(JSON.parse(line) as JournalEntry);
  }
  return entries;
}

function appendJournal(cwd: string, entry: JournalEntry): void {
  const file = path.join(cwd, journalRelativePath());
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

function appendQueue(cwd: string, entry: unknown): void {
  const file = path.join(cwd, queueRelativePath());
  mkdirSync(path.dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(entry)}\n`);
}

function journalRelativePath(): string {
  return path.join('.atm', 'runtime', 'live-write-journal.jsonl');
}

function queueRelativePath(): string {
  return path.join('.atm', 'runtime', 'live-write-queue.jsonl').split(path.sep).join('/');
}

function replaceFileAtomically(targetPath: string, content: string): void {
  const temporary = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${createHash('sha256').update(content).digest('hex').slice(0, 8)}.atm-tmp`);
  const mode = statSync(targetPath).mode;
  try {
    writeFileSync(temporary, content, { encoding: 'utf8', mode: mode & 0o777 });
    renameSync(temporary, targetPath);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function restoreFile(targetPath: string, content: string): void {
  try {
    writeFileSync(targetPath, content, 'utf8');
  } catch {
    // 還原失敗留給呼叫端的 kit-error 訊息。
  }
}

function gitCommit(cwd: string, file: string, proposalId: string): string {
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
    if (commit.status === 0) return headSha(cwd) ?? '';
    if (attempt < 4 && /index\.lock/.test(`${commit.stderr}${commit.stdout}`)) {
      sleepMs(20 * (attempt + 1));
      continue;
    }
    throw new Error(commit.stderr || commit.stdout || 'git commit 失敗');
  }
  throw new Error('git commit 失敗');
}

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function headSha(cwd: string): string | null {
  const result = spawnSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const sha = result.stdout.trim();
  return sha || null;
}

function rejected(
  proposal: PatchProposal,
  file: string,
  reasonCode: LiveWriteReasonCode,
  queued: boolean,
  text: string | null,
  hash: string | null,
  detail: string
): LiveQueuedWrite {
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

function kitError(
  proposal: PatchProposal,
  file: string,
  reasonCode: 'live-write-lock-timeout' | 'live-write-commit-failed',
  text: string | null,
  hash: string | null,
  detail: string
): LiveQueuedWrite {
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

function normalize(file: string): string {
  return file.replace(/\\/g, '/').replace(/^\.\//, '');
}

function normalizeHash(value: string): string {
  return value.replace(/^sha256:/, '');
}
