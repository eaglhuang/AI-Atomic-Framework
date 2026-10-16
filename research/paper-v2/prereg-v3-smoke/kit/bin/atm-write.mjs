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

if (process.env.PREREG_STEWARD_SOCK) {
  await runStewardClient();
}

async function runStewardClient() {
  const patch = patchArg === '-' ? readFileSync(0, 'utf8') : readFileSync(path.resolve(patchArg), 'utf8');
  const baseFile = argValue('--base-file');
  const payload = {
    file: fileArg,
    patch,
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

function anchorsFromPatch(patch) {
  const anchors = [];
  for (const match of patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/gm)) {
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
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
    anchors: anchorsFromPatch(input.patch),
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
const actorId = argValue('--actor') || process.env.ATM_ACTOR || 'prereg-session';
const taskId = argValue('--task') || process.env.ATM_TASK || `prereg-${actorId}`;
const message = argValue('--message') || `prereg-v3-smoke: ${taskId} ${relativeFile}`;
const baseFile = argValue('--base-file');
const patch = patchArg === '-' ? readFileSync(0, 'utf8') : readFileSync(path.resolve(patchArg), 'utf8');
if (!patch.includes('@@')) fail('patch', 'patch 不是 unified diff', { file: relativeFile });

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

function submitLive(input) {
  const head = gitText(input.writableRoot, ['rev-parse', 'HEAD'], input.safePath);
  if (head.status !== 0) fail('base', `無法讀取 HEAD：${head.stderr}`);
  const baseCommit = head.stdout.trim();
  const liveBytes = input.baseFile
    ? readFileSync(path.resolve(input.baseFile))
    : readFileSync(path.join(input.writableRoot, input.relativeFile));
  const fileBeforeHash = `sha256:${createHash('sha256').update(liveBytes).digest('hex')}`;
  const proposalId = `prop-${input.actorId}-a${input.attempt}-${createHash('sha256').update(`${input.relativeFile}\n${input.patch}`).digest('hex').slice(0, 12)}`;
  const proposal = proposalDocument({ ...input, proposalId, baseCommit, fileBeforeHash });
  const inbox = path.join(input.writableRoot, '.prereg-smoke', 'inbox');
  mkdirSync(inbox, { recursive: true });
  const proposalPath = path.join(inbox, `${proposalId}.proposal.json`);
  writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);
  const relativeProposal = path.relative(input.writableRoot, proposalPath).split(path.sep).join('/');
  const applied = runCli(input.cli, [
    'broker', 'steward', 'apply-live',
    '--cwd', input.writableRoot,
    '--proposal-file', relativeProposal,
    '--scope-file', input.relativeFile,
    '--steward-id', STEWARD_ID
  ], input.writableRoot, input.safePath);
  const payload = parseCli(applied);
  const live = payload?.evidence?.liveWrites?.[0] || null;
  const decision = live?.decision || 'kit-error';
  const reasonCode = decision === 'accepted' ? null : (live?.reasonCode || null);
  const ok = decision === 'accepted';
  const elapsedMs = Date.now() - input.started;
  const record = {
    schema: 'prereg-v3-smoke.stewardWrite.v1',
    ok,
    decision,
    reasonCode,
    messageCode: payload?.messages?.[0]?.code || null,
    verdict: live?.verdict || null,
    phase: ok ? 'commit' : 'live',
    terminal: ok ? 'committed' : (decision === 'kit-error' ? 'kit-error' : 'blocked'),
    stopReason: ok ? null : (live?.detail || payload?.messages?.[0]?.text || applied.stderr || applied.stdout || ''),
    proposalId,
    taskId: input.taskId,
    actorId: input.actorId,
    file: input.relativeFile,
    declaredBaseHash: fileBeforeHash,
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

function currentFileText(input) {
  const file = input.targetPath || path.join(input.writableRoot, input.relativeFile);
  if (!existsSync(file)) return null;
  return readFileSync(file, 'utf8');
}
