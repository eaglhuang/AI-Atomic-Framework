#!/usr/bin/env node
/**
 * Arm B 寫入只走公開 npm CLI @ai-atomic-framework/cli@0.1.22：
 *   broker steward apply-live
 * 一次只送一筆 proposal，不先算合併計畫，也不等 compose 視窗。
 * CLI 不存在或版本不是 0.1.22 時直接失敗。沒有 claim 退路，也不載入 TypeScript。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { parseLiveWriteJournal } from './live-write-journal.generated.mjs';
import path from 'node:path';
// Generated, type-stripped copy of the CLI core unified-patch module
// (#359, #361): the same strict parser and hunk locator, so this wrapper cannot
// disagree with the CLI about where a hunk lands. Guarded by preflight check
// hunk-locator-parity. Do not add a second parser here.
import {
  UnifiedPatchApplicationError,
  applyParsedUnifiedPatchDetailed,
  hunkOffsetsOf,
  locateUnifiedPatchHunks,
  parseUnifiedPatch,
  splitSourceText
} from './unified-patch.generated.mjs';

const STEWARD_ID = 'neutral-write-steward';
const CLI_PACKAGE = '@ai-atomic-framework/cli@0.1.22';

function fail(code, message, extra = {}) {
  const payload = { ok: false, code, message, ...extra };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(code === 'rejected' ? 3 : code === 'cli-unavailable' ? 2 : 1);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

const positionals = [];
for (let i = 2; i < process.argv.length; i += 1) {
  const token = process.argv[i];
  if (token.startsWith('--')) {
    i += 1;
    continue;
  }
  positionals.push(token);
}

const fileArg = positionals[0];
const patchArg = positionals[1];
if (!fileArg || !patchArg) {
  fail('usage', 'usage: atm-write <file> <patch> [--base-file path] [--actor id] [--task id] [--message text]');
}

const sessionSlot = argValue('--session-slot') || process.env.PREREG_SESSION_SLOT || null;
if (sessionSlot !== null && !/^[A-Za-z0-9_-]+$/.test(sessionSlot)) {
  fail('session-slot', 'Invalid session slot');
}
function sessionActor(actor) {
  return sessionSlot === null ? actor : `${actor}-slot-${sessionSlot}`;
}

if (process.env.PREREG_STEWARD_SOCK) {
  await runStewardClient();
}

async function runStewardClient() {
  const patch = patchArg === '-' ? readFileSync(0, 'utf8') : readFileSync(path.resolve(patchArg), 'utf8');
  const baseFile = argValue('--base-file');
  const payload = {
    file: fileArg,
    patch,
    sessionSlot,
    sessionBaseCommit: argValue('--session-base-commit') || process.env.PREREG_SESSION_BASE_COMMIT || null,
    actor: argValue('--actor') || process.env.ATM_ACTOR || 'prereg-session',
    task: argValue('--task') || process.env.ATM_TASK || 'prereg',
    message: argValue('--message') || 'prereg-v3-smoke',
    attempt: Math.max(1, Number(argValue('--attempt') || 1) || 1)
  };
  if (baseFile) payload.baseText = readFileSync(path.resolve(baseFile), 'utf8');
  const response = await new Promise((resolve, reject) => {
    const socket = net.createConnection(process.env.PREREG_STEWARD_SOCK);
    let buf = '';
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('steward socket 逾時'));
    }, 120000);
    socket.setEncoding('utf8');
    socket.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    socket.on('connect', () => socket.write(`${JSON.stringify(payload)}\n`));
    socket.on('data', (chunk) => {
      buf += chunk;
    });
    socket.on('end', () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(buf));
      } catch (error) {
        reject(error);
      }
    });
  }).catch((error) => {
    fail('steward-socket', `無法透過 steward socket 寫入：${error.message}`);
  });
  if (response.stdout) process.stdout.write(response.stdout);
  if (response.stderr) process.stderr.write(response.stderr);
  process.exit(Number.isInteger(response.exitCode) ? response.exitCode : 1);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function loadConfig(cwd) {
  const configPath = path.join(cwd, '.prereg-smoke', 'session-write.json');
  if (!existsSync(configPath)) {
    fail('cli-unavailable', '缺少 session-write.json。Arm B 必須先確認公開 CLI 0.1.22，沒有 claim 退路。', { configPath });
  }
  return readJson(configPath);
}

function cliVersion(cli, safePath) {
  const result = spawnSync(process.execPath, [cli, '--version'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: safePath }
  });
  const payload = parseCli(result);
  const identity = payload?.evidence?.runtimeBuildIdentity;
  if (identity) return identity.status === 'verified' && identity.executionMode === 'npm-package' ? identity.version : '';
  return payload?.evidence?.frameworkVersion || '';
}

function parseCli(result) {
  for (const blob of [result.stdout, result.stderr]) {
    if (!blob) continue;
    const start = blob.indexOf('{');
    if (start === -1) continue;
    try {
      return JSON.parse(blob.slice(start));
    } catch {
      // 試下一個串流
    }
  }
  return null;
}

function gitText(repo, args, safePath) {
  return spawnSync('/usr/bin/git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: safePath, GIT_CONFIG_NOSYSTEM: '1' }
  });
}

function anchorsFromPatch(hunks) {
  const anchors = [];
  for (const hunk of hunks) {
    const start = hunk.oldStart;
    const count = hunk.oldCount;
    const end = count === 0 ? start : start + Math.max(count, 1) - 1;
    anchors.push({ kind: 'line-range', hint: `${start}-${end}` });
  }
  if (anchors.length === 0) anchors.push({ kind: 'file', hint: 'whole-file' });
  return anchors;
}

function proposalDocument(input) {
  return {
    schemaId: 'atm.patchProposal.v1',
    specVersion: '0.1.0',
    migration: { strategy: 'none', fromVersion: null, notes: 'prereg-v3 smoke steward proposal' },
    proposalId: input.proposalId,
    taskId: input.taskId,
    actorId: input.actorId,
    baseCommit: input.baseCommit,
    fileBeforeHash: input.fileBeforeHash,
    targetFile: input.relativeFile,
    atomRefs: [{ atomId: `atom-${input.proposalId}`, atomCid: `cid-${input.proposalId}` }],
    anchors: anchorsFromPatch(input.hunks),
    intent: input.message,
    patch: input.patch,
    validators: ['prereg-v3-smoke'],
    rollback: '還原此檔到套用前的位元組'
  };
}

function runCli(cli, args, cwd, safePath) {
  return spawnSync(process.execPath, [cli, ...args, '--json'], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, PATH: safePath }
  });
}

const invokedCwd = path.resolve(process.env.ATM_CWD || argValue('--cwd') || process.cwd());
const config = loadConfig(invokedCwd);
const writableRoot = path.resolve(config.writableRoot || invokedCwd);
const cli = config.cli;
const safePath = config.safePath || '/usr/bin:/bin';

const relativeFile = fileArg.replace(/\\/g, '/').replace(/^\.\//, '');
const targetPath = path.resolve(writableRoot, relativeFile);
const relativeCheck = path.relative(writableRoot, targetPath);
if (relativeCheck.startsWith('..') || path.isAbsolute(relativeCheck)) {
  fail('path', '目標檔超出工作樹', { file: relativeFile });
}
const actorId = sessionActor(argValue('--actor') || process.env.ATM_ACTOR || 'prereg-session');
const taskId = argValue('--task') || process.env.ATM_TASK || `prereg-${actorId}`;
const message = argValue('--message') || `prereg-v3-smoke: ${taskId} ${relativeFile}`;
const baseFile = argValue('--base-file');
// #360: an explicit override of another session's committed lines, naming their proposal id(s).
const ackOverlap = argValue('--ack-overlap');
const patch = patchArg === '-' ? readFileSync(0, 'utf8') : readFileSync(path.resolve(patchArg), 'utf8');

// Attempt evidence comes from the steward history, never a model-supplied flag.
const started = Date.now();
const result = submitLive({
  writableRoot,
  cli,
  safePath,
  relativeFile,
  actorId,
  taskId,
  message,
  baseFile,
  sessionBaseCommit: argValue('--session-base-commit') || process.env.PREREG_SESSION_BASE_COMMIT || null,
  patch,
  targetPath,
  started
});
process.stdout.write(`${JSON.stringify(result.record)}\n`);
process.exit(result.exitCode);

function sha256Bytes(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function gitBuffer(repo, args, safePath) {
  return spawnSync('/usr/bin/git', args, {
    cwd: repo,
    env: { ...process.env, PATH: safePath, GIT_CONFIG_NOSYSTEM: '1' }
  });
}

/** Strict parse with the CLI parser. A malformed patch is the model's error, never a kit crash. */
function parseSubmittedPatch(patch, relativeFile) {
  try {
    return { hunks: parseUnifiedPatch(patch, { targetFile: relativeFile }), error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { hunks: null, error: error instanceof UnifiedPatchApplicationError ? message : `patch could not be parsed: ${message}` };
  }
}

/** Located hunks in `text` with the CLI locator, or null when the patch does not apply there. */
function locateIn(text, hunks) {
  try {
    return locateUnifiedPatchHunks(splitSourceText(text), hunks, { mode: 'nearest' });
  } catch {
    return null;
  }
}

/** 宣告只來自 session 看過的內容，與 patch 能否定位無關。 */
function sessionBase(input) {
  if (input.baseFile) {
    const bytes = readFileSync(path.resolve(input.baseFile));
    return { hash: sha256Bytes(bytes), text: bytes.toString('utf8') };
  }
  const seenPath = path.join(input.writableRoot, '.prereg-smoke', 'session-seen.jsonl');
  if (existsSync(seenPath)) {
    for (const entry of parseLiveWriteJournal(readFileSync(seenPath, 'utf8')).reverse()) {
      if (entry.actorId !== input.actorId || entry.sessionSlot !== sessionSlot || entry.file !== input.relativeFile) continue;
      if (entry.seenHash) return { hash: entry.seenHash, text: textAtHash(input, entry.seenHash) };
      break;
    }
  }
  if (input.sessionBaseCommit) {
    const blob = gitBuffer(input.writableRoot, ['cat-file', '-p', `${input.sessionBaseCommit}:${input.relativeFile}`], input.safePath);
    if (blob.status === 0) return { hash: sha256Bytes(blob.stdout), text: blob.stdout.toString('utf8') };
  }
  return null;
}

// 雜湊已由 session 紀錄決定；只找回相同版本的文字來計算 hunkOffsets。
function textAtHash(input, hash) {
  if (existsSync(input.targetPath)) {
    const bytes = readFileSync(input.targetPath);
    if (sha256Bytes(bytes) === hash) return bytes.toString('utf8');
  }
  const listed = gitText(input.writableRoot, ['rev-list', 'HEAD', '--', input.relativeFile], input.safePath);
  if (listed.status !== 0) return null;
  for (const commit of listed.stdout.trim().split('\n').filter(Boolean)) {
    const blob = gitBuffer(input.writableRoot, ['cat-file', '-p', `${commit}:${input.relativeFile}`], input.safePath);
    if (blob.status === 0 && sha256Bytes(blob.stdout) === hash) return blob.stdout.toString('utf8');
  }
  return null;
}

function appendWriteRecord(input, record) {
  const dir = path.join(input.writableRoot, '.prereg-smoke');
  mkdirSync(dir, { recursive: true });
  appendFileSync(path.join(dir, 'steward-writes.jsonl'), `${JSON.stringify(record)}\n`);
  if (record.reasonCode !== 'recovery-required' && (record.decision === 'accepted' || record.decision === 'rejected-by-design')) {
    const seen = {
      actorId: input.actorId,
      sessionSlot,
      file: input.relativeFile,
      seenHash: record.currentFileHash,
      source: 'atm-write-reply',
      at: new Date().toISOString()
    };
    appendFileSync(path.join(dir, 'session-seen.jsonl'), `${JSON.stringify(seen)}\n`);
  }
}

function submissionAttempt(input, hunks) {
  const history = path.join(input.writableRoot, '.prereg-smoke', 'steward-writes.jsonl');
  const spans = hunks?.map(h => [h.oldStart, h.oldStart + Math.max(1, h.oldCount) - 1]) || null;
  const rows = existsSync(history) ? parseLiveWriteJournal(readFileSync(history, 'utf8')) : [];
  const same = rows.filter(row => row.actorId === input.actorId && row.file === input.relativeFile && row.taskId === input.taskId);
  const overlaps = row => spans && row.intentSpans
    ? spans.some(a => row.intentSpans.some(b => a[0] <= b[1] && b[0] <= a[1]))
    : row.patchHash === sha256Bytes(Buffer.from(input.patch));
  const first = same.findIndex(row => row.decision === 'rejected-by-design' && overlaps(row));
  return { ...input, intentSpans: spans, patchHash: sha256Bytes(Buffer.from(input.patch)),
    attempt: first < 0 ? 1 : 2 + same.slice(first + 1).filter(overlaps).length };
}

function submitLive(input) {
  const parsed = parseSubmittedPatch(input.patch, input.relativeFile);
  input = submissionAttempt(input, parsed.hunks);
  if (!parsed.hunks) return malformedPatch(input, parsed.error);
  input = { ...input, hunks: parsed.hunks };
  let declaredBase;
  try {
    declaredBase = sessionBase(input);
  } catch (error) {
    return malformedPatch(input, String(error), 'recovery-required', 'kit-error');
  }
  if (!declaredBase) return malformedPatch(input, '無法確定 session 看過的 base', 'base-unknown');
  if (declaredBase.text !== null) {
    try {
      if (applyParsedUnifiedPatchDetailed(declaredBase.text, input.hunks).text === declaredBase.text) {
        return malformedPatch(input, 'patch leaves the declared base unchanged', 'patch-noop');
      }
    } catch {
      // A well-formed patch with stale context is classified by the steward.
    }
  }
  declaredBase.located = declaredBase.text === null ? null : locateIn(declaredBase.text, input.hunks);
  const head = gitText(input.writableRoot, ['rev-parse', 'HEAD'], input.safePath);
  if (head.status !== 0) return malformedPatch(input, `無法讀取 HEAD：${head.stderr}`, 'git-head-unavailable', 'kit-error');
  const baseCommit = head.stdout.trim();
  if (!input.cli || !existsSync(input.cli) || cliVersion(input.cli, input.safePath) !== '0.1.22') {
    return malformedPatch(input, `公開 CLI ${CLI_PACKAGE} 不可用`, 'cli-unavailable', 'kit-error');
  }
  const fileBeforeHash = declaredBase.hash;
  const proposalId = `prop-${input.actorId}-a${input.attempt}-${createHash('sha256').update(`${input.relativeFile}\n${input.patch}`).digest('hex').slice(0, 12)}`;
  const proposal = proposalDocument({ ...input, proposalId, baseCommit, fileBeforeHash });
  const inbox = path.join(input.writableRoot, '.prereg-smoke', 'inbox');
  mkdirSync(inbox, { recursive: true });
  const proposalPath = path.join(inbox, `${proposalId}.proposal.json`);
  writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);
  const relativeProposal = path.relative(input.writableRoot, proposalPath).split(path.sep).join('/');
  const beforeBytes = existsSync(input.targetPath) ? readFileSync(input.targetPath) : null;
  const applied = runCli(input.cli, [
    'broker', 'steward', 'apply-live',
    '--cwd', input.writableRoot,
    '--proposal-file', relativeProposal,
    '--scope-file', input.relativeFile,
    '--steward-id', STEWARD_ID,
    ...(ackOverlap ? ['--ack-overlap', ackOverlap] : [])
  ], input.writableRoot, input.safePath);
  const payload = parseCli(applied);
  const live = payload?.evidence?.liveWrites?.[0] || null;
  let decision = live?.decision || 'kit-error';
  let appliedCheck = null;
  if (decision === 'accepted') {
    appliedCheck = confirmLiveWrite(input, beforeBytes, baseCommit, proposalId);
    if (!appliedCheck.ok) decision = 'kit-error';
  }
  const falseAccept = Boolean(appliedCheck && !appliedCheck.ok);
  const reasonCode = decision === 'accepted' ? null : (falseAccept ? 'write-not-applied' : (live?.reasonCode || null));
  const ok = decision === 'accepted';
  const elapsedMs = Date.now() - input.started;
  const text = typeof live?.currentFileText === 'string' ? live.currentFileText : currentFileText(input);
  const record = {
    schema: 'prereg-v3-smoke.stewardWrite.v1',
    ok,
    decision,
    reasonCode,
    messageCode: falseAccept ? null : recordMessageCode(payload?.messages?.[0]?.code || null, reasonCode),
    verdict: falseAccept ? 'blocked' : (live?.verdict || null),
    phase: ok ? 'commit' : 'live',
    terminal: ok ? 'committed' : (decision === 'kit-error' ? 'kit-error' : 'blocked'),
    stopReason: ok ? null : (falseAccept ? appliedCheck.reason : (live?.detail || payload?.messages?.[0]?.text || applied.stderr || applied.stdout || '')),
    proposalId,
    taskId: input.taskId,
    actorId: input.actorId,
    sessionSlot,
    file: input.relativeFile,
    declaredBaseHash: fileBeforeHash,
    hunkOffsets: declaredBase.located ? hunkOffsetsOf(declaredBase.located) : null,
    crossSessionOverlap: Array.isArray(live?.crossSessionOverlap) ? live.crossSessionOverlap : null,
    acknowledgedOverlap: Array.isArray(live?.acknowledgedOverlap) ? live.acknowledgedOverlap : null,
    currentFileText: text,
    currentFileHash: live?.currentFileHash || (text === null ? null : sha256Bytes(Buffer.from(text, 'utf8'))),
    batchSize: 1,
    attempt: input.attempt,
    retryCount: Math.max(0, input.attempt - 1),
    intentSpans: input.intentSpans,
    patchHash: input.patchHash,
    hashDriftCount: live?.hashDriftCount ?? null,
    writeToCommitMs: ok ? elapsedMs : null,
    commit: { gitIndexLockWaitMs: live?.commit?.gitIndexLockWaitMs ?? null, headMoves: live?.commit?.headMoves ?? null },
    planRequired: false,
    cli: CLI_PACKAGE,
    entry: 'broker steward apply-live'
  };
  appendWriteRecord(input, record);
  const exitCode = decision === 'accepted' ? 0 : (decision === 'rejected-by-design' ? 3 : 1);
  return { record, exitCode };
}

