import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { hashContent } from '../../packages/core/src/broker/adapters/cas.ts';
import { resolveStewardCommitControls, withStewardApplyQueue } from '../../packages/core/src/broker/steward-apply-queue.ts';
import {
  cleanupOrphanCanonicalTemps,
  commitCanonicalFiles,
  defaultStewardCommitLockRoot,
  stewardCommitTargetKey
} from '../../packages/core/src/broker/steward-commit-guard.ts';

const workerFlag = 'ATM_STEWARD_KERNEL_WORKER';
const instructionEnv = 'ATM_STEWARD_KERNEL_INSTRUCTION';
type Instruction =
  | { readonly kind: 'hold'; readonly cwd: string; readonly relativePath: string; readonly content: string; readonly heldFlag: string; readonly releaseFlag: string; readonly tempName?: string }
  | { readonly kind: 'wait'; readonly cwd: string; readonly relativePath: string; readonly baseContent: string; readonly nextContent: string; readonly lockWaitMs?: number }
  | { readonly kind: 'queue'; readonly cwd: string; readonly targetPath: string; readonly queueRoot: string; readonly enteredFlag: string; readonly releaseFlag: string; readonly enabled: boolean };

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function waitFor(predicate: () => boolean, timeoutMs: number, label: string): void {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    sleepMs(5);
  }
  throw new Error(`timed out waiting for ${label}`);
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
function spawnWorker(instructionPath: string, namespace: boolean, extraEnv: Record<string, string> = {}): ChildProcess {
  const args = ['--strip-types', fileURLToPath(import.meta.url)];
  const env = { ...process.env, ...extraEnv, [workerFlag]: '1', [instructionEnv]: instructionPath };
  if (!namespace) return spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
  return spawn('unshare', ['-Urpf', '--mount-proc', process.execPath, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
}
function unshareSkipReason(): string | null {
  const probe = spawnSync('unshare', ['-Urpf', '--mount-proc', 'true'], { encoding: 'utf8', timeout: 5_000 });
  if (probe.status === 0) return null;
  const detail = `${probe.stderr || ''} ${probe.error ?? ''}`.trim().slice(0, 240);
  return `unshare -Urpf --mount-proc unavailable (status ${probe.status ?? 'null'}): ${detail || 'no stderr'}`;
}
function runHold(instruction: Extract<Instruction, { kind: 'hold' }>): void {
  const targetPath = path.join(instruction.cwd, instruction.relativePath);
  const content = `${instruction.content}// HELD\n`;
  commitCanonicalFiles({
    cwd: instruction.cwd,
    entries: [{
      filePath: instruction.relativePath,
      targetPath,
      expectedBaseHash: hashContent(instruction.content),
      content,
      outputHash: hashContent(content)
    }],
    whileLocked() {
      if (instruction.tempName) {
        const temp = path.join(path.dirname(targetPath), instruction.tempName);
        writeFileSync(temp, 'partial', 'utf8');
        writeFileSync(instruction.heldFlag, temp, 'utf8');
      } else {
        writeFileSync(instruction.heldFlag, '1', 'utf8');
      }
      waitFor(() => existsSync(instruction.releaseFlag), 10_000, 'release');
    }
  });
}
function runWait(instruction: Extract<Instruction, { kind: 'wait' }>): void {
  const targetPath = path.join(instruction.cwd, instruction.relativePath);
  writeFileSync(path.join(instruction.cwd, 'waiter.started'), '1', 'utf8');
  const committed = commitCanonicalFiles({
    cwd: instruction.cwd,
    entries: [{
      filePath: instruction.relativePath,
      targetPath,
      expectedBaseHash: hashContent(instruction.baseContent),
      content: instruction.nextContent,
      outputHash: hashContent(instruction.nextContent)
    }],
    lockWaitMs: instruction.lockWaitMs,
    lockPollMs: 5
  });
  writeFileSync(path.join(instruction.cwd, 'wait.result.json'), JSON.stringify({
    status: committed.status,
    reason: committed.reason,
    finishedAt: Date.now()
  }), 'utf8');
}
function runQueue(instruction: Extract<Instruction, { kind: 'queue' }>): void {
  withStewardApplyQueue({
    cwd: instruction.cwd,
    targetPaths: [instruction.targetPath],
    enabled: instruction.enabled,
    queueRoot: instruction.queueRoot,
    waitMs: 8_000,
    pollMs: 5
  }, () => {
    writeFileSync(instruction.enteredFlag, String(Date.now()), 'utf8');
    waitFor(() => existsSync(instruction.releaseFlag), 10_000, `${instruction.enteredFlag} release`);
  });
}
function writeInstruction(filePath: string, instruction: Instruction): void {
  writeFileSync(filePath, JSON.stringify(instruction), 'utf8');
}
async function runNamespaceDirection(holderInNamespace: boolean, lockWaitMs?: number): Promise<void> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-ns-lock-'));
  const children: ChildProcess[] = [];
  try {
    mkdirSync(path.join(root, 'ns-tmp'), { recursive: true });
    const relativePath = 'src/store.ts';
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    const original = 'original\n';
    writeFileSync(targetPath, original, 'utf8');
    const heldFlag = path.join(root, 'held');
    const releaseFlag = path.join(root, 'release');
    const holdPath = path.join(root, 'hold.json');
    const waitPath = path.join(root, 'wait.json');
    writeInstruction(holdPath, { kind: 'hold', cwd: root, relativePath, content: original, heldFlag, releaseFlag });
    writeInstruction(waitPath, {
      kind: 'wait', cwd: root, relativePath, baseContent: original, nextContent: 'original\n// WAITER\n', lockWaitMs
    });
    mkdirSync(path.join(root, 'host-tmp'), { recursive: true });
    const holder = spawnWorker(holdPath, holderInNamespace, { TMPDIR: path.join(root, 'ns-tmp') });
    children.push(holder);
    waitFor(() => existsSync(heldFlag), 10_000, 'namespace holder');
    const waiter = spawnWorker(waitPath, !holderInNamespace, { TMPDIR: path.join(root, 'host-tmp') });
    children.push(waiter);
    if (lockWaitMs === undefined) {
      waitFor(() => existsSync(path.join(root, 'waiter.started')), 10_000, 'namespace waiter');
      sleepMs(200);
      assert.equal(readFileSync(targetPath, 'utf8'), original);
      const releaseAt = Date.now();
      writeFileSync(releaseFlag, '1', 'utf8');
      const [holderDone, waiterDone] = await Promise.all(children.map((child) => collect(child)));
      assert.equal(holderDone.status, 0, holderDone.stderr);
      assert.equal(waiterDone.status, 0, waiterDone.stderr);
      const result = JSON.parse(readFileSync(path.join(root, 'wait.result.json'), 'utf8')) as { status: string; reason: string; finishedAt: number };
      assert.equal(result.status, 're-compose', result.reason);
      assert.ok(result.finishedAt >= releaseAt - 30);
      assert.equal(readFileSync(targetPath, 'utf8'), 'original\n// HELD\n');
      assert.equal(readFileSync(targetPath, 'utf8').includes('// WAITER'), false);
      return;
    }
    waitFor(() => existsSync(path.join(root, 'wait.result.json')), 10_000, 'namespace timeout result');
    const result = JSON.parse(readFileSync(path.join(root, 'wait.result.json'), 'utf8')) as { status: string; reason: string };
    assert.equal(result.status, 'recovery-required', result.reason);
    assert.match(result.reason, /recovery-required:/);
    assert.equal(readFileSync(targetPath, 'utf8'), original);
    writeFileSync(releaseFlag, '1', 'utf8');
    const [holderDone, waiterDone] = await Promise.all(children.map((child) => collect(child)));
    assert.equal(holderDone.status, 0, holderDone.stderr);
    assert.equal(waiterDone.status, 0, waiterDone.stderr);
    assert.equal(readFileSync(targetPath, 'utf8'), 'original\n// HELD\n');
    assert.equal(defaultStewardCommitLockRoot(root).includes(`${path.sep}.atm${path.sep}runtime${path.sep}steward-commit-locks`), true);
  } finally {
    for (const child of children) child.kill('SIGKILL');
    rmSync(root, { recursive: true, force: true });
  }
}
async function runOrphanTemps(): Promise<void> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-orphan-temp-'));
  const children: ChildProcess[] = [];
  try {
    const relativePath = 'src/store.ts';
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, 'original\n', 'utf8');
    const kept = path.join(path.dirname(targetPath), 'keep.atm-tmp');
    writeFileSync(kept, 'keep', 'utf8');
    const heldFlag = path.join(root, 'held');
    const releaseFlag = path.join(root, 'release');
    const holdPath = path.join(root, 'hold.json');
    writeInstruction(holdPath, {
      kind: 'hold', cwd: root, relativePath, content: 'original\n', heldFlag, releaseFlag, tempName: '.store.ts.1.0123456789ab.atm-tmp'
    });
    const holder = spawnWorker(holdPath, false);
    children.push(holder);
    waitFor(() => existsSync(heldFlag), 10_000, 'orphan holder');
    const temp = readFileSync(heldFlag, 'utf8');
    const skipped = cleanupOrphanCanonicalTemps({ targetPath, cwd: root });
    assert.equal(skipped.skippedLiveHolder, true);
    assert.deepEqual(skipped.removed, []);
    assert.equal(existsSync(temp), true);
    const blocked = commitCanonicalFiles({
      cwd: root,
      entries: [{
        filePath: relativePath,
        targetPath,
        expectedBaseHash: hashContent('original\n'),
        content: 'nope\n',
        outputHash: hashContent('nope\n')
      }],
      lockWaitMs: 40,
      lockPollMs: 5
    });
    assert.equal(blocked.status, 'recovery-required', blocked.reason);
    assert.equal(existsSync(temp), true);
    assert.equal(readFileSync(targetPath, 'utf8'), 'original\n');
    holder.kill('SIGKILL');
    await collect(holder);
    const removed = cleanupOrphanCanonicalTemps({ targetPath, cwd: root });
    assert.equal(removed.skippedLiveHolder, false);
    assert.equal(existsSync(temp), false);
    const orphan = path.join(path.dirname(targetPath), '.store.ts.2.abcdefabcdef.atm-tmp');
    writeFileSync(orphan, 'orphan', 'utf8');
    const committed = commitCanonicalFiles({
      cwd: root,
      entries: [{
        filePath: relativePath,
        targetPath,
        expectedBaseHash: hashContent('original\n'),
        content: 'recovered\n',
        outputHash: hashContent('recovered\n')
      }]
    });
    assert.equal(committed.status, 'applied', committed.reason);
    assert.equal(readFileSync(targetPath, 'utf8'), 'recovered\n');
    assert.equal(existsSync(orphan), false);
    assert.equal(readFileSync(kept, 'utf8'), 'keep');
  } finally {
    for (const child of children) child.kill('SIGKILL');
    rmSync(root, { recursive: true, force: true });
  }
}
function waiterCount(queueRoot: string, targetPath: string): number {
  const dbPath = path.join(queueRoot, stewardCommitTargetKey(targetPath), 'queue.sqlite');
  if (!existsSync(dbPath)) return 0;
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 0 });
    try {
      const row = db.prepare('SELECT COUNT(*) AS n FROM waiter').get() as { n: number } | undefined;
      return Number(row?.n ?? 0);
    } finally {
      db.close();
    }
  } catch {
    return 0;
  }
}
async function runQueueOrder(): Promise<void> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-apply-queue-'));
  const children: ChildProcess[] = [];
  try {
    const targetPath = path.join(root, 'src', 'store.ts');
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, 'original\n', 'utf8');
    const queueRoot = path.join(root, 'queue');
    const start = (role: string, enabled: boolean): ChildProcess => {
      const instructionPath = path.join(root, `${role}.json`);
      writeInstruction(instructionPath, {
        kind: 'queue', cwd: root, targetPath, queueRoot,
        enteredFlag: path.join(root, `${role}.entered`),
        releaseFlag: path.join(root, `${role}.release`),
        enabled
      });
      const child = spawnWorker(instructionPath, false);
      children.push(child);
      return child;
    };
    start('a', true);
    waitFor(() => existsSync(path.join(root, 'a.entered')), 10_000, 'queue head');
    start('b', true);
    start('c', true);
    waitFor(() => waiterCount(queueRoot, targetPath) >= 3, 10_000, 'three queue tickets');
    sleepMs(100);
    assert.equal(existsSync(path.join(root, 'b.entered')), false);
    assert.equal(existsSync(path.join(root, 'c.entered')), false);
    writeFileSync(path.join(root, 'a.release'), '1', 'utf8');
    waitFor(() => existsSync(path.join(root, 'b.entered')) || existsSync(path.join(root, 'c.entered')), 10_000, 'second ticket');
    const second = existsSync(path.join(root, 'b.entered')) ? 'b' : 'c';
    const third = second === 'b' ? 'c' : 'b';
    sleepMs(150);
    assert.equal(existsSync(path.join(root, `${third}.entered`)), false);
    writeFileSync(path.join(root, `${second}.release`), '1', 'utf8');
    waitFor(() => existsSync(path.join(root, `${third}.entered`)), 10_000, 'third ticket');
    writeFileSync(path.join(root, `${third}.release`), '1', 'utf8');
    const done = await Promise.all(children.map((child) => collect(child)));
    for (const child of done) assert.equal(child.status, 0, child.stderr);
    const killedRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-apply-queue-kill-'));
    try {
      const killedTarget = path.join(killedRoot, 'src', 'store.ts');
      mkdirSync(path.dirname(killedTarget), { recursive: true });
      writeFileSync(killedTarget, 'original\n', 'utf8');
      const killedQueue = path.join(killedRoot, 'queue');
      const holdPath = path.join(killedRoot, 'hold.json');
      writeInstruction(holdPath, {
        kind: 'queue', cwd: killedRoot, targetPath: killedTarget, queueRoot: killedQueue,
        enteredFlag: path.join(killedRoot, 'hold.entered'), releaseFlag: path.join(killedRoot, 'hold.release'), enabled: true
      });
      const hold = spawnWorker(holdPath, false);
      waitFor(() => existsSync(path.join(killedRoot, 'hold.entered')), 10_000, 'killed queue head');
      const nextPath = path.join(killedRoot, 'next.json');
      writeInstruction(nextPath, {
        kind: 'queue', cwd: killedRoot, targetPath: killedTarget, queueRoot: killedQueue,
        enteredFlag: path.join(killedRoot, 'next.entered'), releaseFlag: path.join(killedRoot, 'next.release'), enabled: true
      });
      const next = spawnWorker(nextPath, false);
      waitFor(() => waiterCount(killedQueue, killedTarget) >= 2, 10_000, 'waiter behind dead head');
      hold.kill('SIGKILL');
      await collect(hold);
      waitFor(() => existsSync(path.join(killedRoot, 'next.entered')), 10_000, 'queue advanced after SIGKILL');
      writeFileSync(path.join(killedRoot, 'next.release'), '1', 'utf8');
      const nextDone = await collect(next);
      assert.equal(nextDone.status, 0, nextDone.stderr);
    } finally {
      rmSync(killedRoot, { recursive: true, force: true });
    }
  } finally {
    for (const child of children) child.kill('SIGKILL');
    rmSync(root, { recursive: true, force: true });
  }
}
function runQueueFallbackAndPolicy(): void {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-queue-fallback-'));
  const previous = {
    queue: process.env.ATM_STEWARD_APPLY_QUEUE,
    lock: process.env.ATM_STEWARD_COMMIT_LOCK_ROOT,
    policy: process.env.ATM_STEWARD_RECOMPOSE_POLICY,
    wait: process.env.ATM_STEWARD_APPLY_QUEUE_WAIT_MS
  };
  try {
    const targetPath = path.join(root, 'file.txt');
    writeFileSync(targetPath, 'original\n', 'utf8');
    const blocker = path.join(root, 'not-a-directory');
    writeFileSync(blocker, 'x', 'utf8');
    let ran = false;
    withStewardApplyQueue({
      cwd: root, targetPaths: [targetPath], enabled: true, queueRoot: blocker, waitMs: 50, pollMs: 5
    }, () => {
      ran = true;
      const committed = commitCanonicalFiles({
        cwd: root,
        entries: [{
          filePath: 'file.txt', targetPath, expectedBaseHash: hashContent('original\n'),
          content: 'applied\n', outputHash: hashContent('applied\n')
        }]
      });
      assert.equal(committed.status, 'applied', committed.reason);
    });
    assert.equal(ran, true);
    assert.equal(readFileSync(targetPath, 'utf8'), 'applied\n');
    process.env.ATM_STEWARD_APPLY_QUEUE = 'off';
    process.env.ATM_STEWARD_COMMIT_LOCK_ROOT = 'custom-locks';
    process.env.ATM_STEWARD_RECOMPOSE_POLICY = '{"maxRecomposeAttempts":1,"recomposeBackoffMs":0,"recomposeJitterMs":2}';
    process.env.ATM_STEWARD_APPLY_QUEUE_WAIT_MS = '25';
    const controls = resolveStewardCommitControls({ cwd: root });
    assert.equal(controls.applyQueue, false);
    assert.equal(controls.lockRoot, path.resolve(root, 'custom-locks'));
    assert.equal(controls.maxRecomposeAttempts, 1);
    assert.equal(controls.recomposeBackoffMs, 0);
    assert.equal(controls.recomposeJitterMs, 2);
    assert.equal(controls.applyQueueWaitMs, 25);
    const override = resolveStewardCommitControls({
      cwd: root, applyQueue: true, commitLockRoot: path.join(root, 'explicit'), recomposePolicy: { maxRecomposeAttempts: 0 }
    });
    assert.equal(override.applyQueue, true);
    assert.equal(override.lockRoot, path.join(root, 'explicit'));
    assert.equal(override.maxRecomposeAttempts, 0);
    assert.equal(override.recomposeJitterMs, 2);
  } finally {
    restoreEnv('ATM_STEWARD_APPLY_QUEUE', previous.queue);
    restoreEnv('ATM_STEWARD_COMMIT_LOCK_ROOT', previous.lock);
    restoreEnv('ATM_STEWARD_RECOMPOSE_POLICY', previous.policy);
    restoreEnv('ATM_STEWARD_APPLY_QUEUE_WAIT_MS', previous.wait);
    rmSync(root, { recursive: true, force: true });
  }
}
function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
async function runQueueBypass(): Promise<void> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-queue-off-'));
  const children: ChildProcess[] = [];
  try {
    const targetPath = path.join(root, 'src', 'store.ts');
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, 'original\n', 'utf8');
    const queueRoot = path.join(root, 'queue');
    const start = (role: string): void => {
      const instructionPath = path.join(root, `${role}.json`);
      writeInstruction(instructionPath, {
        kind: 'queue', cwd: root, targetPath, queueRoot,
        enteredFlag: path.join(root, `${role}.entered`),
        releaseFlag: path.join(root, `${role}.release`),
        enabled: false
      });
      children.push(spawnWorker(instructionPath, false, { ATM_STEWARD_APPLY_QUEUE: 'off' }));
    };
    start('a');
    waitFor(() => existsSync(path.join(root, 'a.entered')), 10_000, 'queue bypass a');
    start('b');
    waitFor(() => existsSync(path.join(root, 'b.entered')), 10_000, 'queue bypass b');
    assert.equal(existsSync(path.join(root, 'a.release')), false);
    writeFileSync(path.join(root, 'a.release'), '1', 'utf8');
    writeFileSync(path.join(root, 'b.release'), '1', 'utf8');
    const done = await Promise.all(children.map((child) => collect(child)));
    for (const child of done) assert.equal(child.status, 0, child.stderr);
  } finally {
    for (const child of children) child.kill('SIGKILL');
    rmSync(root, { recursive: true, force: true });
  }
}
async function main(): Promise<void> {
  if (process.env[workerFlag] === '1') {
    const instructionPath = process.env[instructionEnv];
    if (!instructionPath) throw new Error('missing instruction');
    const instruction = JSON.parse(readFileSync(instructionPath, 'utf8')) as Instruction;
    if (instruction.kind === 'hold') runHold(instruction);
    else if (instruction.kind === 'wait') runWait(instruction);
    else runQueue(instruction);
    return;
  }
  const skip = unshareSkipReason();
  if (skip) console.log(`[steward-kernel-lock] skip cross-pid-namespace: ${skip}`);
  else {
    await runNamespaceDirection(false);
    await runNamespaceDirection(true);
    await runNamespaceDirection(false, 80);
    await runNamespaceDirection(true, 80);
    console.log('[steward-kernel-lock] cross-pid-namespace ran via unshare');
  }
  await runOrphanTemps();
  await runQueueOrder();
  runQueueFallbackAndPolicy();
  await runQueueBypass();
  console.log('[steward-kernel-lock] ok');
}
await main();
