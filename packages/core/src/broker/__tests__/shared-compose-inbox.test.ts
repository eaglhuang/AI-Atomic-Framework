// 共用收件匣：雙程序 barrier、兩種到達順序、與 git merge 位元組相同、
// 真衝突不落地、窗到期、崩潰清理，以及預設窗長 0 的單提案相容。
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { composeBrokerProposals } from '../compose.ts';
import { applyUnifiedPatch } from '../unified-patch.ts';
import {
  hashComposeBytes,
  recoverSharedComposeInbox,
  submitSharedComposeProposal,
  type SharedComposeReceipt
} from '../shared-compose-inbox.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(here, 'shared-compose-inbox.worker.ts');
const stripFlag = Number(process.versions.node.split('.')[0] ?? '0') >= 24 ? '--strip-types' : '--experimental-strip-types';
const LINES = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];
const BASE = `${LINES.join('\n')}\n`;

interface WorkerJob {
  inboxDir: string;
  targetPath: string;
  targetFile: string;
  proposalId: string;
  actorId: string;
  taskId: string;
  baseHash: string;
  baseBytes: string;
  patch: string;
  composeWindowMs: number;
  maxBatchSize: number;
  deadlineMs: number;
  barrierDir: string | null;
  barrierCount: number;
  staggerMs: number;
  crashOnFlag: boolean;
}

