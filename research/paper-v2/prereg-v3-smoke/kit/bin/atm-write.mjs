#!/usr/bin/env node
/**
 * Arm B 寫入只走公開 npm CLI @ai-atomic-framework/cli@0.1.21：
 *   broker steward apply-live
 * 一次只送一筆 proposal，不先算合併計畫，也不等 compose 視窗。
 * CLI 不存在或版本不是 0.1.21 時直接失敗。沒有 claim 退路，也不載入 TypeScript。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
// Generated, type-stripped copy of the CLI core unified-patch module
// (#359, #361): the same strict parser and hunk locator, so this wrapper cannot
// disagree with the CLI about where a hunk lands. Guarded by preflight check
// hunk-locator-parity. Do not add a second parser here.
import {
  UnifiedPatchApplicationError,
  hunkOffsetsOf,
  locateUnifiedPatchHunks,
  locatedLineIndexes,
  parseUnifiedPatch,
  splitSourceText
} from './unified-patch.generated.mjs';

const STEWARD_ID = 'neutral-write-steward';
const CLI_PACKAGE = '@ai-atomic-framework/cli@0.1.21';

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
    fail('cli-unavailable', '缺少 session-write.json。Arm B 必須先確認公開 CLI 0.1.21，沒有 claim 退路。', { configPath });
  }
  return readJson(configPath);
}

function cliVersion(cli, safePath) {
  const result = spawnSync(process.execPath, [cli, '--version'], {
    encoding: 'utf8',
    env: { ...process.env, PATH: safePath }
  });
  const payload = parseCli(result);
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
if (!cli || !existsSync(cli) || cliVersion(cli, safePath) !== '0.1.21') {
  fail('cli-unavailable', `公開 CLI ${CLI_PACKAGE} 不可用。中止寫入。沒有 claim 退路。`, { cli: cli || null });
}

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
const patch = patchArg === '-' ? readFileSync(0, 'utf8') : readFileSync(path.resolve(patchArg), 'utf8');

const attempt = Math.max(1, Number(argValue('--attempt') || process.env.PREREG_WRITE_ATTEMPT || 1) || 1);
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
  patch,
  attempt,
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

function intersects(left, right) {
  if (!left?.length || !right?.length) return false;
  const set = new Set(left);
  return right.some((value) => set.has(value));
}

function readJournal(repo) {
  const file = path.join(repo, '.atm', 'runtime', 'live-write-journal.jsonl');
  if (!existsSync(file)) return [];
  const entries = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      // 壞掉的一列不能拿來判斷 base。
    }
  }
  return entries;
}

function historicalFileHashes(repo, relativeFile, safePath) {
  const listed = gitText(repo, ['rev-list', 'HEAD', '--', relativeFile], safePath);
  if (listed.status !== 0) return [];
  const found = [];
  const seen = new Set();
  for (const sha of listed.stdout.split('\n').map((item) => item.trim()).filter(Boolean)) {
    const blob = gitBuffer(repo, ['cat-file', '-p', `${sha}:${relativeFile}`], safePath);
    if (blob.status !== 0 || !blob.stdout) continue;
    const hash = sha256Bytes(blob.stdout);
    if (seen.has(hash)) continue;
    seen.add(hash);
    found.push({ hash, text: blob.stdout.toString('utf8') });
  }
  return found;
}

function normalizeHash(value) {
  return String(value || '').replace(/^sha256:/, '');
}

/**
 * 沒有 --base-file 時，模型是對著某一個已讀內容寫 diff。
 * 內容仍是目前檔案（用 CLI 同一個定位器找得到 hunk）就宣告目前雜湊。
 * 內容對得上 journal 裡某個 base，而且在那個 base 裡定位到的行和那次提交重疊，
 * 就宣告那個 base，讓公開 CLI 回 overlapping-write-queued 與目前內容。
 * 重疊一律用定位後的行號比，不用 hunk 標頭的行號（#359）。
 * 對不上任何版本的 hunk 仍宣告目前雜湊，CLI 回 patch-context-mismatch。
 * 回傳宣告的雜湊，以及該 base 裡的定位結果（算 hunkOffsets 用）。
 */
