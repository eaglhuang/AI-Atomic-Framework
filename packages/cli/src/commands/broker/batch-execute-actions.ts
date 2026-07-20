import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CliError, makeResult, message } from '../shared.ts';
import { planWaveBrokerBatch } from '../../../../core/src/broker/wave-broker-scheduler.ts';
import { planSharedDeliveryCommit } from '../../../../core/src/broker/shared-delivery-commit.ts';
import { planSharedDeliverySaga } from '../../../../core/src/broker/shared-delivery-saga.ts';
import { planWaveGeneratedWrite, type WaveGeneratedSurfaceKind } from '../../../../core/src/broker/wave-generated-executor.ts';
import { assertRecordCommitPayloadPresent } from '../git-governance/record-commit-payload-assertion.ts';
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

function runGit(cwd: string, args: readonly string[], env: Record<string, string | undefined> = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  if (result.status !== 0) {
    throw new CliError('ATM_BROKER_BATCH_COMMIT_BLOCKED', `git ${args.join(' ')} failed while executing shared delivery commit.`, {
      exitCode: 1,
      details: { args, stdout: result.stdout, stderr: result.stderr }
    });
  }
  return result.stdout.trim();
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.replace(/\\/g, '/').replace(/^\.\//, '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function executeTemporaryIndexCommit(input: {
  readonly cwd: string;
  readonly actorId: string;
  readonly taskIds: readonly string[];
  readonly expectedHeadSha: string;
  readonly temporaryIndexPath: string;
  readonly files: readonly string[];
}) {
  const files = uniqueSorted(input.files);
  if (files.length === 0) {
    throw new CliError('ATM_BROKER_BATCH_COMMIT_BLOCKED', 'Shared delivery commit apply requires at least one payload file.', {
      exitCode: 1,
      details: { taskIds: input.taskIds }
    });
  }
  const env = { GIT_INDEX_FILE: input.temporaryIndexPath };
  runGit(input.cwd, ['read-tree', input.expectedHeadSha], env);
  runGit(input.cwd, ['add', '-A', '-f', '--', ...files], env);
  const treeSha = runGit(input.cwd, ['write-tree'], env);
  const headTreeSha = runGit(input.cwd, ['rev-parse', `${input.expectedHeadSha}^{tree}`]);
  if (treeSha === headTreeSha) {
    throw new CliError('ATM_BROKER_BATCH_COMMIT_BLOCKED', 'Shared delivery commit payload produced no tree changes.', {
      exitCode: 1,
      details: { taskIds: input.taskIds, files }
    });
  }
  const commitSha = runGit(input.cwd, [
    'commit-tree',
    treeSha,
    '-p',
    input.expectedHeadSha,
    '-m',
    `shared-delivery: commit ${input.taskIds.join(', ')}`
  ], {
    ...env,
    GIT_AUTHOR_NAME: input.actorId,
    GIT_AUTHOR_EMAIL: `${input.actorId}@atm.local`,
    GIT_COMMITTER_NAME: input.actorId,
    GIT_COMMITTER_EMAIL: `${input.actorId}@atm.local`
  });
  runGit(input.cwd, ['update-ref', 'HEAD', commitSha, input.expectedHeadSha]);
  return {
    commitSha,
    payloadAssertion: assertRecordCommitPayloadPresent({
      cwd: input.cwd,
      commitSha,
      expectedStagedFiles: files
    })
  };
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

function digestOutputFiles(cwd: string, files: readonly string[]): string {
  const normalized = uniqueSorted(files);
  const hash = createHash('sha256');
  for (const relative of normalized) {
    const absolute = path.resolve(cwd, relative);
    if (!existsSync(absolute)) {
      throw new CliError('ATM_BROKER_BATCH_GENERATED_BLOCKED', `generated output file does not exist: ${relative}`, { exitCode: 1 });
    }
    const stat = statSync(absolute);
    if (stat.isDirectory()) {
      throw new CliError('ATM_BROKER_BATCH_GENERATED_BLOCKED', `generated output path is a directory; pass concrete --output-file entries: ${relative}`, { exitCode: 1 });
    }
    hash.update(relative);
    hash.update('\0');
    hash.update(readFileSync(absolute));
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

function timeOutputDigest(cwd: string, files: readonly string[]) {
  const started = Date.now();
  const digest = digestOutputFiles(cwd, files);
  return { digest, durationMs: Date.now() - started };
}

function runGeneratedCommand(cwd: string, command: string) {
  const started = Date.now();
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const durationMs = Date.now() - started;
  if ((result.status ?? 1) !== 0) {
    throw new CliError('ATM_BROKER_BATCH_GENERATED_BLOCKED', `generated write command failed: ${command}`, {
      exitCode: 1,
      details: { command, exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr, durationMs }
    });
  }
  return { exitCode: result.status ?? 0, stdout: result.stdout, stderr: result.stderr, durationMs };
}

export function handleBrokerBatchExecute(options: ParsedBrokerOptions, context: BrokerCommandContext) {
  if (options.action !== 'batch') return null;
  if (options.batchAction !== 'execute') {
    throw new CliError('ATM_CLI_USAGE', 'broker batch supports execute.', { exitCode: 2 });
  }
  const selectedSurface = options.surfaces.find((surface) => ['commit', 'build', 'projection'].includes(surface));
  if (!selectedSurface) {
    throw new CliError('ATM_CLI_USAGE', 'broker batch execute requires --surface commit, --surface build, or --surface projection.', { exitCode: 2 });
  }
  if (!options.actorId || !options.waveId || !options.surfaceFamily || !options.manifestDigest || !options.sealedSourceSha) {
    throw new CliError('ATM_CLI_USAGE', 'broker batch execute requires --actor, --wave, --surface-family, --manifest-digest, and --sealed-source-sha.', { exitCode: 2 });
  }

  const scheduler = readJson(context.waveSchedulerPath);
  if (selectedSurface === 'build' || selectedSurface === 'projection') {
    if (!options.payloadDigest) {
      throw new CliError('ATM_CLI_USAGE', 'broker batch execute --surface build|projection requires --payload-digest <source-digest>.', { exitCode: 2 });
    }
    if (options.apply && !options.runCommand && !options.receiptDigest) {
      throw new CliError('ATM_CLI_USAGE', 'broker batch execute --surface build|projection --apply requires --run-command or --receipt-digest.', { exitCode: 2 });
    }
    if (options.runCommand && options.outputFiles.length === 0) {
      throw new CliError('ATM_CLI_USAGE', 'broker batch execute --run-command requires at least one --output-file so ATM can observe the output digest.', { exitCode: 2 });
    }
    const surfaceKind = selectedSurface as WaveGeneratedSurfaceKind;
    const commandRun = options.apply && options.runCommand
      ? runGeneratedCommand(options.cwd, options.runCommand)
      : null;
    const outputDigestMeasurement = options.runCommand
      ? timeOutputDigest(options.cwd, options.outputFiles)
      : null;
    const observedOutputDigest = outputDigestMeasurement?.digest ?? options.receiptDigest;
    if (!observedOutputDigest) {
      throw new CliError('ATM_CLI_USAGE', 'broker batch execute --surface build|projection requires --receipt-digest when no --run-command is provided.', { exitCode: 2 });
    }
    const decision = planWaveBrokerBatch({
      document: scheduler,
      waveId: options.waveId,
      surfaceKind,
      surfaceFamily: options.surfaceFamily,
      expectedTaskIds: options.expectedTasks,
      collectionTimeoutMs: options.collectionTimeoutMs
    });
    const plan = planWaveGeneratedWrite({
      decision,
      scheduler,
      actorId: options.actorId,
      surfaceKind,
      surfaceFamily: options.surfaceFamily,
      manifestDigest: options.manifestDigest,
      sealedSourceSha: options.sealedSourceSha,
      sourceDigest: options.payloadDigest,
      outputDigest: observedOutputDigest,
      command: commandRun ? options.runCommand : null,
      commandExitCode: commandRun?.exitCode ?? null,
      commandDurationMs: commandRun?.durationMs ?? null,
      phaseTimingsMs: commandRun ? {
        command: commandRun.durationMs,
        outputDigestCalculation: outputDigestMeasurement?.durationMs ?? 0,
        totalElapsed: commandRun.durationMs + (outputDigestMeasurement?.durationMs ?? 0)
      } : null,
      observedOutputFiles: options.runCommand ? options.outputFiles : [],
      expectedTaskIds: options.expectedTasks
    });
    const receiptPath = options.evidenceOutPath && plan.receipt
      ? writeReceipt(options.cwd, options.evidenceOutPath, plan.receipt)
      : null;
    return makeResult({
      ok: plan.ok,
      command: 'broker',
      cwd: options.cwd,
      messages: [
        message(plan.ok ? 'info' : 'error', plan.ok ? 'ATM_BROKER_BATCH_GENERATED_RECEIPT_READY' : 'ATM_BROKER_BATCH_GENERATED_BLOCKED', plan.reason, {
          receiptPath,
          blockers: plan.blockers
        })
      ],
      evidence: {
        action: 'broker-batch-execute',
        surface: surfaceKind,
        schedulerPath: '.atm/runtime/wave-broker-scheduler.json',
        decision,
        plan,
        receiptPath
      }
    });
  }

  const decision = planWaveBrokerBatch({
    document: scheduler,
    waveId: options.waveId,
    surfaceKind: 'commit',
    surfaceFamily: options.surfaceFamily,
    expectedTaskIds: options.expectedTasks,
    collectionTimeoutMs: options.collectionTimeoutMs
  });
  const taskIds: string[] = scheduler.tickets
    .filter((ticket: { ticketId: string }) => decision.ticketIds.includes(ticket.ticketId))
    .map((ticket: { taskId: string }) => ticket.taskId);
  const tempIndexDir = mkdtempSync(path.join(tmpdir(), 'atm-shared-delivery-index-'));
  const temporaryIndexPath = path.join(tempIndexDir, 'index');
  const stagedFiles = options.scopeFiles.length > 0 ? options.scopeFiles : [];
  const fileSlices = parseFileSlices(options.fileSlices, taskIds, stagedFiles);
  const payloadFiles = uniqueSorted(Object.values(fileSlices).flat());
  const expectedHead = options.expectedHeadSha ?? options.currentHeadSha ?? currentHead(options.cwd);
  const applied = options.apply
    ? executeTemporaryIndexCommit({
      cwd: options.cwd,
      actorId: options.actorId,
      taskIds,
      expectedHeadSha: expectedHead,
      temporaryIndexPath,
      files: payloadFiles
    })
    : null;
  const plan = planSharedDeliveryCommit({
    decision,
    scheduler,
    actorId: options.actorId,
    manifestDigest: options.manifestDigest,
    sealedBaseSha: options.sealedSourceSha,
    currentHeadSha: applied?.commitSha ?? options.currentHeadSha ?? currentHead(options.cwd),
    expectedHeadSha: applied ? null : options.expectedHeadSha,
    claimedTaskIds: options.claimedTasks.length > 0 ? options.claimedTasks : taskIds,
    validatorTaskIds: options.validatorTasks,
    stagedFiles,
    fileSlices,
    commitSha: applied?.commitSha ?? null,
    temporaryIndexPath
  });
  const saga = planSharedDeliverySaga({
    decision,
    scheduler,
    expectedHeadSha: expectedHead,
    actualHeadSha: applied?.commitSha ?? options.currentHeadSha ?? expectedHead,
    sharedWriteReceipt: plan.receipt,
    fileSlices,
    validatorRefs: Object.fromEntries(taskIds.map((taskId) => [taskId, options.validatorTasks.includes(taskId) ? ['validator-evidence:present'] : []])),
    semanticRefs: Object.fromEntries(taskIds.map((taskId) => [taskId, ['semantic-revalidation:pre-publish']]))
  });
  const receiptPath = options.evidenceOutPath && plan.receipt
    ? writeReceipt(options.cwd, options.evidenceOutPath, plan.receipt)
    : null;
  const result = makeResult({
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
      saga,
      receiptPath,
      temporaryIndexPath,
      payloadAssertion: applied?.payloadAssertion ?? null
    }
  });
  rmSync(tempIndexDir, { recursive: true, force: true });
  return result;
}