async function main(): Promise<void> {
  const root = mkdtempSync(path.join(tmpdir(), 'atm-compose-inbox-'));
  try {
    assertDisjointComposeStillParallelSafe();
    await testImmediateWindowIsSingleProposal(root);
    await testWindowExpiryRecomposesLateProposal(root);
    await testTwoProcessBarrier(root);
    await testBothArrivalOrdersMatchGitMerge(root);
    await testTrueConflictWritesNothing(root);
    await testCrashPeerRecovers(root);
    await testCrashExplicitCleanup(root);
    console.log('ok: shared compose inbox');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertDisjointComposeStillParallelSafe(): void {
  const left = proposal('prop-left', patchLine('demo.txt', 1, 'BETA'));
  const right = proposal('prop-right', patchLine('demo.txt', 4, 'EPSILON'));
  const result = composeBrokerProposals([left, right]);
  assert.equal(result.ok, true);
  assert.equal(result.mergePlan.verdict, 'parallel-safe');
}

async function testImmediateWindowIsSingleProposal(root: string): Promise<void> {
  const scene = createScene(root, 'immediate');
  const first = await submitSharedComposeProposal(scene.input('prop-a', 'writer-a', patchLine(scene.targetFile, 1, 'BETA')));
  const second = await submitSharedComposeProposal(scene.input('prop-b', 'writer-b', patchLine(scene.targetFile, 2, 'GAMMA')));
  assert.equal(first.batchSize, 1);
  assert.equal(second.batchSize, 1);
  assert.notEqual(first.batchId, second.batchId);
  assert.equal(first.terminal, 'committed');
  assert.equal(second.terminal, 'committed');
  assert.deepEqual(first.stagesReached, ['admission', 'batch', 'compose', 'commit']);
  assert.equal(readFileSync(scene.targetPath, 'utf8'), expectedGitMerge(patchLine(scene.targetFile, 1, 'BETA'), patchLine(scene.targetFile, 2, 'GAMMA')));

  const denied = await submitSharedComposeProposal({
    ...scene.input('prop-deny', 'writer-c', patchLine(scene.targetFile, 3, 'DELTA')),
    admission: { admitted: false, reasonCode: 'not-admitted' }
  });
  assert.equal(denied.terminal, 'rejected-admission');
  assert.deepEqual(denied.stagesReached, ['admission']);
  assert.equal(denied.batchId, null);
}

async function testWindowExpiryRecomposesLateProposal(root: string): Promise<void> {
  const scene = createScene(root, 'expiry');
  const first = await submitSharedComposeProposal({
    ...scene.input('prop-a', 'writer-a', patchLine(scene.targetFile, 1, 'BETA')),
    composeWindowMs: 80,
    maxBatchSize: 8
  });
  const second = await submitSharedComposeProposal({
    ...scene.input('prop-b', 'writer-b', patchLine(scene.targetFile, 2, 'GAMMA')),
    composeWindowMs: 80,
    maxBatchSize: 8
  });
  assert.equal(first.batchSize, 1);
  assert.equal(second.batchSize, 1);
  assert.equal(second.late, true);
  assert.notEqual(first.batchId, second.batchId);
  assert.equal(first.baseHash, hashComposeBytes(BASE));
  assert.notEqual(second.baseHash, first.baseHash);
  assert.equal(readFileSync(scene.targetPath, 'utf8'), expectedGitMerge(patchLine(scene.targetFile, 1, 'BETA'), patchLine(scene.targetFile, 2, 'GAMMA')));
}

async function testTwoProcessBarrier(root: string): Promise<void> {
  const scene = createScene(root, 'barrier');
  const barrierDir = path.join(scene.dir, 'barrier');
  const [left, right] = await runPair(scene, {
    composeWindowMs: 2_000,
    maxBatchSize: 2,
    barrierDir,
    staggerMs: 0,
    patches: [patchLine(scene.targetFile, 1, 'BETA'), patchLine(scene.targetFile, 4, 'EPSILON')]
  });
  assert.equal(left.receipt.terminal, 'committed');
  assert.equal(right.receipt.terminal, 'committed');
  assert.equal(left.receipt.batchId, right.receipt.batchId);
  assert.equal(left.receipt.batchSize, 2);
  assert.equal(right.receipt.batchSize, 2);
  assert.equal(left.receipt.baseHash, hashComposeBytes(BASE));
  assert.ok(left.receipt.stagesReached.includes('batch'));
  assert.ok(left.receipt.stagesReached.includes('commit'));
}

async function testBothArrivalOrdersMatchGitMerge(root: string): Promise<void> {
  const patchA = patchLine('overlap.txt', 1, 'BETA');
  const patchB = patchLine('overlap.txt', 2, 'GAMMA');
  const expected = expectedGitMerge(patchA, patchB);
  for (const first of ['prop-a', 'prop-b'] as const) {
    const scene = createScene(root, `order-${first}`);
    scene.targetFile = 'overlap.txt';
    scene.targetPath = path.join(scene.dir, 'overlap.txt');
    writeFileSync(scene.targetPath, BASE);
    const second = first === 'prop-a' ? 'prop-b' : 'prop-a';
    const jobs = await runJobs(scene, [
      job(scene, first, first === 'prop-a' ? patchA : patchB, { staggerMs: 0, composeWindowMs: 400, maxBatchSize: 8, barrierDir: path.join(scene.dir, 'barrier') }),
      job(scene, second, second === 'prop-b' ? patchB : patchA, { staggerMs: 40, composeWindowMs: 400, maxBatchSize: 8, barrierDir: path.join(scene.dir, 'barrier') })
    ]);
    assert.equal(jobs[0]?.receipt.batchId, jobs[1]?.receipt.batchId);
    assert.equal(jobs[0]?.receipt.batchSize, 2);
    assert.equal(readFileSync(scene.targetPath, 'utf8'), expected);
    assert.equal(readFileSync(scene.targetPath, 'utf8').includes('<<<<<<<'), false);
  }
}

async function testTrueConflictWritesNothing(root: string): Promise<void> {
  const scene = createScene(root, 'conflict');
  const barrierDir = path.join(scene.dir, 'barrier');
  const [left, right] = await runPair(scene, {
    composeWindowMs: 2_000,
    maxBatchSize: 2,
    barrierDir,
    staggerMs: 0,
    patches: [patchLine(scene.targetFile, 1, 'BETA-A'), patchLine(scene.targetFile, 1, 'BETA-B')]
  });
  assert.equal(left.receipt.terminal, 'rejected-conflict');
  assert.equal(right.receipt.terminal, 'rejected-conflict');
  assert.equal(left.receipt.batchSize, 2);
  assert.equal(left.receipt.stage, 'compose');
  assert.equal(left.receipt.stagesReached.includes('commit'), false);
  assert.equal(readFileSync(scene.targetPath, 'utf8'), BASE);
  assert.equal(readFileSync(scene.targetPath, 'utf8').includes('<<<<<<<'), false);
  assert.equal(readFileSync(scene.targetPath, 'utf8').includes('BETA-A'), false);
  assert.equal(readFileSync(scene.targetPath, 'utf8').includes('BETA-B'), false);
}

async function testCrashPeerRecovers(root: string): Promise<void> {
  const scene = createScene(root, 'crash-peer');
  writeFileSync(path.join(scene.inboxDir, 'crash-once'), '1');
  const barrierDir = path.join(scene.dir, 'barrier');
  const results = await runJobs(scene, [
    { ...job(scene, 'prop-a', patchLine(scene.targetFile, 1, 'BETA'), { composeWindowMs: 2_000, maxBatchSize: 2, barrierDir }), crashOnFlag: true },
    { ...job(scene, 'prop-b', patchLine(scene.targetFile, 4, 'EPSILON'), { composeWindowMs: 2_000, maxBatchSize: 2, barrierDir }), crashOnFlag: true }
  ], { allowExit: new Set([0, 99]) });
  assert.ok(results.some((result) => result.status === 99));
  assert.ok(results.some((result) => result.status === 0));
  assert.equal(readFileSync(scene.targetPath, 'utf8'), expectedGitMerge(patchLine(scene.targetFile, 1, 'BETA'), patchLine(scene.targetFile, 4, 'EPSILON')));
  for (const id of ['prop-a', 'prop-b']) {
    const receipt = JSON.parse(readFileSync(path.join(scene.inboxDir, 'receipts', `${id}.json`), 'utf8')) as SharedComposeReceipt;
    assert.equal(receipt.terminal, 'committed');
    assert.equal(receipt.batchSize, 2);
  }
  assert.equal(readdirSync(scene.dir).some((name) => name.includes('.tmp-compose-')), false);
}

async function testCrashExplicitCleanup(root: string): Promise<void> {
  const scene = createScene(root, 'crash-cleanup');
  writeFileSync(path.join(scene.inboxDir, 'crash-once'), '1');
  const [result] = await runJobs(scene, [
    { ...job(scene, 'prop-a', patchLine(scene.targetFile, 1, 'BETA'), { composeWindowMs: 0, maxBatchSize: 1, barrierDir: null }), crashOnFlag: true }
  ], { allowExit: new Set([99]) });
  assert.equal(result?.status, 99);
  assert.equal(readFileSync(scene.targetPath, 'utf8'), BASE);
  assert.equal(existsSync(path.join(scene.inboxDir, 'receipts', 'prop-a.json')), false);
  const tempsBefore = readdirSync(scene.dir).filter((name) => name.includes('.tmp-compose-'));
  assert.ok(tempsBefore.length >= 1);
  const recovered = recoverSharedComposeInbox({ inboxDir: scene.inboxDir, force: true });
  assert.ok(recovered.recoveredBatchIds.length >= 1);
  assert.equal(readFileSync(scene.targetPath, 'utf8'), applyUnifiedPatch(BASE, patchLine(scene.targetFile, 1, 'BETA')));
  assert.equal(readdirSync(scene.dir).some((name) => name.includes('.tmp-compose-')), false);
  assert.ok(recovered.removedTempFiles.length >= 1);
  const again = recoverSharedComposeInbox({ inboxDir: scene.inboxDir, force: true });
  assert.deepEqual(again.recoveredBatchIds, []);
  const receipt = JSON.parse(readFileSync(path.join(scene.inboxDir, 'receipts', 'prop-a.json'), 'utf8')) as SharedComposeReceipt;
  assert.equal(receipt.terminal, 'committed');
  assert.equal(receipt.batchSize, 1);
}

interface Scene {
  dir: string;
  inboxDir: string;
  targetPath: string;
  targetFile: string;
  input(proposalId: string, actorId: string, patch: string): Parameters<typeof submitSharedComposeProposal>[0];
}

function createScene(root: string, name: string): Scene {
  const dir = path.join(root, name);
  const inboxDir = path.join(dir, 'inbox');
  mkdirSync(inboxDir, { recursive: true });
  const targetFile = 'shared.txt';
  const targetPath = path.join(dir, targetFile);
  writeFileSync(targetPath, BASE);
  return {
    dir,
    inboxDir,
    targetPath,
    targetFile,
    input(proposalId, actorId, patch) {
      return {
        inboxDir,
        targetPath,
        targetFile,
        proposalId,
        actorId,
        taskId: `TASK-${proposalId}`,
        baseHash: hashComposeBytes(BASE),
        baseBytes: BASE,
        patch,
        composeWindowMs: 0,
        maxBatchSize: 32,
        deadlineMs: 10_000
      };
    }
  };
}

function job(scene: Scene, proposalId: string, patch: string, extra: { staggerMs?: number; composeWindowMs: number; maxBatchSize: number; barrierDir: string | null }): WorkerJob {
  return {
    inboxDir: scene.inboxDir,
    targetPath: scene.targetPath,
    targetFile: scene.targetFile,
    proposalId,
    actorId: `writer-${proposalId}`,
    taskId: `TASK-${proposalId}`,
    baseHash: hashComposeBytes(BASE),
    baseBytes: BASE,
    patch,
    composeWindowMs: extra.composeWindowMs,
    maxBatchSize: extra.maxBatchSize,
    deadlineMs: 15_000,
    barrierDir: extra.barrierDir,
    barrierCount: 2,
    staggerMs: extra.staggerMs ?? 0,
    crashOnFlag: false
  };
}

async function runPair(scene: Scene, options: {
  composeWindowMs: number;
  maxBatchSize: number;
  barrierDir: string;
  staggerMs: number;
  patches: [string, string];
}): Promise<[{ receipt: SharedComposeReceipt }, { receipt: SharedComposeReceipt }]> {
  const results = await runJobs(scene, [
    job(scene, 'prop-a', options.patches[0], options),
    job(scene, 'prop-b', options.patches[1], { ...options, staggerMs: options.staggerMs })
  ]);
  return [mustReceipt(results[0]), mustReceipt(results[1])];
}

async function runJobs(scene: Scene, jobs: WorkerJob[], options?: { allowExit?: Set<number> }): Promise<{ status: number; receipt: SharedComposeReceipt }[]> {
  void scene;
  const children: ChildProcess[] = [];
  const finished = jobs.map((entry) => new Promise<{ status: number; receipt: SharedComposeReceipt }>((resolve, reject) => {
    const jobPath = path.join(entry.inboxDir, `job-${entry.proposalId}.json`);
    writeFileSync(jobPath, JSON.stringify(entry));
    const child = spawn(process.execPath, [stripFlag, workerPath, jobPath], { stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('exit', (status) => {
      const code = status ?? 1;
      const allowed = options?.allowExit ?? new Set([0]);
      if (!allowed.has(code)) {
        reject(new Error(`worker ${entry.proposalId} exit ${code}\n${stderr}`));
        return;
      }
      const resultPath = `${jobPath}.result.json`;
      if (!existsSync(resultPath)) {
        resolve({ status: code, receipt: undefined as unknown as SharedComposeReceipt });
        return;
      }
      const parsed = JSON.parse(readFileSync(resultPath, 'utf8')) as { ok: boolean; detail?: string; receipt?: SharedComposeReceipt };
      if (!parsed.ok || !parsed.receipt) {
        reject(new Error(parsed.detail ?? `worker ${entry.proposalId} failed`));
        return;
      }
      resolve({ status: code, receipt: parsed.receipt });
    });
  }));
  try {
    return await Promise.all(finished);
  } finally {
    for (const child of children) {
      if (child.exitCode === null) child.kill();
    }
  }
}

function mustReceipt(result: { receipt: SharedComposeReceipt } | undefined): { receipt: SharedComposeReceipt } {
  if (!result?.receipt) throw new Error('缺少提案收據');
  return { receipt: result.receipt };
}

function proposal(proposalId: string, patch: string) {
  return {
    schemaId: 'atm.patchProposal.v1' as const,
    specVersion: '0.1.0' as const,
    migration: { strategy: 'none' as const, fromVersion: null, notes: 'test' },
    proposalId,
    taskId: `TASK-${proposalId}`,
    actorId: proposalId,
    baseCommit: '0'.repeat(40),
    fileBeforeHash: hashComposeBytes(BASE),
    targetFile: 'demo.txt',
    atomRefs: [{ atomId: `atom.${proposalId}`, atomCid: `cid.${proposalId}` }],
    anchors: [{ kind: 'line', hint: proposalId }],
    intent: proposalId,
    patch,
    validators: [] as string[],
    rollback: 'discard'
  };
}

function patchLine(targetFile: string, index: number, next: string): string {
  const start = Math.max(0, index - 1);
  const end = Math.min(LINES.length, index + 2);
  const body: string[] = [];
  for (let cursor = start; cursor < end; cursor += 1) {
    if (cursor === index) {
      body.push(`-${LINES[cursor]}`);
      body.push(`+${next}`);
    } else {
      body.push(` ${LINES[cursor]}`);
    }
  }
  const count = end - start;
  return [`--- a/${targetFile}`, `+++ b/${targetFile}`, `@@ -${start + 1},${count} +${start + 1},${count} @@`, ...body, ''].join('\n');
}

function expectedGitMerge(patchA: string, patchB: string): string {
  const mineA = applyUnifiedPatch(BASE, patchA);
  const mineB = applyUnifiedPatch(BASE, patchB);
  const first = 'prop-a' < 'prop-b' ? mineA : mineB;
  const second = 'prop-a' < 'prop-b' ? mineB : mineA;
  return gitMergeFile(gitMergeFile(BASE, BASE, first), BASE, second);
}

function gitMergeFile(current: string, base: string, theirs: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'atm-expect-merge-'));
  try {
    writeFileSync(path.join(directory, 'ours'), current);
    writeFileSync(path.join(directory, 'base'), base);
    writeFileSync(path.join(directory, 'theirs'), theirs);
    const result = spawnSync('git', ['merge-file', '-p', path.join(directory, 'ours'), path.join(directory, 'base'), path.join(directory, 'theirs')], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

await main();
