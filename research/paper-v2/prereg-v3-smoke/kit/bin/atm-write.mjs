#!/usr/bin/env node
/**
 * prereg-v3 smoke writer.
 *
 * Calls the current-main steward pathway:
 *   1. submitSharedComposeProposal  (proposal + compose window)
 *   2. composeBatch / commitComposed inside that call
 *      (base-hash compare, atomic temp write, rename)
 *   3. runSharedDeliveryCommitTransaction
 *      (admit, seal, commit-tree, update-ref CAS)
 *
 * npm @ai-atomic-framework/cli@0.1.20 exposes `broker steward plan|apply`
 * and `broker proposal` / `broker compose`, but those require a prebuilt
 * merge-plan file and do not batch two live unified diffs. `shared-compose`
 * is not a 0.1.20 CLI surface. This wrapper is the smoke entry point.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (process.env.PREREG_UNSHIMMED_PATH) process.env.PATH = process.env.PREREG_UNSHIMMED_PATH;
const GIT = process.env.PREREG_REAL_GIT || '/usr/bin/git';
const here = path.dirname(fileURLToPath(import.meta.url));
const frameworkRoot = process.env.ATM_FRAMEWORK_ROOT
  ? path.resolve(process.env.ATM_FRAMEWORK_ROOT)
  : path.resolve(here, '../../../../..');

const composeModule = pathToFileURL(path.join(frameworkRoot, 'packages/core/src/broker/shared-compose-inbox.ts')).href;
const deliveryModule = pathToFileURL(path.join(frameworkRoot, 'packages/cli/src/commands/broker/shared-delivery-commit-transaction.ts')).href;

const { submitSharedComposeProposal, hashComposeBytes } = await import(composeModule);
const { runSharedDeliveryCommitTransaction } = await import(deliveryModule);

function fail(code, message, extra = {}) {
  const payload = { ok: false, code, message, ...extra };
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  process.exit(code === 'rejected' ? 3 : 1);
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1 || index + 1 >= process.argv.length) return null;
  return process.argv[index + 1];
}

const positionals = [];
for (let i = 2; i < process.argv.length; i += 1) {
  const token = process.argv[i];
  if (token.startsWith('--')) {
    i += 1;
    continue;
  }
  positionals.push(token);
}

const fileArg = positionals[0];
const patchArg = positionals[1];
if (!fileArg || !patchArg) {
  fail('usage', 'usage: atm-write <file> <patch> [--base-file path] [--actor id] [--task id] [--message text]');
}

const cwd = path.resolve(process.env.ATM_CWD || argValue('--cwd') || process.cwd());
const relativeFile = fileArg.replace(/\\/g, '/').replace(/^\.\//, '');
const targetPath = path.resolve(cwd, relativeFile);
const actorId = argValue('--actor') || process.env.ATM_ACTOR || 'prereg-session';
const taskId = argValue('--task') || process.env.ATM_TASK || `prereg-${actorId}`;
const message = argValue('--message') || `prereg-v3-smoke: ${taskId} ${relativeFile}`;
const baseFile = argValue('--base-file');
const composeWindowMs = Number(process.env.ATM_COMPOSE_WINDOW_MS || 4000);
const inboxDir = path.join(cwd, '.atm', 'runtime', 'shared-compose-inbox');
const logPath = process.env.ATM_WRITE_LOG || path.join(cwd, '.prereg-smoke', 'steward-writes.jsonl');

const patch = patchArg === '-' ? readFileSync(0, 'utf8') : readFileSync(path.resolve(patchArg), 'utf8');
if (!patch.includes('@@')) fail('patch', 'patch is not a unified diff', { file: relativeFile });

let baseBytes;
try {
  baseBytes = baseFile ? readFileSync(path.resolve(baseFile), 'utf8') : readFileSync(targetPath, 'utf8');
} catch (error) {
  fail('base', `cannot read base for ${relativeFile}: ${error.message}`);
}

const proposalId = `prop-${actorId}-${createHash('sha256').update(`${relativeFile}\n${patch}`).digest('hex').slice(0, 12)}`;
const tProposal = Date.now();
mkdirSync(path.dirname(logPath), { recursive: true });
mkdirSync(inboxDir, { recursive: true });

let receipt;
try {
  receipt = await submitSharedComposeProposal({
    inboxDir,
    targetPath,
    targetFile: relativeFile,
    proposalId,
    taskId,
    actorId,
    baseHash: hashComposeBytes(baseBytes),
    baseBytes,
    patch,
    scope: relativeFile,
    ticket: proposalId,
    validators: ['prereg-v3-smoke'],
    composeWindowMs,
    maxBatchSize: 8,
    deadlineMs: Number(process.env.ATM_COMPOSE_DEADLINE_MS || 60000)
  });
} catch (error) {
  fail('proposal', error instanceof Error ? error.message : String(error), { proposalId });
}

const tWriteDone = Date.now();
const rejected = receipt.terminal !== 'committed';
if (rejected) {
  const record = recordLine({
    ok: false,
    phase: 'compose',
    terminal: receipt.terminal,
    stopReason: receipt.stopReason,
    tProposal,
    tWriteDone,
    tCommitPublished: null,
    writeToCommitMs: null
  });
  process.stdout.write(`${JSON.stringify(record)}\n`);
  process.exit(3);
}

const commit = publishGitCommit({
  cwd,
  relativeFile,
  actorId,
  taskId,
  message,
  receipt
});
const tCommitPublished = Date.now();
const record = recordLine({
  ok: commit.ok,
  phase: 'commit',
  terminal: receipt.terminal,
  stopReason: receipt.stopReason,
  tProposal,
  tWriteDone,
  tCommitPublished: commit.ok ? tCommitPublished : null,
  writeToCommitMs: commit.ok ? tCommitPublished - tWriteDone : null,
  commit
});
process.stdout.write(`${JSON.stringify(record)}\n`);
process.exit(commit.ok ? 0 : 1);

function recordLine(fields) {
  const record = {
    schema: 'prereg-v3-smoke.stewardWrite.v1',
    proposalId,
    taskId,
    actorId,
    file: relativeFile,
    declaredBaseHash: receipt.declaredBaseHash,
    resultHash: receipt.resultHash,
    batchId: receipt.batchId,
    batchSize: receipt.batchSize,
    memberProposalIds: receipt.memberProposalIds,
    acceptedSetKey: receipt.acceptedSetKey,
    late: receipt.late,
    attemptCount: receipt.attemptCount,
    retryCount: receipt.retryCount,
    hashDriftCount: receipt.hashDriftCount,
    renameCount: receipt.renameCount,
    composeVerdict: receipt.composeVerdict,
    detail: receipt.detail,
    stagesReached: receipt.stagesReached,
    elapsedMs: receipt.elapsedMs,
    ...fields
  };
  appendFileSync(logPath, `${JSON.stringify(record)}\n`);
  return record;
}

function publishGitCommit(input) {
  const lockDir = path.join(input.cwd, '.atm', 'runtime', 'prereg-git-commit.lock');
  mkdirSync(path.dirname(lockDir), { recursive: true });
  const waited = acquireDirLock(lockDir, 30000);
  try {
    return commitUnderLock(input, waited);
  } finally {
    try { spawnSync('rmdir', [lockDir]); } catch { /* already gone */ }
  }
}