/**
 * 解析不了的 patch（沒有 hunk、標頭行數和內容不合、少了前綴、多檔或檔名不對）
 * 是模型送錯，不是 kit 故障：記成 rejected-by-design / patch-malformed，exit 3，不呼叫 CLI。
 */
function malformedPatch(input, message, reasonCode = 'patch-malformed', decision = 'rejected-by-design') {
  const proposalId = `prop-${input.actorId}-a${input.attempt}-${createHash('sha256').update(`${input.relativeFile}\n${input.patch}`).digest('hex').slice(0, 12)}`;
  const text = currentFileText(input);
  const record = {
    schema: 'prereg-v3-smoke.stewardWrite.v1',
    ok: false,
    decision,
    reasonCode,
    messageCode: null,
    verdict: 'blocked',
    queued: false,
    phase: reasonCode === 'patch-malformed' ? 'parse' : 'live',
    terminal: decision === 'kit-error' ? 'kit-error' : 'blocked',
    stopReason: message,
    proposalId,
    taskId: input.taskId,
    actorId: input.actorId,
    sessionSlot,
    file: input.relativeFile,
    declaredBaseHash: null,
    hunkOffsets: null,
    currentFileText: text,
    currentFileHash: text === null ? null : sha256Bytes(Buffer.from(text, 'utf8')),
    batchSize: 1,
    attempt: input.attempt,
    retryCount: Math.max(0, input.attempt - 1),
    intentSpans: input.intentSpans,
    patchHash: input.patchHash,
    hashDriftCount: null,
    writeToCommitMs: null,
    commit: { gitIndexLockWaitMs: null, headMoves: null },
    planRequired: false,
    cli: CLI_PACKAGE,
    entry: 'broker steward apply-live'
  };
  appendWriteRecord(input, record);
  return { record, exitCode: decision === 'kit-error' ? 1 : 3 };
}

