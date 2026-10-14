// One ATM arm writer. It only submits into the shared compose inbox.
import { mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  registerSharedComposeEntryPoint,
  stopSharedComposeEntryPoint,
  submitSharedComposeProposal
} from '../../../../../packages/core/src/broker/shared-compose-inbox.ts';

interface AtmJob {
  workspace: string;
  inboxDir: string;
  targetPath: string;
  targetFile: string;
  proposalId: string;
  actorId: string;
  taskId: string;
  baseHash: string;
  baseBytes: string;
  patch: string;
  peers: number;
  orderIndex: number;
  interArrivalMs: number;
  composeWindowMs: number;
  maxBatchSize: number;
  deadlineMs: number;
  operation: string;
  renameTo: string | null;
}

const job = JSON.parse(readFileSync(process.argv[2], 'utf8')) as AtmJob;
const entryPointId = `ep-${job.proposalId}`;

try {
  waitBarrier(path.join(job.workspace, 'barrier'), job.proposalId, job.peers);
  if (job.interArrivalMs > 0 && job.orderIndex > 0) {
    await delay(job.orderIndex * job.interArrivalMs);
  }
  registerSharedComposeEntryPoint(job.inboxDir, entryPointId, process.pid);
  const receipt = await submitSharedComposeProposal({
    inboxDir: job.inboxDir,
    targetPath: job.targetPath,
    targetFile: job.targetFile,
    proposalId: job.proposalId,
    actorId: job.actorId,
    taskId: job.taskId,
    baseHash: job.baseHash,
    baseBytes: job.baseBytes,
    patch: job.patch,
    scope: `scope-${job.proposalId}`,
    ticket: `ticket-${job.proposalId}`,
    validators: ['hist-v2-harness-v2'],
    composeWindowMs: job.composeWindowMs,
    maxBatchSize: job.maxBatchSize,
    deadlineMs: job.deadlineMs
  });
  if (job.operation === 'rename' && job.renameTo && receipt.terminal === 'committed') {
    renameSync(job.targetPath, path.join(job.workspace, job.renameTo));
  }
  writeFileSync(`${process.argv[2]}.result.json`, JSON.stringify({ ok: true, receipt }));
} catch (error) {
  const detail = error instanceof Error ? error.stack ?? error.message : String(error);
  writeFileSync(`${process.argv[2]}.result.json`, JSON.stringify({ ok: false, detail }));
  process.exitCode = 1;
} finally {
  try {
    stopSharedComposeEntryPoint(job.inboxDir, entryPointId, Date.now());
  } catch {
    // The inbox may not exist when submit fails before registration.
  }
}

function waitBarrier(dir: string, proposalId: string, peers: number): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `ready-${proposalId}`), 'ready\n');
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    const ready = readdirSync(dir).filter((name) => name.startsWith('ready-')).length;
    if (ready >= peers) return;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  throw new Error(`barrier timeout for ${proposalId}`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
