#!/usr/bin/env node
/**
 * Quota-free stand-in for `codex exec`.
 * Applies this session's gold patch from the base snapshot.
 * Arm A writes the file directly (a later writer clobbers an earlier one).
 * Arm B submits the same patch only through atm-write.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const promptPath = process.argv[2];
if (!promptPath) {
  process.stderr.write('stub-codex: missing prompt file\n');
  process.exit(2);
}
const prompt = readFileSync(promptPath, 'utf8');
const sessionDir = process.env.PREREG_SESSION_DIR;
const work = process.env.PREREG_WORK;
const instanceId = process.env.PREREG_INSTANCE_ID;
const gold = process.env.PREREG_GOLD_PATCH;
const slot = process.env.PREREG_SESSION_SLOT || '1';
const arm = process.env.PREREG_ARM || 'A';
const writeAfter = Number(process.env.PREREG_WRITE_AFTER_MS || 0);
if (!sessionDir || !work || !instanceId || !gold) {
  process.stderr.write('stub-codex: missing session environment\n');
  process.exit(2);
}

const started = new Date().toISOString();
const files = splitPatch(readFileSync(gold, 'utf8'));
mkdirSync(sessionDir, { recursive: true });
writeFileSync(path.join(sessionDir, 'intended.patch'), readFileSync(gold));

const events = [{ type: 'stub.session.started', at: started, instanceId, arm, slot }];
let exitCode = 0;
const prepared = [];
for (const [file, patch] of files) {
  const base = git(['show', `HEAD:${file}`]);
  if (base.status !== 0) {
    events.push({ type: 'stub.error', file, stderr: base.stderr });
    exitCode = 1;
    continue;
  }
  const applied = applyTemp(base.stdout, patch);
  if (applied.status !== 0) {
    events.push({ type: 'stub.apply_failed', file, stderr: applied.stderr });
    exitCode = 1;
    continue;
  }
  prepared.push({ file, patch, base: base.stdout, next: applied.stdout });
}

if (arm === 'A') {
  const now = Date.now();
  if (writeAfter > now) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, writeAfter - now);
  if (slot === '2') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  for (const item of prepared) {
    writeFileSync(path.join(work, item.file), item.next);
    events.push({ type: 'stub.direct_write', file: item.file, at: new Date().toISOString() });
  }
  const add = gitRetry(['add', '--', ...files.keys()]);
  const commit = gitRetry(['commit', '-m', `stub ${instanceId}`]);
  events.push({
    type: 'stub.git',
    addStatus: add.status,
    commitStatus: commit.status,
    stderr: `${add.stderr || ''}\n${commit.stderr || ''}`.trim()
  });
  if (commit.status !== 0) exitCode = 1;
} else {
  const atmWrite = process.env.PREREG_ATM_WRITE;
  for (const item of prepared) {
    const file = item.file;
    const patch = item.patch;
    const patchPath = path.join(sessionDir, `file-${file.replaceAll('/', '_')}.patch`);
    const basePath = path.join(sessionDir, `base-${file.replaceAll('/', '_')}`);
    writeFileSync(patchPath, patch);
    writeFileSync(basePath, item.base);
    const result = spawnSync(atmWrite, [file, patchPath, '--base-file', basePath, '--actor', `stub-${instanceId}`, '--task', instanceId, '--message', `stub ${instanceId} ${file}`], {
      cwd: work,
      encoding: 'utf8',
      env: { ...process.env, ATM_CWD: work }
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
}

events.push({
  type: 'stub.session.completed',
  at: new Date().toISOString(),
  usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, source: 'stub-no-model' }
});
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

function applyTemp(baseText, patchText) {
  const dir = spawnSync('mktemp', ['-d'], { encoding: 'utf8' }).stdout.trim();
  const file = path.join(dir, 'target');
  writeFileSync(file, baseText);
  const patchPath = path.join(dir, 'p.diff');
  const normalised = patchText.replace(/^diff --git a\/\S+ b\/\S+\n/m, 'diff --git a/target b/target\n').replace(/^--- a\/\S+\n/m, '--- a/target\n').replace(/^\+\+\+ b\/\S+\n/m, '+++ b/target\n');
  writeFileSync(patchPath, normalised);
  const applied = spawnSync(process.env.PREREG_REAL_GIT || '/usr/bin/git', ['apply', '--unsafe-paths', patchPath], { cwd: dir, encoding: 'utf8' });
  if (applied.status !== 0) return { status: applied.status, stdout: '', stderr: applied.stderr };
  return { status: 0, stdout: readFileSync(file, 'utf8'), stderr: '' };
}

function splitPatch(text) {
  const parts = new Map();
  const chunks = text.split(/(?=^diff --git )/m).filter((chunk) => chunk.startsWith('diff --git '));
  for (const chunk of chunks) {
    const match = chunk.match(/^diff --git a\/.+ b\/(.+)$/m);
    if (!match) continue;
    parts.set(match[1].trim(), chunk.endsWith('\n') ? chunk : `${chunk}\n`);
  }
  return parts;
}