function confirmLiveWrite(input, beforeBytes, beforeHead, proposalId) {
  if (!beforeBytes || !existsSync(input.targetPath)) {
    return { ok: false, reason: 'accepted write left no target file' };
  }
  const afterBytes = readFileSync(input.targetPath);
  if (sha256Bytes(afterBytes) === sha256Bytes(beforeBytes)) {
    return { ok: false, reason: 'accepted write left the file hash unchanged and created no commit' };
  }
  const head = gitText(input.writableRoot, ['rev-parse', 'HEAD'], input.safePath);
  const afterHead = head.status === 0 ? head.stdout.trim() : '';
  if (!afterHead || afterHead === beforeHead) {
    return { ok: false, reason: 'accepted write changed the file but did not create a commit' };
  }
  // 另一支 session 可能已經再提交。提案 id 只要出現在這次之前到現在的 commit 訊息裡即可。
  const subjects = gitText(input.writableRoot, ['log', '--format=%s', `${beforeHead}..${afterHead}`], input.safePath);
  if (subjects.status !== 0 || !subjects.stdout.includes(proposalId)) {
    return { ok: false, reason: 'accepted write commit does not record the proposal' };
  }
  return { ok: true };
}

function recordMessageCode(code, reasonCode) {
  // Preserve honest current CLI codes; older 0.1.21 mislabeled rejections as QUEUED.
  if (code === 'ATM_BROKER_LIVE_WRITE_QUEUED' && reasonCode !== 'overlapping-write-queued') return null;
  return code || null;
}

function currentFileText(input) {
  const file = input.targetPath || path.join(input.writableRoot, input.relativeFile);
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8');
}
