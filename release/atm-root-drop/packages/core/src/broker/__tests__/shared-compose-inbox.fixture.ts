// Shared fixtures for the cross-writer compose inbox tests.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashComposeBytes, submitSharedComposeProposal, type SharedComposeReceipt, type SubmitSharedComposeInput } from '../shared-compose-inbox.ts';

export const LINES = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta'];
export const BASE = `${LINES.join('\n')}\n`;
export const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'shared-compose-inbox.worker.ts');
export const stripFlag = Number(process.versions.node.split('.')[0] ?? '0') >= 24 ? '--strip-types' : '--experimental-strip-types';

export interface Scene {
  dir: string;
  inboxDir: string;
  targetPath: string;
  targetFile: string;
  input(proposalId: string, actorId: string, patch: string, extra?: Partial<SubmitSharedComposeInput>): SubmitSharedComposeInput;
}

export function createScene(root: string, name: string): Scene {
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
    input(proposalId, actorId, patch, extra = {}) {
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
        scope: `scope-${proposalId}`,
        ticket: `ticket-${proposalId}`,
        validators: ['validator-noop'],
        composeWindowMs: 0,
        maxBatchSize: 32,
        deadlineMs: 10_000,
        ...extra
      };
    }
  };
}

export function patchLine(targetFile: string, index: number, next: string): string {
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

export function assertClean(filePath: string, label: string): string {
  const text = readFileSync(filePath, 'utf8');
  if (text.includes('<<<<<<<') || text.includes('>>>>>>>') || text.includes('=======')) {
    throw new Error(`COUNTEREXAMPLE corruption at ${label}: ${filePath}`);
  }
  return text;
}

export function assertCommittedBytes(receipt: SharedComposeReceipt, filePath: string): void {
  if (receipt.terminal !== 'committed') return;
  const text = assertClean(filePath, receipt.proposalId);
  assert.equal(hashComposeBytes(text), receipt.resultHash, `COUNTEREXAMPLE lost-effect ${receipt.proposalId}`);
}

export interface WorkerJob {
  inboxDir: string;
  targetPath: string;
  targetFile: string;
  proposalId: string;
  actorId: string;
  taskId: string;
  baseHash: string;
  baseBytes: string;
  patch: string;
  scope: string | null;
  ticket: string | null;
  validators: string[];
  composeWindowMs: number;
  maxBatchSize: number;
  deadlineMs: number;
  barrierDir: string | null;
  barrierCount: number;
  staggerMs: number;
  crashOnFlag: boolean;
}

export function workerJob(scene: Scene, proposalId: string, patch: string, extra: Partial<WorkerJob> & { composeWindowMs: number; maxBatchSize: number; barrierDir: string | null }): WorkerJob {
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
    scope: `scope-${proposalId}`,
    ticket: `ticket-${proposalId}`,
    validators: ['validator-noop'],
    deadlineMs: 15_000,
    barrierCount: 2,
    staggerMs: 0,
    crashOnFlag: false,
    ...extra
  };
}

export async function runJobs(jobs: WorkerJob[], options?: { allowExit?: Set<number> }): Promise<{ status: number; receipt: SharedComposeReceipt }[]> {
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

export async function submit(input: SubmitSharedComposeInput): Promise<SharedComposeReceipt> {
  return submitSharedComposeProposal(input);
}
