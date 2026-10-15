#!/usr/bin/env node
/**
 * Arm B 寫入只走公開 npm CLI @ai-atomic-framework/cli@0.1.20：
 *   broker compose → broker steward apply
 * CLI 不存在或版本不是 0.1.20 時直接失敗。沒有 claim 退路，也不載入 TypeScript。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const STEWARD_ID = 'neutral-write-steward';

function fail(code, message, extra = {}) {
  const payload = { ok: false, code, message, ...extra };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(code === 'rejected' ? 3 : code === 'cli-unavailable' ? 2 : 1);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function loadConfig(cwd) {
  const configPath = path.join(cwd, '.prereg-smoke', 'session-write.json');
  if (!existsSync(configPath)) {
    fail('cli-unavailable', '缺少 session-write.json。Arm B 必須先確認公開 CLI 0.1.20，沒有 claim 退路。', { configPath });
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

function chmodTree(mode, root) {
  const result = spawnSync('chmod', ['-R', mode, root], { encoding: 'utf8' });
  if (result.status !== 0) {
    fail('chmod', `chmod ${mode} 失敗：${result.stderr || result.stdout || result.status}`);
  }
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
const windowMs = Number(config.composeWindowMs || 4000);
if (!cli || !existsSync(cli) || cliVersion(cli, safePath) !== '0.1.20') {
  fail('cli-unavailable', '公開 CLI @ai-atomic-framework/cli@0.1.20 不可用。中止寫入。沒有 claim 退路。', { cli: cli || null });
}

chmodTree('u+w', writableRoot);

const relativeFile = fileArg.replace(/\\/g, '/').replace(/^\.\//, '');
const targetPath = path.join(writableRoot, relativeFile);
const actorId = argValue('--actor') || process.env.ATM_ACTOR || 'prereg-session';
const taskId = argValue('--task') || process.env.ATM_TASK || `prereg-${actorId}`;
const message = argValue('--message') || `prereg-v3-smoke: ${taskId} ${relativeFile}`;
const baseFile = argValue('--base-file');
const patch = patchArg === '-' ? readFileSync(0, 'utf8') : readFileSync(path.resolve(patchArg), 'utf8');
if (!patch.includes('@@')) fail('patch', 'patch 不是 unified diff', { file: relativeFile });

let exitCode = 1;
try {
  const result = submitThroughPublicCli({
    writableRoot,
    cli,
    safePath,
    windowMs,
    relativeFile,
    actorId,
    taskId,
    message,
    baseFile,
    patch
  });
  process.stdout.write(`${JSON.stringify(result.record)}\n`);
  exitCode = result.exitCode;
} finally {
  if (existsSync(targetPath)) {
    spawnSync('chmod', ['a-w', targetPath], { encoding: 'utf8' });
  }
}
process.exit(exitCode);

function submitThroughPublicCli(input) {
  const inbox = path.join(input.writableRoot, '.prereg-smoke', 'inbox');
  mkdirSync(inbox, { recursive: true });
  const head = gitText(input.writableRoot, ['rev-parse', 'HEAD'], input.safePath);
  if (head.status !== 0) fail('base', `無法讀取 HEAD：${head.stderr}`);
  const baseCommit = head.stdout.trim();
  const liveBytes = input.baseFile
    ? readFileSync(path.resolve(input.baseFile))
    : readFileSync(path.join(input.writableRoot, input.relativeFile));
  const fileBeforeHash = `sha256:${createHash('sha256').update(liveBytes).digest('hex')}`;
  const proposalId = `prop-${input.actorId}-${createHash('sha256').update(`${input.relativeFile}\n${input.patch}`).digest('hex').slice(0, 12)}`;
  const proposal = proposalDocument({ ...input, proposalId, baseCommit, fileBeforeHash });
  const proposalPath = path.join(inbox, `${proposalId}.proposal.json`);
  writeFileSync(proposalPath, `${JSON.stringify(proposal, null, 2)}\n`);

  const deadline = ensureDeadline(inbox, input.windowMs);
  while (Date.now() < deadline) sleep(40);

  const lockDir = path.join(inbox, 'lock');
  const leader = tryMkdir(lockDir);
  const started = Date.now();
  if (leader) {
    try {
      return applyInbox(input, inbox, started);
    } finally {
      writeFileSync(path.join(inbox, 'lock-released'), '1');
    }
  }
  const waited = waitForApplied(inbox, proposalId, 60000);
  return finishRecord(input, proposal, waited, started);
}

function ensureDeadline(inbox, windowMs) {
  const file = path.join(inbox, 'deadline');
  try {
    const value = Date.now() + windowMs;
    writeFileSync(file, String(value), { flag: 'wx' });
    return value;
  } catch {
    return Number(readFileSync(file, 'utf8'));
  }
}

function tryMkdir(dir) {
  try {
    mkdirSync(dir);
    return true;
  } catch {
    return false;
  }
}

function applyInbox(input, inbox, started) {
  const names = readdirSync(inbox).filter((name) => name.endsWith('.proposal.json')).sort();
  const proposals = names.map((name) => readJson(path.join(inbox, name)));
  const args = ['broker', 'compose', '--cwd', input.writableRoot, '--persist-merge-plan'];
  for (const name of names) args.push('--proposal-file', path.join('.prereg-smoke', 'inbox', name));
  const composed = runCli(input.cli, args, input.writableRoot, input.safePath);
  const composePayload = parseCli(composed);
  if (!composePayload?.evidence?.persistedMergePlan?.path) {
    const message = composePayload?.messages?.[0]?.text || composed.stderr || composed.stdout || 'compose 失敗';
    writeApplied(inbox, { ok: false, terminal: 'blocked', message, proposalIds: proposals.map((item) => item.proposalId), batchSize: proposals.length, elapsedMs: Date.now() - started });
    return finishFromApplied(input, proposals, readJson(path.join(inbox, 'applied.json')));
  }
  const planPath = composePayload.evidence.persistedMergePlan.path;
  const applyArgs = [
    'broker', 'steward', 'apply',
    '--cwd', input.writableRoot,
    '--merge-plan-file', planPath,
    '--steward-id', STEWARD_ID,
    '--evidence-out', '.prereg-smoke/steward-evidence.json'
  ];
  for (const name of names) applyArgs.push('--proposal-file', path.join('.prereg-smoke', 'inbox', name));
  for (const file of [...new Set(proposals.map((item) => item.targetFile))]) {
    applyArgs.push('--scope-file', file);
  }
  const applied = runCli(input.cli, applyArgs, input.writableRoot, input.safePath);
  const applyPayload = parseCli(applied);
  const evidence = applyPayload?.evidence?.applyEvidence || null;
  const ok = Boolean(applyPayload?.ok && evidence?.verdict === 'applied');
  writeApplied(inbox, {
    ok,
    terminal: ok ? 'committed' : 'blocked',
    message: applyPayload?.messages?.[0]?.text || applied.stderr || '',
    proposalIds: proposals.map((item) => item.proposalId),
    batchSize: proposals.length,
    elapsedMs: Date.now() - started,
    blockedReasons: evidence?.blockedReasons || [],
    verdict: composePayload.evidence.mergePlan?.verdict || null
  });
  return finishFromApplied(input, proposals, readJson(path.join(inbox, 'applied.json')));
}

function writeApplied(inbox, payload) {
  writeFileSync(path.join(inbox, 'applied.json'), `${JSON.stringify(payload, null, 2)}\n`);
}

function waitForApplied(inbox, proposalId, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const file = path.join(inbox, 'applied.json');
    if (existsSync(file)) {
      const payload = readJson(file);
      if (payload.proposalIds?.includes(proposalId)) return payload;
    }
    sleep(40);
  }
  fail('timeout', `等待 steward 套用逾時：${proposalId}`);
}

function finishFromApplied(input, proposals, applied) {
  const mine = proposals.find((item) => item.actorId === (argValue('--actor') || process.env.ATM_ACTOR || 'prereg-session') && item.targetFile === input.relativeFile)
    || proposals[0];
  return finishRecord(input, mine, applied, Date.now() - applied.elapsedMs);
}

function finishRecord(input, proposal, applied) {
  const ok = Boolean(applied.ok);
  const record = {
    schema: 'prereg-v3-smoke.stewardWrite.v1',
    ok,
    phase: ok ? 'commit' : 'compose',
    terminal: ok ? 'committed' : (applied.terminal || 'blocked'),
    stopReason: ok ? null : (applied.blockedReasons || [applied.message]).join('; '),
    proposalId: proposal.proposalId,
    taskId: proposal.taskId,
    actorId: proposal.actorId,
    file: proposal.targetFile,
    declaredBaseHash: proposal.fileBeforeHash,
    batchSize: applied.batchSize || 1,
    retryCount: 0,
    hashDriftCount: 0,
    writeToCommitMs: ok ? applied.elapsedMs || 0 : null,
    commit: { gitIndexLockWaitMs: 0, headMoves: 0 },
    cli: '@ai-atomic-framework/cli@0.1.20',
    entry: 'broker steward apply'
  };
  const logPath = path.join(input.writableRoot, '.prereg-smoke', 'steward-writes.jsonl');
  mkdirSync(path.dirname(logPath), { recursive: true });
  appendFileSync(logPath, `${JSON.stringify(record)}\n`);
  return { record, exitCode: ok ? 0 : 3 };
}
