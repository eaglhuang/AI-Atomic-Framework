// Child-process writer for the shared compose inbox tests.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { submitSharedComposeProposal } from '../shared-compose-inbox.ts';
import type { WorkerJob } from './shared-compose-inbox.fixture.ts';

const jobPath = process.argv[2];
if (jobPath) {
  const job = JSON.parse(readFileSync(jobPath, 'utf8')) as WorkerJob;
  try {
    if (job.barrierDir) waitBarrier(job.barrierDir, job.barrierCount, job.proposalId);
    if (job.staggerMs > 0) waitMs(job.staggerMs);
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
      scope: job.scope,
      ticket: job.ticket,
      validators: job.validators,
      composeWindowMs: job.composeWindowMs,
      maxBatchSize: job.maxBatchSize,
      deadlineMs: job.deadlineMs,
      onBeforeCommit: job.crashOnFlag ? () => crashIfFlagged(job.inboxDir) : undefined
    });
    writeFileSync(`${jobPath}.result.json`, JSON.stringify({ ok: true, receipt }));
  } catch (error) {
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    writeFileSync(`${jobPath}.result.json`, JSON.stringify({ ok: false, detail }));
    process.exitCode = 1;
  }
}

function crashIfFlagged(inboxDir: string): void {
  const flag = path.join(inboxDir, 'crash-once');
  if (!existsSync(flag)) return;
  rmSync(flag, { force: true });
  process.exit(99);
}

function waitBarrier(dir: string, count: number, id: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `ready-${id}`), 'ready');
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    const ready = readdirSync(dir).filter((name) => name.startsWith('ready-')).length;
    if (ready >= count) return;
    waitMs(10);
  }
  throw new Error(`barrier timeout for ${id}`);
}

function waitMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
