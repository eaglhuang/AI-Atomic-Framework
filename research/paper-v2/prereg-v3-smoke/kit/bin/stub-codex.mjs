#!/usr/bin/env node
/**
 * 不消耗額度的 codex exec 替身。
 * 只依提示詞產生修改，不讀取金標路徑。Arm A 直接寫檔；Arm B 只呼叫 PATH 上的 atm-write。
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const promptPath = process.argv[2];
if (!promptPath) {
  process.stderr.write('stub-codex: 缺少提示檔\n');
  process.exit(2);
}
const prompt = readFileSync(promptPath, 'utf8');
const sessionDir = process.env.PREREG_SESSION_DIR;
const work = process.env.PREREG_WORK;
const instanceId = process.env.PREREG_INSTANCE_ID;
const slot = process.env.PREREG_SESSION_SLOT || '1';
const arm = process.env.PREREG_ARM || 'A';
const writeAfter = Number(process.env.PREREG_WRITE_AFTER_MS || 0);
if (!sessionDir || !work || !instanceId) {
  process.stderr.write('stub-codex: 缺少工作階段環境\n');
  process.exit(2);
}
if (process.env.PREREG_GOLD_PATCH || process.env.GOLD_ROOT) {
  process.stderr.write('stub-codex: 工作階段環境含有金標路徑，拒絕繼續\n');
  process.exit(2);
}

const match = prompt.match(/Change the (\S+) marker in (\S+) to (\S+)\./);
if (!match) {
  process.stderr.write('stub-codex: 提示詞沒有可推導的 fixture 修改，且不會讀取金標\n');
  process.exit(2);
}
const marker = match[1];
const file = match[2].replace(/[.,]$/, '');
const value = match[3].replace(/[.,]$/, '');

const started = new Date().toISOString();
mkdirSync(sessionDir, { recursive: true });
const base = git(['show', `HEAD:${file}`]);
if (base.status !== 0) {
  process.stderr.write(base.stderr || 'stub-codex: 無法讀取基底檔\n');
  process.exit(1);
}
const original = base.stdout;
const lines = splitLines(original);
const index = lines.lines.indexOf(marker);
if (index < 0) {
  process.stderr.write(`stub-codex: 找不到標記 ${marker}\n`);
  process.exit(1);
}
const nextLines = lines.lines.slice();
nextLines[index] = value;
const next = joinLines(nextLines, lines.endsWithNewline);
const patch = singleLinePatch(file, index + 1, marker, value);
writeFileSync(path.join(sessionDir, 'agent-output.diff'), patch);

const events = [{ type: 'stub.session.started', at: started, instanceId, arm, slot }];
let exitCode = 0;
if (arm === 'A') {
  const now = Date.now();
  if (writeAfter > now) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, writeAfter - now);
  if (slot === '2') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  writeFileSync(path.join(work, file), next);
  events.push({ type: 'stub.direct_write', file, at: new Date().toISOString() });
  const add = gitRetry(['add', '--', file]);
  const commit = gitRetry(['commit', '-m', `stub ${instanceId}`]);
  events.push({
    type: 'stub.git',
    addStatus: add.status,
    commitStatus: commit.status,
    stderr: `${add.stderr || ''}\n${commit.stderr || ''}`.trim()
  });
  if (commit.status !== 0) exitCode = 1;
} else {
  const patchPath = path.join(sessionDir, `file-${file.replaceAll('/', '_')}.patch`);
  const basePath = path.join(sessionDir, `base-${file.replaceAll('/', '_')}`);
  writeFileSync(patchPath, patch);
  writeFileSync(basePath, original);
  const result = spawnSync('atm-write', [file, patchPath, '--base-file', basePath, '--actor', `stub-${instanceId}`, '--task', instanceId, '--message', `stub ${instanceId} ${file}`], {
    cwd: work,
    encoding: 'utf8',
    env: process.env
  });
  events.push({
    type: 'stub.atm-write',
    file,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr
  });
  if (result.status !== 0 && result.status !== 3) exitCode = 1;
}

events.push({
  type: 'stub.session.completed',
  at: new Date().toISOString(),
  usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, source: 'stub-no-model' }
});
events.push({ type: 'stub.intended_patch', text: `BEGIN_INTENDED_PATCH\n${patch}END_INTENDED_PATCH` });
for (const event of events) process.stdout.write(`${JSON.stringify(event)}\n`);
process.exit(exitCode);

function git(args) {
  return spawnSync(process.env.PREREG_REAL_GIT || '/usr/bin/git', args, {
    cwd: work,
    encoding: 'utf8',
    env: process.env
  });
}

function gitRetry(args) {
  let last = git(args);
  for (let attempt = 1; attempt <= 6 && last.status !== 0 && `${last.stderr || ''}`.includes('index.lock'); attempt += 1) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40 * attempt);
    last = git(args);
  }
  return last;
}

function splitLines(text) {
  const endsWithNewline = text.endsWith('\n');
  const lines = text.split('\n');
  if (endsWithNewline) lines.pop();
  return { lines, endsWithNewline };
}

function joinLines(lines, endsWithNewline) {
  return lines.join('\n') + (endsWithNewline ? '\n' : '');
}

function singleLinePatch(rel, lineNo, before, after) {
  return [
    `diff --git a/${rel} b/${rel}`,
    `--- a/${rel}`,
    `+++ b/${rel}`,
    `@@ -${lineNo},1 +${lineNo},1 @@`,
    `-${before}`,
    `+${after}`,
    ''
  ].join('\n');
}
