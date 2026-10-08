import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashContent } from '../../packages/core/src/broker/adapters/cas.ts';
import { canonicalCommitLockPath, commitCanonicalFiles, holdCanonicalCommitLock } from '../../packages/core/src/broker/steward-commit-guard.ts';
import { composeTransactionalMutations } from '../../packages/core/src/broker/transactional-composer.ts';
import {
  applyTransactionalStewardPlan,
  buildStewardSemanticValidationReceipt
} from '../../packages/core/src/broker/steward-transactional-apply.ts';
import { brokerAdapterMigration, type MutationRequest } from '../../packages/core/src/broker/types.ts';

const workerFlag = 'ATM_STEWARD_COMMIT_WORKER';
const instructionEnv = 'ATM_STEWARD_COMMIT_INSTRUCTION';

interface WorkerInstruction {
  readonly cwd: string;
  readonly relativePath: string;
  readonly baseContent: string;
  readonly role: 'leader' | 'follower';
  readonly barrierDir: string;
  readonly requestId: string;
  readonly target: string;
  readonly value: string;
  readonly lockRoot: string;
}

interface WorkerResult {
  readonly role: 'leader' | 'follower';
  readonly ok: boolean;
  readonly verdict: string | null;
  readonly blockedReasons: readonly string[];
  readonly intended: string | null;
  readonly error: string | null;
}

function mutation(requestId: string, filePath: string, target: string, value: string): MutationRequest {
  return {
    schemaId: 'atm.mutationRequest.v1',
    specVersion: '0.1.0',
    migration: brokerAdapterMigration(),
    requestId,
    actorId: `actor-${requestId}`,
    taskId: 'ATM-STEWARD-COMMIT',
    filePath,
    op: 'upsert',
    target,
    value
  };
}

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