function commitUnderLock(input, gitIndexLockWaitMs) {
  let headMoves = 0;
  let indexLockRetries = 0;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const staged = gitAddWithRetry(input.cwd, input.relativeFile);
    indexLockRetries += staged.retries;
    if (!staged.ok) {
      return { ok: false, reason: 'git-add-failed', stderr: staged.stderr, headMoves, indexLockRetries, gitIndexLockWaitMs };
    }
    const head = git(input.cwd, ['rev-parse', 'HEAD']).stdout.trim();
    const stagedDiff = git(input.cwd, ['diff', '--cached', '--name-only', '--', input.relativeFile]).stdout.trim();
    if (!stagedDiff) {
      const headFile = git(input.cwd, ['show', `HEAD:${input.relativeFile}`]);
      if (headFile.status === 0 && hashComposeBytes(headFile.stdout) === input.receipt.resultHash) {
        return {
          ok: true,
          reason: 'already-published',
          commitSha: head,
          headMoves,
          indexLockRetries,
          gitIndexLockWaitMs,
          note: 'composed bytes were already in HEAD; no second tree change'
        };
      }
    }
    const now = new Date().toISOString();
    const waveId = `prereg-smoke-${input.taskId}`;
    const surfaceFamily = 'prereg-v3-smoke';
    const ticket = {
      schemaId: 'atm.waveBrokerTicket.v1',
      ticketId: `ticket-${input.receipt.proposalId}`,
      idempotencyKey: `${input.receipt.proposalId}:${head}`,
      waveId,
      taskId: input.taskId,
      surfaceKind: 'commit',
      surfaceFamily,
      payloadDigest: input.receipt.resultHash || 'pending',
      state: 'batched',
      enqueuedAt: now,
      updatedAt: now
    };
    const decision = {
      schemaId: 'atm.waveBrokerBatchDecision.v1',
      verdict: 'batch-ready',
      waveId,
      surfaceFamily,
      surfaceKind: 'commit',
      ticketIds: [ticket.ticketId],
      missingTaskIds: [],
      waitedMs: 0,
      reason: 'prereg-v3 smoke commit after steward compose'
    };
    const scheduler = {
      schemaId: 'atm.waveBrokerScheduler.v1',
      specVersion: '0.1.0',
      tickets: [ticket],
      updatedAt: now
    };
    const tempIndex = path.join(input.cwd, '.atm', 'runtime', 'prereg-delivery-index', `${input.actorId}-${attempt}`);
    mkdirSync(tempIndex, { recursive: true });
    try {
      const transaction = runSharedDeliveryCommitTransaction({
        cwd: input.cwd,
        apply: true,
        actorId: input.actorId,
        taskIds: [input.taskId],
        expectedHeadSha: head,
        payloadFiles: [input.relativeFile],
        planInput: {
          decision,
          scheduler,
          actorId: input.actorId,
          manifestDigest: `sha256:${createHash('sha256').update(input.receipt.resultHash || proposalId).digest('hex')}`,
          sealedBaseSha: head,
          currentHeadSha: head,
          expectedHeadSha: head,
          claimedTaskIds: [input.taskId],
          validatorTaskIds: [input.taskId],
          stagedFiles: [input.relativeFile],
          fileSlices: { [input.taskId]: [input.relativeFile] },
          temporaryIndexPath: tempIndex,
          provenance: null,
          now
        }
      });
      if (!transaction.admissionPlan.ok) {
        return {
          ok: false,
          reason: 'admission-blocked',
          blockers: transaction.admissionPlan.blockers,
          headMoves,
          indexLockRetries,
          gitIndexLockWaitMs
        };
      }
      if (transaction.applied?.commitSha) {
        return {
          ok: true,
          reason: 'committed',
          commitSha: transaction.applied.commitSha,
          planVerdict: transaction.plan.verdict,
          planOk: transaction.plan.ok,
          headMoves,
          indexLockRetries,
          gitIndexLockWaitMs
        };
      }
      return { ok: false, reason: 'no-commit-sha', plan: transaction.plan.reason, headMoves, indexLockRetries, gitIndexLockWaitMs };
    } catch (error) {
      const text = error instanceof Error ? `${error.code || ''} ${error.message}` : String(error);
      if (text.includes('ATM_BROKER_BATCH_COMMIT_HEAD_MOVED') || text.includes('HEAD moved')) {
        headMoves += 1;
        continue;
      }
      if (text.includes('no tree changes')) {
        const headNow = git(input.cwd, ['rev-parse', 'HEAD']).stdout.trim();
        return { ok: true, reason: 'already-published', commitSha: headNow, headMoves, indexLockRetries, gitIndexLockWaitMs };
      }
      return { ok: false, reason: 'commit-threw', message: text, headMoves, indexLockRetries, gitIndexLockWaitMs };
    }
  }
  return { ok: false, reason: 'head-moved-exhausted', headMoves, indexLockRetries, gitIndexLockWaitMs };
}

function gitAddWithRetry(repo, relativeFile) {
  let retries = 0;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const result = git(repo, ['add', '--', relativeFile]);
    if (result.status === 0) return { ok: true, retries };
    const stderr = `${result.stderr || ''}`;
    if (stderr.includes('index.lock')) {
      retries += 1;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50 * attempt);
      continue;
    }
    return { ok: false, retries, stderr };
  }
  return { ok: false, retries, stderr: 'index.lock retries exhausted' };
}

function git(repo, args) {
  return spawnSync(GIT, args, { cwd: repo, encoding: 'utf8' });
}

function acquireDirLock(lockDir, timeoutMs) {
  const started = Date.now();
  while (true) {
    const result = spawnSync('mkdir', [lockDir], { encoding: 'utf8' });
    if (result.status === 0) return Date.now() - started;
    if (Date.now() - started > timeoutMs) fail('lock', `timed out waiting for ${lockDir}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
}