function chooseDeclaredBase(input, liveBytes) {
  const liveHash = sha256Bytes(liveBytes);
  const liveLocated = locateIn(liveBytes.toString('utf8'), input.hunks);
  if (liveLocated) return { hash: liveHash, located: liveLocated };
  const versions = historicalFileHashes(input.writableRoot, input.relativeFile, input.safePath);
  const journal = readJournal(input.writableRoot).filter((entry) => entry.file === input.relativeFile);
  for (const entry of journal.slice().reverse()) {
    const version = versions.find((item) => normalizeHash(item.hash) === normalizeHash(entry.baseHash));
    if (!version) continue;
    const located = locateIn(version.text, input.hunks);
    if (!located) continue;
    const lines = locatedLineIndexes(located);
    const changed = Array.isArray(entry.changedLines) ? entry.changedLines : [];
    if (intersects(changed, lines.covered) || intersects(changed, lines.changed)) return { hash: version.hash, located };
  }
  return { hash: liveHash, located: null };
}

function submitLive(input) {
  const head = gitText(input.writableRoot, ['rev-parse', 'HEAD'], input.safePath);
  if (head.status !== 0) fail('base', `無法讀取 HEAD：${head.stderr}`);
  const baseCommit = head.stdout.trim();
  const parsed = parseSubmittedPatch(input.patch, input.relativeFile);
  if (!parsed.hunks) return malformedPatch(input, parsed.error);
  input = { ...input, hunks: parsed.hunks };
  const liveBytes = input.baseFile
    ? readFileSync(path.resolve(input.baseFile))
    : readFileSync(path.join(input.writableRoot, input.relativeFile));
  const declaredBase = input.baseFile
    ? { hash: sha256Bytes(liveBytes), located: locateIn(liveBytes.toString('utf8'), input.hunks) }
    : chooseDeclaredBase(input, liveBytes);
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
    '--steward-id', STEWARD_ID
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
    currentFileText: typeof live?.currentFileText === 'string' ? live.currentFileText : currentFileText(input),
    currentFileHash: live?.currentFileHash || null,
    batchSize: 1,
    attempt: input.attempt,
    retryCount: Math.max(0, input.attempt - 1),
    hashDriftCount: 0,
    writeToCommitMs: ok ? elapsedMs : null,
    commit: { gitIndexLockWaitMs: 0, headMoves: 0 },
    planRequired: false,
    cli: CLI_PACKAGE,
    entry: 'broker steward apply-live'
  };
  const logPath = path.join(input.writableRoot, '.prereg-smoke', 'steward-writes.jsonl');
  mkdirSync(path.dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify(record)}\n`);
  const exitCode = decision === 'accepted' ? 0 : (decision === 'rejected-by-design' ? 3 : 1);
  return { record, exitCode };
}

/**
 * 解析不了的 patch（沒有 hunk、標頭行數和內容不合、少了前綴、多檔或檔名不對）
 * 是模型送錯，不是 kit 故障：記成 rejected-by-design / patch-malformed，exit 3，不呼叫 CLI。
 */
function malformedPatch(input, message) {
  const proposalId = `prop-${input.actorId}-a${input.attempt}-${createHash('sha256').update(`${input.relativeFile}\n${input.patch}`).digest('hex').slice(0, 12)}`;
  const text = currentFileText(input);
  const record = {
    schema: 'prereg-v3-smoke.stewardWrite.v1',
    ok: false,
    decision: 'rejected-by-design',
    reasonCode: 'patch-malformed',
    messageCode: null,
    verdict: 'blocked',
    phase: 'parse',
    terminal: 'blocked',
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
    hashDriftCount: 0,
    writeToCommitMs: null,
    commit: { gitIndexLockWaitMs: 0, headMoves: 0 },
    planRequired: false,
    cli: CLI_PACKAGE,
    entry: 'broker steward apply-live'
  };
  const logPath = path.join(input.writableRoot, '.prereg-smoke', 'steward-writes.jsonl');
  mkdirSync(path.dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify(record)}\n`);
  return { record, exitCode: 3 };
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
  // 公開 CLI 0.1.21 把每一筆非接受都標成 QUEUED。只有 overlapping-write-queued 才是排隊。
  if (code === 'ATM_BROKER_LIVE_WRITE_QUEUED' && reasonCode !== 'overlapping-write-queued') return null;
  return code || null;
}

function currentFileText(input) {
  const file = input.targetPath || path.join(input.writableRoot, input.relativeFile);
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8');
}