function runWorker(instruction: WorkerInstruction): WorkerResult {
  const targetPath = path.join(instruction.cwd, instruction.relativePath);
  const composition = composeTransactionalMutations({
    files: [{ filePath: instruction.relativePath, content: instruction.baseContent }],
    requests: [mutation(instruction.requestId, instruction.relativePath, instruction.target, instruction.value)]
  });
  if (!composition.ok) {
    return {
      role: instruction.role,
      ok: false,
      verdict: null,
      blockedReasons: ['composition failed before apply'],
      intended: null,
      error: 'composition failed'
    };
  }
  const intended = composition.outputFiles.find((file) => file.filePath === instruction.relativePath)?.content ?? null;
  const receipt = buildStewardSemanticValidationReceipt({
    plan: composition.plan,
    outputFiles: composition.outputFiles
  });
  try {
    const apply = applyTransactionalStewardPlan({
      cwd: instruction.cwd,
      stewardId: 'neutral-write-steward',
      writerRole: 'neutral-steward',
      plan: composition.plan,
      outputFiles: composition.outputFiles,
      scopeFiles: [instruction.relativePath],
      semanticValidation: receipt,
      commitLockRoot: instruction.lockRoot,
      commitHooks: {
        afterPrecheck() {
          writeFileSync(path.join(instruction.barrierDir, `${instruction.role}.ready`), '1', 'utf8');
          waitFor(
            () => existsSync(path.join(instruction.barrierDir, 'leader.ready'))
              && existsSync(path.join(instruction.barrierDir, 'follower.ready')),
            10_000,
            'both stewards to pass the unlocked precheck'
          );
          if (instruction.role === 'follower') {
            waitFor(
              () => existsSync(path.join(instruction.barrierDir, 'leader.done')),
              10_000,
              'leader commit to finish'
            );
          }
        }
      }
    });
    return {
      role: instruction.role,
      ok: apply.ok,
      verdict: apply.receipt.verdict,
      blockedReasons: apply.receipt.blockedReasons,
      intended,
      error: null
    };
  } catch (error) {
    return {
      role: instruction.role,
      ok: false,
      verdict: null,
      blockedReasons: [],
      intended,
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    if (instruction.role === 'leader') {
      writeFileSync(path.join(instruction.barrierDir, 'leader.done'), '1', 'utf8');
    }
  }
}

function spawnWorker(instructionPath: string): Promise<{ readonly status: number | null; readonly stdout: string; readonly stderr: string }> {
  const testPath = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, ['--strip-types', testPath], {
    env: {
      ...process.env,
      [workerFlag]: '1',
      [instructionEnv]: instructionPath
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString('utf8');
  });
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

function readWorkerResult(barrierDir: string, role: 'leader' | 'follower', spawned: { readonly status: number | null; readonly stdout: string; readonly stderr: string }): WorkerResult {
  const resultPath = path.join(barrierDir, `${role}.result.json`);
  assert.equal(existsSync(resultPath), true, `${role} worker did not write a result\n${spawned.stdout}\n${spawned.stderr}`);
  const result = JSON.parse(readFileSync(resultPath, 'utf8')) as WorkerResult;
  assert.equal(spawned.status, 0, `${role} worker failed: ${result.error ?? ''}\n${spawned.stdout}\n${spawned.stderr}`);
  return result;
}

async function runInterleaving(): Promise<void> {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-steward-interleave-'));
  try {
    const relativePath = 'src/store.json';
    const targetPath = path.join(root, relativePath);
    const baseContent = '{\n  "records": {}\n}\n';
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, baseContent, 'utf8');
    const barrierDir = path.join(root, 'barrier');
    const lockRoot = path.join(root, 'locks');
    mkdirSync(barrierDir, { recursive: true });
    mkdirSync(lockRoot, { recursive: true });
    const leaderInstruction: WorkerInstruction = {
      cwd: root,
      relativePath,
      baseContent,
      role: 'leader',
      barrierDir,
      requestId: 'leader',
      target: '/records/leader',
      value: 'LEADER_EFFECT',
      lockRoot
    };
    const followerInstruction: WorkerInstruction = {
      ...leaderInstruction,
      role: 'follower',
      requestId: 'follower',
      target: '/records/follower',
      value: 'FOLLOWER_EFFECT'
    };
    const leaderPath = path.join(barrierDir, 'leader.instruction.json');
    const followerPath = path.join(barrierDir, 'follower.instruction.json');
    writeFileSync(leaderPath, JSON.stringify(leaderInstruction), 'utf8');
    writeFileSync(followerPath, JSON.stringify(followerInstruction), 'utf8');
    const [leaderSpawn, followerSpawn] = await Promise.all([
      spawnWorker(leaderPath),
      spawnWorker(followerPath)
    ]);
    const leader = readWorkerResult(barrierDir, 'leader', leaderSpawn);
    const follower = readWorkerResult(barrierDir, 'follower', followerSpawn);
    const landed = readFileSync(targetPath, 'utf8');
    assert.equal(leader.error, null, leader.error ?? '');
    assert.equal(follower.error, null, follower.error ?? '');
    assert.equal(leader.ok, true);
    assert.equal(leader.verdict, 'applied');
    assert.equal(follower.ok, false);
    assert.equal(follower.verdict, 're-compose');
    assert.match(follower.blockedReasons.join('\n'), /re-compose:/);
    assert.equal(landed, leader.intended);
    assert.equal(landed.includes('LEADER_EFFECT'), true);
    assert.equal(landed.includes('FOLLOWER_EFFECT'), false);
    assert.equal(Buffer.byteLength(landed), Buffer.byteLength(leader.intended ?? ''));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function applyComposed(input: {
  readonly cwd: string;
  readonly relativePath: string;
  readonly baseContent: string;
  readonly requestId: string;
  readonly target: string;
  readonly value: string;
  readonly lockRoot: string;
  readonly afterPrecheck?: () => void;
  readonly commitFault?: { readonly kind: 'before-rename' } | { readonly kind: 'partial-temp'; readonly byteCount: number };
}) {
  const composition = composeTransactionalMutations({
    files: [{ filePath: input.relativePath, content: input.baseContent }],
    requests: [mutation(input.requestId, input.relativePath, input.target, input.value)]
  });
  assert.equal(composition.ok, true);
  const receipt = buildStewardSemanticValidationReceipt({
    plan: composition.plan,
    outputFiles: composition.outputFiles
  });
  const apply = applyTransactionalStewardPlan({
    cwd: input.cwd,
    stewardId: 'neutral-write-steward',
    writerRole: 'neutral-steward',
    plan: composition.plan,
    outputFiles: composition.outputFiles,
    scopeFiles: [input.relativePath],
    semanticValidation: receipt,
    commitLockRoot: input.lockRoot,
    commitFault: input.commitFault,
    commitHooks: input.afterPrecheck ? { afterPrecheck: input.afterPrecheck } : undefined
  });
  return { composition, apply };
}

function runStaleBase(): void {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-steward-stale-base-'));
  try {
    const relativePath = 'src/store.json';
    const targetPath = path.join(root, relativePath);
    const baseContent = '{\n  "records": {}\n}\n';
    const drifted = '{\n  "records": {\n    "other": "KEPT_EFFECT"\n  }\n}\n';
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, baseContent, 'utf8');
    const { apply } = applyComposed({
      cwd: root,
      relativePath,
      baseContent,
      requestId: 'stale',
      target: '/records/stale',
      value: 'STALE_EFFECT',
      lockRoot: path.join(root, 'locks'),
      afterPrecheck() {
        writeFileSync(targetPath, drifted, 'utf8');
      }
    });
    assert.equal(apply.ok, false);
    assert.equal(apply.receipt.verdict, 're-compose');
    assert.match(apply.receipt.blockedReasons.join('\n'), /re-compose:/);
    assert.equal(apply.receipt.files.length, 0);
    assert.equal(readFileSync(targetPath, 'utf8'), drifted);
    assert.equal(readFileSync(targetPath, 'utf8').includes('STALE_EFFECT'), false);
    assert.equal(readFileSync(targetPath, 'utf8').includes('KEPT_EFFECT'), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function runTornWrite(): void {
  const root = mkdtempSync(path.join(os.tmpdir(), 'atm-steward-torn-'));
  try {
    const relativePath = 'src/store.json';
    const targetPath = path.join(root, relativePath);
    const baseContent = '{\n  "records": {}\n}\n';
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, baseContent, 'utf8');
    const lockRoot = path.join(root, 'locks');

    const partial = applyComposed({
      cwd: root,
      relativePath,
      baseContent,
      requestId: 'partial',
      target: '/records/partial',
      value: 'B'.repeat(40),
      lockRoot,
      commitFault: { kind: 'partial-temp', byteCount: 12 }
    });
    assert.equal(partial.apply.ok, false);
    assert.equal(partial.apply.receipt.verdict, 'rolled-back');
    assert.equal(readFileSync(targetPath, 'utf8'), baseContent);

    const beforeRename = applyComposed({
      cwd: root,
      relativePath,
      baseContent,
      requestId: 'before-rename',
      target: '/records/rename',
      value: 'C'.repeat(20),
      lockRoot,
      commitFault: { kind: 'before-rename' }
    });
    assert.equal(beforeRename.apply.ok, false);
    assert.equal(beforeRename.apply.receipt.verdict, 'rolled-back');
    assert.equal(readFileSync(targetPath, 'utf8'), baseContent);

    const longContent = 'A'.repeat(700);
    const shorter = 'B'.repeat(699);
    const direct = path.join(root, 'direct.txt');
    writeFileSync(direct, longContent, 'utf8');
    const fdA = openSync(direct, 'w');
    const fdB = openSync(direct, 'w');
    writeSync(fdA, longContent);
    writeSync(fdB, shorter);
    closeSync(fdA);
    closeSync(fdB);
    const torn = readFileSync(direct, 'utf8');
    assert.equal(torn.length, 700, 'overlapping truncating writes leave a stale tail byte');
    assert.equal(torn.slice(0, 699), shorter);
    assert.equal(torn[699], 'A');

    writeFileSync(direct, longContent, 'utf8');
    const committed = commitCanonicalFiles({
      entries: [{
        filePath: 'direct.txt',
        targetPath: direct,
        expectedBaseHash: hashContent(longContent),
        content: shorter,
        outputHash: hashContent(shorter)
      }],
      lockRoot
    });
    assert.equal(committed.status, 'applied');
    assert.equal(readFileSync(direct, 'utf8'), shorter);
    assert.equal(Buffer.byteLength(readFileSync(direct)), 699);

    const locked = path.join(root, 'locked.txt');
    writeFileSync(locked, 'original\n', 'utf8');
    const lockDir = canonicalCommitLockPath(lockRoot, locked);
    const releaseLock = holdCanonicalCommitLock(lockDir, 'locked.txt');
    try {
      const recovery = commitCanonicalFiles({
        entries: [{
          filePath: 'locked.txt',
          targetPath: locked,
          expectedBaseHash: hashContent('original\n'),
          content: 'replacement\n',
          outputHash: hashContent('replacement\n')
        }],
        lockRoot,
        lockWaitMs: 40,
        lockPollMs: 5
      });
      assert.equal(recovery.status, 'recovery-required');
      assert.match(recovery.reason, /recovery-required:/);
      assert.equal(readFileSync(locked, 'utf8'), 'original\n');
    } finally {
      releaseLock();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  if (process.env[workerFlag] === '1') {
    const instructionPath = process.env[instructionEnv];
    if (!instructionPath) throw new Error('missing worker instruction');
    const instruction = JSON.parse(readFileSync(instructionPath, 'utf8')) as WorkerInstruction;
    const result = runWorker(instruction);
    writeFileSync(path.join(instruction.barrierDir, `${instruction.role}.result.json`), JSON.stringify(result), 'utf8');
    if (result.error) process.exitCode = 1;
    return;
  }
  await runInterleaving();
  runStaleBase();
  runTornWrite();
  console.log('[steward-concurrent-commit] ok');
}

await main();
