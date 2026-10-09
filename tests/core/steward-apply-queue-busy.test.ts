import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { hashContent } from '../../packages/core/src/broker/adapters/cas.ts';
import { setStewardApplyQueueOpenFaultForTests, stewardApplyQueueDirectory, withStewardApplyQueue } from '../../packages/core/src/broker/steward-apply-queue.ts';
import { commitCanonicalFiles } from '../../packages/core/src/broker/steward-commit-guard.ts';

const workerFlag = 'ATM_STEWARD_QUEUE_BUSY_WORKER';
const instructionEnv = 'ATM_STEWARD_QUEUE_BUSY_INSTRUCTION';

interface HammerInstruction {
  readonly cwd: string;
  readonly targetPath: string;
  readonly relativePath: string;
  readonly queueRoot: string;
  readonly tokens: readonly string[];
}

function collect(child: ChildProcess): Promise<{ readonly status: number | null; readonly stderr: string }> {
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
  child.stdout?.resume();
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stderr }));
  });
}
function presenceEntries(queueDir: string): string[] {
  const dir = path.join(queueDir, 'p');
  if (!existsSync(dir)) return [];
  return readdirSync(dir);
}
function fdsUnder(prefix: string): string[] {
  const hits: string[] = [];
  let entries: string[] = [];
  try { entries = readdirSync('/proc/self/fd'); } catch { return hits; }
  for (const entry of entries) {
    let target = '';
    try { target = readlinkSync(path.join('/proc/self/fd', entry)); } catch { continue; }
    if (target.startsWith(prefix)) hits.push(target);
  }
  return hits;
}
function waiterCount(queueDir: string): number {
  const db = new DatabaseSync(path.join(queueDir, 'queue.sqlite'), { timeout: 0 });
  try {
    const row = db.prepare('SELECT COUNT(*) AS n FROM waiter').get() as { n: number } | undefined;
    return Number(row?.n ?? 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('no such table')) return 0;
    throw error;
  } finally {
    db.close();
  }
}
function applyOriginal(root: string, targetPath: string, content: string): void {
  const committed = commitCanonicalFiles({
    cwd: root,
    entries: [{
      filePath: 'file.txt',
      targetPath,
      expectedBaseHash: hashContent('original\n'),
      content,
      outputHash: hashContent(content)
    }]
  });
  assert.equal(committed.status, 'applied', committed.reason);
}
function runQueueSqliteBusyFallback(): void {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-queue-busy-'));
  try {
    const targetPath = path.join(root, 'file.txt');
    writeFileSync(targetPath, 'original\n', 'utf8');
    const queueRoot = path.join(root, 'queue');
    const queueDir = stewardApplyQueueDirectory(queueRoot, targetPath);
    mkdirSync(queueDir, { recursive: true });
    const holder = new DatabaseSync(path.join(queueDir, 'queue.sqlite'));
    holder.exec('BEGIN EXCLUSIVE');
    try {
      const immediate = Date.now();
      let ran = false;
      withStewardApplyQueue({
        cwd: root, targetPaths: [targetPath], enabled: true, queueRoot, waitMs: 0, pollMs: 1
      }, () => {
        ran = true;
        applyOriginal(root, targetPath, 'applied\n');
      });
      assert.equal(ran, true);
      assert.ok(Date.now() - immediate < 1_000, 'waitMs 0 must not block on the default queue wait');
      assert.equal(readFileSync(targetPath, 'utf8'), 'applied\n');
      assert.deepEqual(presenceEntries(queueDir), []);
      assert.deepEqual(fdsUnder(path.join(queueDir, 'p')), []);
      writeFileSync(targetPath, 'original\n', 'utf8');
      const bounded = Date.now();
      ran = false;
      withStewardApplyQueue({
        cwd: root, targetPaths: [targetPath], enabled: true, queueRoot, waitMs: 120, pollMs: 1
      }, () => {
        ran = true;
        applyOriginal(root, targetPath, 'applied-bounded\n');
      });
      const elapsed = Date.now() - bounded;
      assert.equal(ran, true);
      assert.ok(elapsed >= 60, `busy_timeout should wait for the queue budget, elapsed ${elapsed}ms`);
      assert.ok(elapsed < 1_500, `busy_timeout must stay inside the queue budget, elapsed ${elapsed}ms`);
      assert.equal(readFileSync(targetPath, 'utf8'), 'applied-bounded\n');
      assert.deepEqual(presenceEntries(queueDir), []);
      assert.deepEqual(fdsUnder(path.join(queueDir, 'p')), []);
    } finally {
      holder.close();
    }
    assert.deepEqual(fdsUnder(queueDir), []);
    writeFileSync(targetPath, 'original\n', 'utf8');
    setStewardApplyQueueOpenFaultForTests(Object.assign(new Error('database table is locked'), { errcode: 6, code: 'ERR_SQLITE_ERROR' }));
    try {
      let ran = false;
      withStewardApplyQueue({
        cwd: root, targetPaths: [targetPath], enabled: true, queueRoot, waitMs: 0, pollMs: 1
      }, () => {
        ran = true;
        applyOriginal(root, targetPath, 'applied-locked\n');
      });
      assert.equal(ran, true);
      assert.equal(readFileSync(targetPath, 'utf8'), 'applied-locked\n');
      assert.deepEqual(presenceEntries(queueDir), []);
      assert.deepEqual(fdsUnder(queueDir), []);
    } finally {
      setStewardApplyQueueOpenFaultForTests(null);
    }
    writeFileSync(targetPath, 'original\n', 'utf8');
    setStewardApplyQueueOpenFaultForTests(Object.assign(new Error('boom'), { code: 'ERR_TEST' }));
    try {
      let ran = false;
      assert.throws(() => withStewardApplyQueue({
        cwd: root, targetPaths: [targetPath], enabled: true, queueRoot, waitMs: 0, pollMs: 1
      }, () => { ran = true; }), /boom/);
      assert.equal(ran, false);
      assert.equal(readFileSync(targetPath, 'utf8'), 'original\n');
      assert.deepEqual(presenceEntries(queueDir), []);
      assert.deepEqual(fdsUnder(queueDir), []);
    } finally {
      setStewardApplyQueueOpenFaultForTests(null);
    }
    withStewardApplyQueue({
      cwd: root, targetPaths: [targetPath], enabled: true, queueRoot, waitMs: 1_000, pollMs: 5
    }, () => {
      assert.ok(presenceEntries(queueDir).some((name) => name.endsWith('.sqlite')));
    });
    assert.deepEqual(presenceEntries(queueDir), []);
    assert.deepEqual(fdsUnder(queueDir), []);
    assert.equal(waiterCount(queueDir), 0);
    assert.throws(() => withStewardApplyQueue({
      cwd: root, targetPaths: [targetPath], enabled: true, queueRoot, waitMs: 1_000, pollMs: 5
    }, () => { throw new Error('apply failed'); }), /apply failed/);
    assert.deepEqual(presenceEntries(queueDir), []);
    assert.deepEqual(fdsUnder(queueDir), []);
    assert.equal(waiterCount(queueDir), 0);
    console.log('[steward-apply-queue-busy] queue-sqlite-busy-fallback ok');
  } finally {
    setStewardApplyQueueOpenFaultForTests(null);
    rmSync(root, { recursive: true, force: true });
  }
}
function appendThroughQueue(instruction: HammerInstruction, token: string): void {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let done = false;
    withStewardApplyQueue({
      cwd: instruction.cwd,
      targetPaths: [instruction.targetPath],
      enabled: true,
      queueRoot: instruction.queueRoot,
      waitMs: 3_000,
      pollMs: 2
    }, () => {
      const current = readFileSync(instruction.targetPath, 'utf8');
      if (current.split('\n').includes(token)) {
        done = true;
        return;
      }
      const next = `${current}${token}\n`;
      const committed = commitCanonicalFiles({
        cwd: instruction.cwd,
        entries: [{
          filePath: instruction.relativePath,
          targetPath: instruction.targetPath,
          expectedBaseHash: hashContent(current),
          content: next,
          outputHash: hashContent(next)
        }],
        lockWaitMs: 5_000,
        lockPollMs: 2
      });
      if (committed.status === 'applied') done = true;
      else if (committed.status !== 're-compose') {
        throw new Error(`commit ${token}: ${committed.status} ${committed.reason}`);
      }
    });
    if (done) return;
  }
  throw new Error(`lost write ${token}`);
}
function presenceFilesUnder(queueRoot: string): string[] {
  if (!existsSync(queueRoot)) return [];
  const found: string[] = [];
  for (const key of readdirSync(queueRoot)) {
    for (const name of presenceEntries(path.join(queueRoot, key))) found.push(path.join(key, name));
  }
  return found;
}
async function runQueueHammer(): Promise<void> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-queue-hammer-'));
  const children: ChildProcess[] = [];
  try {
    const relativePath = 'src/store.ts';
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, 'base\n', 'utf8');
    const queueRoot = path.join(root, 'queue');
    const workers = 6;
    const rounds = 8;
    const tokens: string[] = [];
    for (let worker = 0; worker < workers; worker += 1) {
      const mine: string[] = [];
      for (let round = 0; round < rounds; round += 1) {
        const token = `w${worker}-r${round}`;
        tokens.push(token);
        mine.push(token);
      }
      const instructionPath = path.join(root, `hammer-${worker}.json`);
      writeFileSync(instructionPath, JSON.stringify({
        cwd: root, targetPath, relativePath, queueRoot, tokens: mine
      } satisfies HammerInstruction), 'utf8');
      children.push(spawn(process.execPath, ['--strip-types', fileURLToPath(import.meta.url)], {
        env: { ...process.env, [workerFlag]: '1', [instructionEnv]: instructionPath },
        stdio: ['ignore', 'pipe', 'pipe']
      }));
    }
    const done = await Promise.all(children.map((child) => collect(child)));
    for (const child of done) {
      assert.equal(child.status, 0, child.stderr);
      assert.doesNotMatch(child.stderr, /SQLITE_BUSY|SQLITE_LOCKED|database is locked|database table is locked/);
    }
    const lines = readFileSync(targetPath, 'utf8').split('\n');
    assert.equal(lines[0], 'base');
    assert.deepEqual(lines.slice(1).filter((line) => line !== '').sort(), tokens.slice().sort());
    assert.deepEqual(presenceFilesUnder(queueRoot), []);
    console.log('[steward-apply-queue-busy] queue-hammer ok');
  } finally {
    for (const child of children) child.kill('SIGKILL');
    rmSync(root, { recursive: true, force: true });
  }
}
async function main(): Promise<void> {
  if (process.env[workerFlag] === '1') {
    const instructionPath = process.env[instructionEnv];
    if (!instructionPath) throw new Error('missing instruction');
    const instruction = JSON.parse(readFileSync(instructionPath, 'utf8')) as HammerInstruction;
    for (const token of instruction.tokens) appendThroughQueue(instruction, token);
    return;
  }
  runQueueSqliteBusyFallback();
  await runQueueHammer();
  console.log('[steward-apply-queue-busy] ok');
}
await main();
