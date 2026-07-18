import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { closeTransactionMutexPath } from '../../packages/cli/src/commands/taskflow/close-transaction-mutex.ts';

const repoRoot = mkdtempSync(path.join(os.tmpdir(), 'atm-close-mutex-concurrent-'));
const workerPath = path.join(repoRoot, 'mutex-worker.mjs');
const startPath = path.join(repoRoot, 'start');
const mutexModuleUrl = pathToFileURL(path.join(process.cwd(), 'packages/cli/src/commands/taskflow/close-transaction-mutex.ts')).href;

writeFileSync(workerPath, `
  import { existsSync, writeFileSync } from 'node:fs';
  import { setTimeout as sleep } from 'node:timers/promises';
  import { acquireCloseTransactionMutex, releaseCloseTransactionMutex } from '${mutexModuleUrl}';

  const [repoRoot, taskId, actorId, startPath] = process.argv.slice(2);
  writeFileSync(repoRoot + '/' + actorId + '.ready', 'ready\\n', 'utf8');
  while (!existsSync(startPath)) await sleep(5);
  try {
    const lease = acquireCloseTransactionMutex({ repoRoot, taskId, actorId, ttlMs: 1000 });
    await sleep(250);
    releaseCloseTransactionMutex(lease);
    console.log(JSON.stringify({ actorId, status: 'acquired' }));
  } catch (error) {
    console.log(JSON.stringify({ actorId, status: 'blocked', message: error instanceof Error ? error.message : String(error) }));
  }
`, 'utf8');

function runWorker(actorId: string) {
  return spawn(process.execPath, ['--strip-types', workerPath, repoRoot, 'TASK-CLOSE-MUTEX', actorId, startPath], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

function waitForExit(child: ReturnType<typeof runWorker>): Promise<{ status: number | null; stdout: string; stderr: string; }> {
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += String(chunk); });
  child.stderr.on('data', (chunk) => { stderr += String(chunk); });
  return new Promise((resolve) => {
    child.on('exit', (status) => resolve({ status, stdout, stderr }));
  });
}

try {
  const first = runWorker('captain-a');
  const second = runWorker('captain-b');
  const firstDone = waitForExit(first);
  const secondDone = waitForExit(second);

  const readyDeadline = Date.now() + 5000;
  while ((!existsSync(path.join(repoRoot, 'captain-a.ready')) || !existsSync(path.join(repoRoot, 'captain-b.ready'))) && Date.now() < readyDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(existsSync(path.join(repoRoot, 'captain-a.ready')), true);
  assert.equal(existsSync(path.join(repoRoot, 'captain-b.ready')), true);

  writeFileSync(startPath, 'go\n', 'utf8');
  const results = await Promise.all([firstDone, secondDone]);
  assert.deepEqual(results.map((result) => result.status), [0, 0]);

  const payloads = results.map((result) => JSON.parse(result.stdout.trim()));
  assert.equal(payloads.filter((payload) => payload.status === 'acquired').length, 1, 'only one Captain may acquire the close mutex');
  assert.equal(payloads.filter((payload) => payload.status === 'blocked').length, 1, 'the competing Captain must be blocked');
  assert.match(payloads.find((payload) => payload.status === 'blocked')?.message ?? '', /already held/);
  assert.equal(existsSync(closeTransactionMutexPath(repoRoot, 'TASK-CLOSE-MUTEX')), false, 'winning Captain must release the mutex');

  const expiredPath = closeTransactionMutexPath(repoRoot, 'TASK-CLOSE-MUTEX-EXPIRED');
  mkdirSync(path.dirname(expiredPath), { recursive: true });
  writeFileSync(expiredPath, `${JSON.stringify({
    schemaId: 'atm.closeTransactionMutexLease.v1',
    taskId: 'TASK-CLOSE-MUTEX-EXPIRED',
    actorId: 'expired-captain',
    leaseId: 'expired-lease',
    acquiredAt: '2026-07-16T00:00:00.000Z',
    expiresAt: '2026-07-16T00:00:01.000Z',
    ttlMs: 1000,
    ttlReason: 'test fixture',
    lockPath: expiredPath
  }, null, 2)}\n`, 'utf8');
  const reclaim = spawn(process.execPath, ['--strip-types', workerPath, repoRoot, 'TASK-CLOSE-MUTEX-EXPIRED', 'captain-c', startPath], {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const reclaimDone = await waitForExit(reclaim);
  const reclaimPayload = JSON.parse(reclaimDone.stdout.trim());
  assert.equal(reclaimPayload.status, 'acquired', 'expired close mutex must be reclaimable by the next Captain');

  console.log('[close-commit-window-mutex.test] ok');
} finally {
  rmSync(repoRoot, { recursive: true, force: true });
}
