import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CliError, makeResult, message } from '../shared.ts';
import { planWaveBrokerBatch } from '../../../../core/src/broker/wave-broker-scheduler.ts';
import { planSharedDeliveryCommit } from '../../../../core/src/broker/shared-delivery-commit.ts';
import type { ParsedBrokerOptions } from './parser.ts';
import type { BrokerCommandContext } from './types.ts';

function readJson(pathName: string) {
  if (!existsSync(pathName)) {
    throw new CliError('ATM_BROKER_SCHEDULER_MISSING', `Wave broker scheduler document does not exist: ${pathName}`, { exitCode: 2 });
  }
  return JSON.parse(readFileSync(pathName, 'utf8'));
}

function currentHead(cwd: string): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new CliError('ATM_BROKER_BATCH_HEAD_UNAVAILABLE', 'Unable to resolve current HEAD for shared delivery commit executor.', {
      exitCode: 2,
      details: { stderr: result.stderr }
    });
  }
  return result.stdout.trim();
}

function parseFileSlices(entries: readonly string[], fallbackTasks: readonly string[], fallbackFiles: readonly string[]) {
  const slices: Record<string, string[]> = {};
  for (const entry of entries) {
    const separator = entry.indexOf(':');
    if (separator <= 0) {
      throw new CliError('ATM_CLI_USAGE', '--file-slice must use TASK-ID:path/to/file format.', { exitCode: 2 });
    }
    const taskId = entry.slice(0, separator).trim();
    const filePath = entry.slice(separator + 1).trim();
    if (!taskId || !filePath) {
      throw new CliError('ATM_CLI_USAGE', '--file-slice must include both task id and file path.', { exitCode: 2 });
    }
    slices[taskId] = [...(slices[taskId] ?? []), filePath];
  }
  if (Object.keys(slices).length === 0) {
    for (const taskId of fallbackTasks) slices[taskId] = [...fallbackFiles];
  }
  return slices;
}

function writeReceipt(cwd: string, outPath: string, value: unknown): string {
  const absolute = path.resolve(cwd, outPath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  return path.relative(cwd, absolute).replace(/\\/g, '/');
}

export function handleBrokerBatchExecute(options: ParsedBrokerOptions, context: BrokerCommandContext) {
  if (options.action !== 'batch') return null;
  if (options.batchAction !== 'execute') {
    throw new CliError('ATM_CLI_USAGE', 'broker batch supports execute.', { exitCode: 2 });
  }
  if (!options.surfaces.includes('commit')) {
    throw new CliError('ATM_CLI_USAGE', 'broker batch execute currently requires --surface commit.', { exitCode: 2 });
  }
  if (!options.actorId || !options.waveId || !options.surfaceFamily || !options.manifestDigest || !options.sealedSourceSha) {
    throw new CliError('ATM_CLI_USAGE', 'broker batch execute --surface commit requires --actor, --wave, --surface-family, --manifest-digest, and --sealed-source-sha.', { exitCode: 2 });
  }

  const scheduler = readJson(context.waveSchedulerPath);
  const decision = planWaveBrokerBatch({
    document: scheduler,
    waveId: options.waveId,
    surfaceKind: 'commit',
    surfaceFamily: options.surfaceFamily,
    expectedTaskIds: options.expectedTasks,
    collectionTimeoutMs: options.collectionTimeoutMs
  });
  const taskIds = scheduler.tickets
    .filter((ticket: { ticketId: string }) => decision.ticketIds.includes(ticket.ticketId))
    .map((ticket: { taskId: string }) => ticket.taskId);
  const tempIndexDir = mkdtempSync(path.join(tmpdir(), 'atm-shared-delivery-index-'));
  const temporaryIndexPath = path.join(tempIndexDir, 'index');
  const stagedFiles = options.scopeFiles.length > 0 ? options.scopeFiles : [];
  const plan = planSharedDeliveryCommit({
    decision,
    scheduler,
    actorId: options.actorId,
    manifestDigest: options.manifestDigest,
    sealedBaseSha: options.sealedSourceSha,
    currentHeadSha: options.currentHeadSha ?? currentHead(options.cwd),
    expectedHeadSha: options.expectedHeadSha,
    claimedTaskIds: options.claimedTasks.length > 0 ? options.claimedTasks : taskIds,
    validatorTaskIds: options.validatorTasks,
    stagedFiles,
    fileSlices: parseFileSlices(options.fileSlices, taskIds, stagedFiles),
    temporaryIndexPath
  });
  const receiptPath = options.evidenceOutPath && plan.receipt
    ? writeReceipt(options.cwd, options.evidenceOutPath, plan.receipt)
    : null;
  return makeResult({
    ok: plan.ok,
    command: 'broker',
    cwd: options.cwd,
    messages: [
      message(plan.ok ? 'info' : 'error', plan.ok ? 'ATM_BROKER_BATCH_COMMIT_RECEIPT_READY' : 'ATM_BROKER_BATCH_COMMIT_BLOCKED', plan.reason, {
        receiptPath,
        blockers: plan.blockers
      })
    ],
    evidence: {
      action: 'broker-batch-execute',
      surface: 'commit',
      schedulerPath: '.atm/runtime/wave-broker-scheduler.json',
      decision,
      plan,
      receiptPath,
      temporaryIndexPath
    }
  });
}
